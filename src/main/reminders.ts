import { createHash } from "node:crypto";
import type {
  CalendarEvent,
  CalendarResult,
  EventLookup,
} from "../shared/calendar.js";
import { calendarDateAt } from "../shared/calendar-time.js";
import type { ReminderItem, ReminderState } from "../shared/reminders.js";
import type { SmallAuthState } from "../shared/small-auth.js";
import { ReminderStore } from "./reminder-store.js";

export function meetingUrl(location: string): string | null {
  if (/[\s\u0000-\u001f\u007f]/.test(location) || location.length > 2048)
    return null;
  try {
    const url = new URL(location);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
interface Dependencies {
  auth: { read(): Promise<SmallAuthState>; readonly sessionRevision: number };
  calendar: {
    events(input: {
      accountId: string;
      date: string;
      view: "day";
      myCalendar: boolean;
      calendarIds: string[];
    }): Promise<CalendarResult>;
    detail(input: {
      accountId: string;
      lookup: EventLookup;
    }): Promise<CalendarEvent>;
  };
  notify(item: ReminderItem, join: () => void): () => void;
  open(url: string): Promise<void>;
  now?: () => number;
}
const hashKey = (accountId: string, key: string) =>
  createHash("sha256")
    .update(JSON.stringify([accountId, key]))
    .digest("hex");
export class Reminders {
  private items = new Map<string, ReminderItem>();
  private notifications = new Map<string, () => void>();
  private epoch = 0;
  private accountId: string | null = null;
  private running: Promise<void> | null = null;
  private warning = "";
  private nativeWarning = "";
  private now: () => number;
  constructor(
    private store: ReminderStore,
    private deps: Dependencies,
  ) {
    this.now = deps.now ?? (() => Date.now());
  }
  invalidate() {
    this.epoch++;
    this.items.clear();
    for (const close of this.notifications.values()) close();
    this.notifications.clear();
    this.accountId = null;
  }
  nativeFailed() {
    this.nativeWarning =
      "Системное уведомление не показано. Проверьте разрешения macOS и подпись приложения. Напоминание доступно в этом окне.";
  }
  async state(): Promise<ReminderState> {
    const auth = await this.deps.auth.read();
    if (auth.status !== "signed-in" || auth.profile.id !== this.accountId)
      this.invalidate();
    return {
      settings: (await this.store.read()).settings,
      items: [...this.items.values()],
      warning: this.warning || this.nativeWarning,
    };
  }
  async save(input: unknown) {
    await this.store.save(input);
    this.invalidate();
    await this.tick();
    return this.state();
  }
  tick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.sync()
      .catch(() => {
        this.invalidate();
        this.warning =
          "Не удалось обновить напоминания. Проверьте вход в Small и подключение к сети.";
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }
  private async sync() {
    const epoch = this.epoch;
    const revision = this.deps.auth.sessionRevision;
    const current = () => {
      if (epoch !== this.epoch) return false;
      if (revision !== this.deps.auth.sessionRevision) {
        this.invalidate();
        return false;
      }
      return true;
    };
    const auth = await this.deps.auth.read();
    if (!current()) return;
    if (auth.status !== "signed-in") {
      this.invalidate();
      return;
    }
    const accountId = auth.profile.id;
    if (this.accountId && this.accountId !== accountId) {
      this.invalidate();
      return;
    }
    this.accountId = accountId;
    const { settings } = await this.store.read();
    if (!current()) return;
    if (!settings.enabled) {
      this.invalidate();
      return;
    }
    // Two days include tomorrow's early meetings even near local midnight.
    const now = this.now();
    const events: CalendarEvent[] = [];
    for (const date of [
      calendarDateAt(new Date(now).toISOString()),
      calendarDateAt(new Date(now + 86400000).toISOString()),
    ]) {
      const result = await this.deps.calendar.events({
        accountId,
        date,
        view: "day",
        myCalendar: true,
        calendarIds: [],
      });
      if (!current()) return;
      if (result.issues.length) throw new Error("Incomplete calendar");
      events.push(...result.events);
    }
    const active = new Map<string, CalendarEvent>();
    for (const event of events) {
      if (Date.parse(event.endsAt) <= this.now()) continue;
      const id = hashKey(accountId, event.key);
      active.set(id, event);
    }
    for (const [id, item] of this.items) {
      const event = active.get(id);
      if (!event || JSON.stringify(event) !== JSON.stringify(item.event)) {
        this.notifications.get(id)?.();
        this.notifications.delete(id);
        this.items.delete(id);
      }
    }
    this.warning = "";
    for (const [id, event] of active) {
      if (!current()) return;
      const due = Date.parse(event.startsAt) - settings.minutes * 60000;
      if (due > this.now()) continue;
      const item = { id, event, canJoin: Boolean(meetingUrl(event.location)) };
      // Aliases recognise the same occurrence in another view (virtual ↔ materialized).
      // Only a virtual view records its date alias, so two separate events of one
      // series on one day never silence each other.
      const aliasIds = (event.aliases ?? []).map((alias) =>
        hashKey(accountId, alias),
      );
      const claimed = await this.store.claim(
        id,
        Date.parse(event.endsAt),
        this.now(),
        {
          seen: aliasIds,
          also: "id" in event.lookup ? [] : aliasIds,
        },
      );
      if (!current()) return;
      this.items.set(id, item);
      if (!claimed) continue;
      // Claim before delivery: a crash cannot result in a duplicate invitation.
      try {
        this.notifications.set(
          id,
          this.deps.notify(item, () => {
            void this.join(id).catch(() => {
              this.warning =
                "Встреча изменилась или ссылка недоступна. Обновите напоминания.";
            });
          }),
        );
      } catch {
        this.nativeFailed();
      }
    }
  }
  async join(id: string) {
    const item = this.items.get(id);
    const accountId = this.accountId;
    if (!item || !accountId) throw new Error("Напоминание больше недоступно.");
    const epoch = this.epoch;
    const revision = this.deps.auth.sessionRevision;
    const auth = await this.deps.auth.read();
    if (auth.status !== "signed-in" || auth.profile.id !== accountId)
      throw new Error("Войдите в Small заново.");
    const event = await this.deps.calendar.detail({
      accountId,
      lookup: item.event.lookup,
    });
    const url = meetingUrl(event.location);
    if (
      epoch !== this.epoch ||
      revision !== this.deps.auth.sessionRevision ||
      event.startsAt !== item.event.startsAt ||
      Date.parse(event.endsAt) <= this.now() ||
      !url
    )
      throw new Error("Встреча изменилась или ссылка отсутствует.");
    await this.deps.open(url);
  }
}
