import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  CalendarError,
  calendarJson,
  type CalendarSession,
} from "./calendar.js";
import { eventSnapshot } from "./event-mutation-request.js";
import type { MeetingJournal } from "./meeting-journal.js";
import type { EventChange } from "../shared/event-change.js";
import type { EventMutationResult } from "../shared/event-mutation.js";
const reference = z.strictObject({
  accountId: z.string().min(1).max(200),
  operationId: z.uuid(),
});
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const uncertain =
  "Ответ Small не подтверждён. Проверьте результат; повторная отправка заблокирована.";
type Entry = EventMutationResult & {
  accountId: string;
  snapshot: ReturnType<typeof eventSnapshot>;
  change: EventChange;
  acknowledged: boolean;
  journalKey: string;
};
export class EventMutations {
  private entries = new Map<string, Entry>();
  constructor(
    private session: CalendarSession & {
      mutateCalendarEvent(
        accountId: string,
        path: string,
        method: "PUT" | "DELETE",
        body?: unknown,
      ): Promise<Response>;
    },
    private journal: MeetingJournal,
    private owner: (accountId: string) => Promise<string>,
  ) {}
  async register(accountId: string, raw: unknown, change: EventChange) {
    if (this.entries.size >= 100)
      throw new CalendarError(
        "invalid",
        "Слишком много предложений. Перезапустите приложение.",
      );
    const snapshot = eventSnapshot(raw);
    let journalKey = "";
    // Each completed operation advances the event's generation. Pending/unknown
    // generations are shared by all proposals and processes and cannot be skipped.
    for (let generation = 0; generation < 1000; generation++) {
      const key = hash([accountId, snapshot.id, generation]);
      if ((await this.journal.read(key))?.phase !== "succeeded") {
        journalKey = key;
        break;
      }
    }
    if (!journalKey)
      throw new CalendarError(
        "invalid",
        "Достигнут лимит изменений этой встречи.",
      );
    const operationId = randomUUID();
    this.entries.set(operationId, {
      accountId,
      snapshot,
      change,
      acknowledged: false,
      journalKey,
      phase: "preview",
      message: "Ничего не применено. Подтвердите изменение.",
    });
    return operationId;
  }
  private entry(input: unknown) {
    const q = reference.parse(input),
      entry = this.entries.get(q.operationId);
    if (!entry || entry.accountId !== q.accountId)
      throw new CalendarError(
        "denied",
        "Предложение недоступно для текущего аккаунта.",
      );
    return entry;
  }
  private result(e: Entry): EventMutationResult {
    return { phase: e.phase, message: e.message };
  }
  private key(e: Entry) {
    return e.journalKey;
  }
  private digest(e: Entry) {
    return hash([e.snapshot, e.change]);
  }
  private async read(e: Entry) {
    return this.session.readCalendar(e.accountId, async (get) =>
      get(`/gate/team/api/calendar/events/${e.snapshot.id}`),
    );
  }
  private async restore(e: Entry) {
    const saved = await this.journal.read(this.key(e));
    if (!saved) return false;
    const restored =
      saved.payloadHash === this.digest(e) ? saved.phase : "blocked";
    if (restored === "succeeded") {
      // A completed receipt belongs to an earlier intent, not necessarily today's
      // event state (another window may have changed it again).
      e.acknowledged = true;
      if (!(await this.verified(e))) {
        e.phase = "blocked";
        e.message =
          "После этой операции встреча изменилась. Откройте карточку заново.";
        return true;
      }
    }
    e.phase = restored;
    e.message = restored === "succeeded" ? "Изменение применено." : uncertain;
    return true;
  }
  private async verified(e: Entry) {
    const response = await this.read(e);
    // A lost DELETE response plus 404 cannot distinguish deletion from lost access.
    if (e.change.kind === "cancel")
      return e.acknowledged && response.status === 404;
    const body = (await calendarJson(response)) as { data: unknown };
    const expected = {
      ...e.snapshot,
      body: { ...e.snapshot.body, title: e.change.title },
    };
    return hash(eventSnapshot(body.data)) === hash(expected);
  }
  private async success(e: Entry) {
    await this.journal.finish(this.key(e), {
      phase: "succeeded",
      eventId: e.snapshot.id,
    });
    e.phase = "succeeded";
    e.message =
      e.change.kind === "cancel" ? "Встреча отменена." : "Название изменено.";
  }
  async confirm(input: unknown, assertCurrent = () => {}) {
    const e = this.entry(input);
    if (e.phase !== "preview") return this.result(e);
    e.phase = "submitting";
    let attempted = false;
    try {
      assertCurrent();
      if (await this.restore(e)) return this.result(e);
      const owner = await this.owner(e.accountId);
      const raw = (await calendarJson(await this.read(e))) as { data: unknown };
      const latest = eventSnapshot(raw.data);
      if (latest.owner !== owner || hash(latest) !== hash(e.snapshot)) {
        e.phase = "blocked";
        e.message = "Встреча или права изменились. Откройте карточку заново.";
        return this.result(e);
      }
      assertCurrent();
      // Claim failure may still have written an intent. Do not resend.
      attempted = true;
      if (!(await this.journal.claim(this.key(e), this.digest(e)))) {
        await this.restore(e);
        return this.result(e);
      }
      assertCurrent();
      const cancel = e.change.kind === "cancel";
      const path = `/gate/team/api/calendar/events/${e.snapshot.id}${cancel ? "" : "?force=false"}`;
      const response = await this.session.mutateCalendarEvent(
        e.accountId,
        path,
        cancel ? "DELETE" : "PUT",
        e.change.kind === "rename"
          ? { ...e.snapshot.body, title: e.change.title }
          : undefined,
      );
      e.acknowledged =
        response.ok &&
        (response.status === 204 ||
          z.object({ status: z.literal("success") }).safeParse(
            await response
              .clone()
              .json()
              .catch(() => null),
          ).success);
      if (await this.verified(e)) {
        assertCurrent();
        await this.success(e);
      } else {
        e.phase = "unknown";
        e.message = uncertain;
      }
    } catch {
      e.phase = attempted ? "unknown" : "preview";
      e.message = attempted
        ? uncertain
        : "Изменение не отправлено. Проверьте доступ к встрече и попробуйте снова.";
    }
    return this.result(e);
  }
  async reconcile(input: unknown, assertCurrent = () => {}) {
    const e = this.entry(input);
    if (e.phase === "submitting") return this.result(e);
    assertCurrent();
    await this.restore(e);
    if (e.phase !== "unknown") return this.result(e);
    try {
      if (await this.verified(e)) {
        assertCurrent();
        await this.success(e);
      }
    } catch {
      /* Keep the uncertain result; never repeat the write. */
    }
    return this.result(e);
  }
}
