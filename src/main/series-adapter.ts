import { z } from "zod";
import { addDateDays } from "../shared/calendar-time.js";
import type { SeriesOperation } from "../shared/series-scope.js";
import { CalendarError } from "./calendar.js";
import {
  mutationHash,
  type EventMutationJournal,
  type EventMutationRecord,
} from "./event-mutation-journal.js";
import { isSeriesApproval, type SeriesApproval } from "./series-contract.js";

/**
 * Writes for recurring events. Every server behaviour used here is an unconfirmed
 * assumption (docs/research/series-contract-probe.md, A2…A9); this module is only
 * reachable with an approval issued by the contract gate. Nothing is ever resent
 * blindly: an unknown outcome blocks the series until a read proves what happened.
 */
export interface SeriesView {
  /** `series:{id}:{original date}`; assumed stable across moves (A4). */
  key: string;
  title: string;
  startsAt: string;
  endsAt: string;
  organizerId: string;
  /** Present when the occurrence already exists as an event of its own. */
  eventId?: string;
}
export interface SeriesCard {
  eventId?: string;
  organizerId: string;
  title: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  isPublic: boolean;
  calendarIds: number[];
  participantIds: string[];
  notificationRecipientIds: string[];
  attachments: string[];
  recurrenceRule: Record<string, unknown>;
}
/** A completed HTTP exchange; a network failure or timeout is a thrown error. */
export interface BackendWrite {
  status: number;
  eventId?: string;
  /** The request was refused locally and never left the app: a definite, retryable failure. */
  notSent?: boolean;
}
export interface SeriesBackend {
  window(
    accountId: string,
    seriesId: string,
    from: string,
    to: string,
  ): Promise<{ views: SeriesView[]; complete: boolean }>;
  card(
    accountId: string,
    ref: { seriesId: string; originalDate: string; eventId?: string },
  ): Promise<SeriesCard | null>;
  materialize(
    accountId: string,
    seriesId: string,
    originalDate: string,
  ): Promise<BackendWrite>;
  update(
    accountId: string,
    eventId: string,
    body: SeriesUpdateBody,
  ): Promise<BackendWrite>;
  cancel(
    accountId: string,
    eventId: string,
    reason: string,
  ): Promise<BackendWrite>;
}

const stamp = z.iso.datetime({ offset: true });
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const seriesUpdateBody = z
  .strictObject({
    title: z.string().min(1).max(200),
    description: z.string().max(20000),
    location: z.string().max(20000),
    starts_at: stamp,
    ends_at: stamp,
    timezone: z.string().min(1).max(100),
    is_recurring: z.literal(true),
    recurrence_rule: z.record(z.string(), z.unknown()),
    recurrence_type: z.literal("custom"),
    recurring_edit_type: z.enum(["single", "all-next"]),
    is_public: z.boolean(),
    calendar_ids: z.array(z.number().int().positive()).max(100),
    participant_ids: z.array(identifier).max(100),
    notification_recipient_ids: z.array(identifier).max(100),
    attachments: z.array(identifier).max(100),
  })
  .refine((e) => Date.parse(e.starts_at) < Date.parse(e.ends_at));
export type SeriesUpdateBody = z.infer<typeof seriesUpdateBody>;

export const seriesChange = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("rename"),
    title: z.string().trim().min(1).max(200),
  }),
  z.strictObject({ kind: z.literal("move") }),
  z.strictObject({ kind: z.literal("delete") }),
]);
export type SeriesChange = z.infer<typeof seriesChange>;
export interface SeriesResult {
  status: "applied" | "already-applied";
  materialized: boolean;
  /** Occurrences outside this read window are not verified. */
  verifiedWindow: { from: string; to: string };
}

const cancelReason = "Отменено пользователем в Small Calendar";
const explicitRejections = [400, 401, 403, 404, 409, 422];
const dateOfKey = (key: string) => key.slice(key.lastIndexOf(":") + 1);
const iso = (ms: number) => new Date(ms).toISOString();

