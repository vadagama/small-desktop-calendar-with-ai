import { z } from "zod";
import {
  addDateDays,
  calendarDateAt,
  calendarToday,
  validCalendarDate,
} from "../shared/calendar-time.js";
import {
  describeScope,
  seriesTarget,
  type SeriesApplyResult,
  type SeriesGateState,
} from "../shared/series-scope.js";
import { CalendarError, type CalendarService } from "./calendar.js";
import {
  fingerprintViews,
  type BackendWrite,
  type SeriesBackend,
} from "./series-adapter.js";
import {
  mutationHash,
  type EventMutationJournal,
  type EventMutationRecord,
} from "./event-mutation-journal.js";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const stamp = z.iso.datetime({ offset: true });
const deletion = z.strictObject({
  accountId: z.string().min(1).max(200),
  operation: z.literal("delete"),
  scope: z.enum(["occurrence", "following"]),
  seriesId: id,
  originalDate: z.string().refine(validCalendarDate),
  eventId: id.optional(),
  beforeStart: stamp,
  beforeEnd: stamp,
});
type Deletion = z.infer<typeof deletion>;
const uncertain = () =>
  new CalendarError(
    "network",
    "Результат удаления серии неизвестен. Повторная отправка заблокирована; повторное действие только проверит календарь.",
    true,
  );

/** Mirrors Small's client: materialize if needed, cancel one or DELETE this and following. */
export class SeriesDeletionService {
  private pending = new Set<string>();
  constructor(
    private backend: Pick<SeriesBackend, "window" | "materialize" | "cancel">,
    private calendar: Pick<CalendarService, "detail">,
    private remove: (accountId: string, eventId: string) => Promise<Response>,
    private journal: EventMutationJournal,
  ) {}
  private async current(q: Deletion) {
    if (
      q.originalDate < calendarToday() ||
      calendarDateAt(q.beforeStart) < calendarToday()
    )
      throw new CalendarError(
        "invalid",
        "Прошедшие встречи серии не удаляются.",
      );
    const event = await this.calendar.detail({
      accountId: q.accountId,
      lookup: q.eventId
        ? { id: q.eventId }
        : { originalEventId: q.seriesId, date: q.originalDate },
    });
    const target = seriesTarget(event);
    if (
      !target ||
      target.seriesId !== q.seriesId ||
      target.originalDate !== q.originalDate ||
      event.participation !== "organizer"
    )
      throw new CalendarError(
        "denied",
        "Удалять встречи серии может только её организатор. Проверьте выбранную встречу.",
      );
    if (
      Date.parse(event.startsAt) !== Date.parse(q.beforeStart) ||
      Date.parse(event.endsAt) !== Date.parse(q.beforeEnd)
    )
      throw new CalendarError(
        "invalid",
        "Встреча изменилась. Обновите карточку перед удалением.",
      );
    return { event, target };
  }
  async preview(input: unknown): Promise<SeriesGateState> {
    const q = deletion.parse(input);
    await this.current(q);
    return {
      open: true,
      message: "Подтвердите удаление выбранных встреч.",
      summary: describeScope(q.scope, q.originalDate),
    };
  }
  private async window(q: Deletion, from: string, to: string) {
    const result = await this.backend.window(q.accountId, q.seriesId, from, to);
    if (!result.complete)
      throw new CalendarError(
        "invalid",
        "Не удалось прочитать полный календарь. Удаление серии не отправлено.",
      );
    return result.views;
  }
  private async verified(q: Deletion, record: EventMutationRecord) {
    if (!record.acknowledged || !record.windowFrom || !record.windowTo)
      return false;
    try {
      return (
        fingerprintViews(
          await this.window(q, record.windowFrom, record.windowTo),
        ) === record.resultHash
      );
    } catch {
      return false;
    }
  }
  async apply(input: unknown): Promise<SeriesApplyResult> {
    const q = deletion.parse(input);
    const key = `series:${q.seriesId}`;
    const lock = `${q.accountId}:${key}`;
    if (this.pending.has(lock))
      throw new CalendarError("invalid", "Удаление серии уже выполняется.");
    this.pending.add(lock);
    const requestHash = mutationHash(q);
    try {
      const prior = await this.journal.read(q.accountId, key);
      if (prior) {
        if (prior.kind !== "series-cancel" || !(await this.verified(q, prior)))
          throw uncertain();
        if (prior.requestHash === requestHash)
          return { status: "already-applied", materialized: false };
        await this.journal.clear(q.accountId, key);
      }
      const { target } = await this.current(q);
      const from = addDateDays(q.originalDate, -14),
        to = addDateDays(q.originalDate, 84);
      const before = await this.window(q, from, to);
      const selectedKey = `series:${q.seriesId}:${q.originalDate}`;
      if (!before.some((view) => view.key === selectedKey))
        throw new CalendarError(
          "not-found",
          "Вхождение не найдено в календаре. Обновите расписание.",
        );
      const after = before.filter((view) =>
        q.scope === "occurrence"
          ? view.key !== selectedKey
          : calendarDateAt(view.startsAt) < q.originalDate,
      );
      const record: EventMutationRecord = {
        kind: "series-cancel",
        requestHash,
        resultHash: fingerprintViews(after),
        acknowledged: false,
        windowFrom: from,
        windowTo: to,
      };
      await this.journal.claim(q.accountId, key, record);
      let eventId = target.eventId;
      let materialized = false;
      const checkResponse = async (write: BackendWrite) => {
        if (
          write.notSent ||
          [400, 401, 403, 404, 409, 422].includes(write.status)
        ) {
          await this.journal.clear(q.accountId, key);
          throw new CalendarError(
            write.status === 401 ? "auth" : "denied",
            "Small отклонил удаление. Обновите календарь и проверьте права.",
          );
        }
        if (write.status < 200 || write.status >= 300) throw uncertain();
      };
      try {
        if (!eventId) {
          const made = await this.backend.materialize(
            q.accountId,
            q.seriesId,
            q.originalDate,
          );
          await checkResponse(made);
          if (!made.eventId) throw uncertain();
          eventId = made.eventId;
          // The server returned an ID; check its identity and ownership before deleting it.
          const created = await this.current({ ...q, eventId });
          if (created.target.eventId !== eventId) throw uncertain();
          materialized = true;
        }
        if (q.scope === "occurrence") {
          await checkResponse(
            await this.backend.cancel(
              q.accountId,
              eventId,
              "Отменено пользователем в Small Calendar",
            ),
          );
        } else {
          const response = await this.remove(q.accountId, eventId);
          await checkResponse({ status: response.status });
        }
        await this.journal.acknowledge(q.accountId, key);
        record.acknowledged = true;
        if (!(await this.verified(q, record))) throw uncertain();
        return { status: "applied", materialized };
      } catch (error) {
        if (error instanceof CalendarError) throw error;
        throw uncertain();
      }
    } finally {
      this.pending.delete(lock);
    }
  }
}