export function fingerprintViews(views: SeriesView[]) {
  return mutationHash(
    views
      .map((v) => ({
        key: v.key,
        title: v.title,
        start: Date.parse(v.startsAt),
        end: Date.parse(v.endsAt),
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  );
}

/** The series as it must look after a successful write; used before and after the request. */
export function expectedState(
  pre: SeriesView[],
  approval: SeriesApproval,
  change: SeriesChange,
): SeriesView[] {
  const from = approval.occurrence.originalDate;
  const affected = (v: SeriesView) =>
    approval.scope === "following"
      ? dateOfKey(v.key) >= from
      : v.key === approval.key;
  if (change.kind === "delete") return pre.filter((v) => !affected(v));
  if (change.kind === "rename")
    return pre.map((v) => (affected(v) ? { ...v, title: change.title } : v));
  const startShift =
    Date.parse(approval.newStartsAt!) -
    Date.parse(approval.occurrence.startsAt);
  const endShift =
    Date.parse(approval.newEndsAt!) - Date.parse(approval.occurrence.endsAt);
  return pre.map((v) =>
    affected(v)
      ? {
          ...v,
          startsAt: iso(Date.parse(v.startsAt) + startShift),
          endsAt: iso(Date.parse(v.endsAt) + endShift),
        }
      : v,
  );
}

function updateBody(
  card: SeriesCard,
  approval: SeriesApproval,
  change: SeriesChange,
): SeriesUpdateBody {
  const parsed = seriesUpdateBody.safeParse({
    title: change.kind === "rename" ? change.title : card.title,
    description: card.description,
    location: card.location,
    starts_at: change.kind === "move" ? approval.newStartsAt : card.startsAt,
    ends_at: change.kind === "move" ? approval.newEndsAt : card.endsAt,
    timezone: card.timezone,
    is_recurring: true,
    recurrence_rule: card.recurrenceRule,
    recurrence_type: "custom",
    recurring_edit_type: approval.scope === "following" ? "all-next" : "single",
    is_public: card.isPublic,
    calendar_ids: card.calendarIds,
    participant_ids: card.participantIds,
    notification_recipient_ids: card.notificationRecipientIds,
    attachments: card.attachments,
  });
  // Missing data is never replaced with empty lists: an incomplete card blocks the write.
  if (!parsed.success)
    throw new CalendarError(
      "invalid",
      "Не удалось получить полную карточку встречи. Изменение серии заблокировано.",
    );
  return parsed.data;
}

const unknownOutcome = () =>
  new CalendarError(
    "network",
    "Результат изменения серии неизвестен: не удалось подтвердить сохранение. Повторная запись заблокирована. Повторное действие только проверит состояние серии.",
  );
const notSent = () =>
  new CalendarError(
    "denied",
    "Операция Small недоступна: запрос не отправлен. Данные не изменены.",
  );
const rejection = (status: number) =>
  new CalendarError(
    status === 401 ? "auth" : status === 403 ? "denied" : "invalid",
    status === 403
      ? "Small отклонил изменение: недостаточно прав."
      : status === 409
        ? "Small отклонил изменение: обнаружен конфликт."
        : "Small отклонил изменение серии.",
  );

export class SeriesMutationService {
  private pending = new Set<string>();
  constructor(
    private backend: SeriesBackend,
    private journal: EventMutationJournal,
  ) {}

  private async read(
    accountId: string,
    seriesId: string,
    from: string,
    to: string,
  ) {
    const result = await this.backend.window(accountId, seriesId, from, to);
    if (!result.complete)
      throw new CalendarError(
        "invalid",
        "Неполные данные календаря: изменение серии заблокировано.",
      );
    return result.views;
  }
  private async verified(
    accountId: string,
    seriesId: string,
    entry: EventMutationRecord,
  ) {
    if (!entry.windowFrom || !entry.windowTo) return false;
    // As in T10 deletes: a missing occurrence proves success only after an acknowledged response.
    if (entry.kind === "series-cancel" && !entry.acknowledged) return false;
    try {
      return (
        fingerprintViews(
          await this.read(
            accountId,
            seriesId,
            entry.windowFrom,
            entry.windowTo,
          ),
        ) === entry.resultHash
      );
    } catch {
      return false;
    }
  }
  private async reconcile(
    accountId: string,
    seriesKey: string,
    seriesId: string,
    request: unknown,
  ) {
    const entry = await this.journal.read(accountId, seriesKey);
    if (!entry) return false;
    if (!(await this.verified(accountId, seriesId, entry)))
      throw unknownOutcome();
    await this.journal.clear(accountId, seriesKey);
    if (entry.requestHash !== mutationHash(request))
      throw new CalendarError(
        "invalid",
        "Предыдущее изменение серии подтверждено. Обновите календарь и повторите новое действие.",
      );
    return true;
  }
  private async settle(
    accountId: string,
    seriesKey: string,
    seriesId: string,
    entry: EventMutationRecord,
    write: () => Promise<BackendWrite>,
  ) {
    let response: BackendWrite;
    try {
      response = await write();
    } catch {
      if (await this.verified(accountId, seriesId, entry)) {
        await this.journal.clear(accountId, seriesKey);
        return;
      }
      throw unknownOutcome();
    }
    if (response.notSent) {
      await this.journal.clear(accountId, seriesKey);
      throw notSent();
    }
    if (response.status < 200 || response.status >= 300) {
      if (explicitRejections.includes(response.status)) {
        await this.journal.clear(accountId, seriesKey);
        throw rejection(response.status);
      }
      if (await this.verified(accountId, seriesId, entry)) {
        await this.journal.clear(accountId, seriesKey);
        return;
      }
      throw unknownOutcome();
    }
    await this.journal.acknowledge(accountId, seriesKey);
    entry.acknowledged = true;
    if (!(await this.verified(accountId, seriesId, entry)))
      throw unknownOutcome();
    await this.journal.clear(accountId, seriesKey);
  }

  async apply(input: {
    accountId: string;
    participantId: string;
    approval: unknown;
    change: unknown;
  }): Promise<SeriesResult> {
    const { accountId, participantId, approval } = input;
    if (!isSeriesApproval(approval))
      throw new CalendarError(
        "denied",
        "Операция серии не одобрена гейтом контракта.",
      );
    const change = seriesChange.parse(input.change);
    const operation: SeriesOperation = change.kind;
    if (approval.operation !== operation)
      throw new CalendarError(
        "denied",
        "Операция серии не одобрена гейтом контракта.",
      );
    const { seriesId, originalDate } = approval.occurrence;
    const seriesKey = `series:${seriesId}`;
    const request = {
      accountId,
      key: approval.key,
      scope: approval.scope,
      change,
      newStartsAt: approval.newStartsAt ?? null,
      newEndsAt: approval.newEndsAt ?? null,
    };
    const lock = `${accountId}:${seriesKey}`;
    if (this.pending.has(lock))
      throw new CalendarError("invalid", "Изменение серии уже сохраняется.");
    this.pending.add(lock);
    const from = addDateDays(originalDate, -14);
    const to = addDateDays(originalDate, 84);
    const verifiedWindow = { from, to };
    try {
      if (await this.reconcile(accountId, seriesKey, seriesId, request))
        return {
          status: "already-applied",
          materialized: false,
          verifiedWindow,
        };
      const pre = await this.read(accountId, seriesId, from, to);
      const target = pre.find((v) => v.key === approval.key);
      if (!target)
        throw new CalendarError(
          "invalid",
          "Встреча серии не найдена. Обновите календарь.",
        );
      if (
        Date.parse(target.startsAt) !==
          Date.parse(approval.occurrence.startsAt) ||
        Date.parse(target.endsAt) !== Date.parse(approval.occurrence.endsAt)
      )
        throw new CalendarError(
          "invalid",
          "Встреча изменилась с момента выбора. Обновите календарь.",
        );
      if (target.organizerId !== participantId)
        throw new CalendarError(
          "denied",
          "Изменить встречи серии может только организатор.",
        );
      const card = await this.backend.card(accountId, {
        seriesId,
        originalDate,
        ...(target.eventId ? { eventId: target.eventId } : {}),
      });
      if (!card || card.organizerId !== participantId)
        throw new CalendarError(
          "invalid",
          "Не удалось получить полную карточку встречи. Изменение серии заблокировано.",
        );
      const body =
        change.kind === "delete" ? null : updateBody(card, approval, change);
      const entry: EventMutationRecord = {
        requestHash: mutationHash(request),
        resultHash: fingerprintViews(expectedState(pre, approval, change)),
        kind: body ? "series-update" : "series-cancel",
        acknowledged: false,
        windowFrom: from,
        windowTo: to,
      };
      // The claim is fsynced before any request, including materialization.
      await this.journal.claim(accountId, seriesKey, entry).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new CalendarError(
            "invalid",
            "Изменение серии уже сохраняется.",
          );
        throw error;
      });
      let eventId = target.eventId ?? card.eventId;
      let materialized = false;
      if (!eventId) {
        let made: BackendWrite;
        try {
          made = await this.backend.materialize(
            accountId,
            seriesId,
            originalDate,
          );
        } catch {
          throw unknownOutcome();
        }
        if (made.notSent) {
          await this.journal.clear(accountId, seriesKey);
          throw notSent();
        }
        if (explicitRejections.includes(made.status)) {
          await this.journal.clear(accountId, seriesKey);
          throw rejection(made.status);
        }
        if (made.status < 200 || made.status >= 300 || !made.eventId)
          throw unknownOutcome();
        eventId = made.eventId;
        materialized = true;
      }
      const id = eventId;
      await this.settle(accountId, seriesKey, seriesId, entry, () =>
        body
          ? this.backend.update(accountId, id, body)
          : this.backend.cancel(accountId, id, cancelReason),
      );
      return { status: "applied", materialized, verifiedWindow };
    } finally {
      this.pending.delete(lock);
    }
  }
}
