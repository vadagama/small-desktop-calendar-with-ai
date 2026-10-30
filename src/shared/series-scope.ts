import type { CalendarEvent, CalendarReply } from "./calendar.js";
import { calendarDateAt, validCalendarDate } from "./calendar-time.js";

/** "occurrence" changes one occurrence; "following" starts at it and never reaches the past. */
export const seriesScopes = ["occurrence", "following"] as const;
export type SeriesScope = (typeof seriesScopes)[number];
export const defaultSeriesScope: SeriesScope = "occurrence";
export const seriesOperations = ["rename", "move", "delete"] as const;
export type SeriesOperation = (typeof seriesOperations)[number];

/** Server assumptions A2…A9 from docs/research/series-contract-probe.md. */
export type ContractAssumption =
  "A2" | "A3" | "A4" | "A5" | "A6" | "A7" | "A8" | "A9";

/** Legacy rename/move adapter policy. Production deletion uses SeriesDeletionService. */
export const seriesOperationMatrix: {
  operation: SeriesOperation;
  scope: SeriesScope;
  supported: boolean;
}[] = [
  { operation: "rename", scope: "occurrence", supported: true },
  { operation: "rename", scope: "following", supported: true },
  { operation: "move", scope: "occurrence", supported: true },
  { operation: "move", scope: "following", supported: true },
  { operation: "delete", scope: "occurrence", supported: true },
  { operation: "delete", scope: "following", supported: false },
];

const identifier = /^[A-Za-z0-9_-]{1,128}$/;
export interface OccurrenceRef {
  /** `original_event_id`, or the series' own id for a template with an id. */
  seriesId: string;
  /** Local (Asia/Almaty) date of the original slot; it does not move with the occurrence. */
  originalDate: string;
}
export interface OccurrenceInput extends OccurrenceRef {
  /** Present only when the occurrence already exists as an event of its own. */
  eventId?: string;
  startsAt: string;
  endsAt: string;
}

function assertRef(ref: OccurrenceRef) {
  if (!identifier.test(ref.seriesId) || !validCalendarDate(ref.originalDate))
    throw new Error("Invalid occurrence reference");
}
/** Stable across rescheduling and materialization: series plus original date only. */
export function occurrenceKey(ref: OccurrenceRef) {
  assertRef(ref);
  return `series:${ref.seriesId}:${ref.originalDate}`;
}
/** The key used before T13: it changes whenever the occurrence is moved. */
export function legacyOccurrenceKey(seriesId: string, startsAt: string) {
  return `series:${seriesId}:${Date.parse(startsAt)}`;
}
/** Original date of a virtual occurrence, as the calendar addresses it. */
export const originalDateOf = (startsAt: string) => calendarDateAt(startsAt);

export const scopeLabels: Record<SeriesScope, string> = {
  occurrence: "Только это вхождение",
  following: "Это и последующие",
};
/** Text for the confirmation: the scope, the date it starts at and what stays untouched. */
export function describeScope(scope: SeriesScope, originalDate: string) {
  if (!validCalendarDate(originalDate)) throw new Error("Invalid date");
  return scope === "occurrence"
    ? `${scopeLabels.occurrence}: ${originalDate}. Остальные встречи серии не изменятся.`
    : `${scopeLabels.following}: с ${originalDate}. Прошедшие встречи не изменятся.`;
}

export type SeriesRefusal =
  | "unknown-identity"
  | "unsupported-scope"
  | "past"
  | "invalid-interval"
  | "move-to-past";
export type SeriesDecision =
  | {
      allowed: true;
      /** The occurrence has no event of its own: materialization is part of the write. */
      materialize: boolean;
      affects: { from: string; includesPast: false };
      /** Server facts that must be confirmed before this combination may be written. */
      requires: ContractAssumption[];
    }
  | { allowed: false; reason: SeriesRefusal; message: string };

const refusal = (reason: SeriesRefusal, message: string): SeriesDecision => ({
  allowed: false,
  reason,
  message,
});

/** Pure policy: which combinations are sensible, never what the server supports. */
export function decideSeriesOperation(input: {
  operation: SeriesOperation;
  scope: SeriesScope;
  occurrence: OccurrenceInput;
  newStartsAt?: string;
  newEndsAt?: string;
  now?: string;
}): SeriesDecision {
  const { operation, scope, occurrence } = input;
  try {
    assertRef(occurrence);
  } catch {
    return refusal(
      "unknown-identity",
      "Не удалось определить вхождение серии. Обновите календарь.",
    );
  }
  if (
    !seriesOperationMatrix.some(
      (row) =>
        row.operation === operation && row.scope === scope && row.supported,
    )
  )
    return refusal(
      "unsupported-scope",
      "Эта область для выбранного действия пока недоступна.",
    );
  const today = calendarDateAt(input.now ?? new Date().toISOString());
  const start = Date.parse(occurrence.startsAt);
  const end = Date.parse(occurrence.endsAt);
  if (!(start < end))
    return refusal(
      "invalid-interval",
      "Время вхождения некорректно. Обновите календарь.",
    );
  if (
    occurrence.originalDate < today ||
    calendarDateAt(occurrence.startsAt) < today
  )
    return refusal("past", "Прошедшие встречи серии не изменяются.");
  if (operation === "move") {
    const newStart = Date.parse(input.newStartsAt ?? "");
    const newEnd = Date.parse(input.newEndsAt ?? "");
    if (!(newStart < newEnd))
      return refusal("invalid-interval", "Проверьте новое время встречи.");
    if (calendarDateAt(input.newStartsAt!) < today)
      return refusal(
        "move-to-past",
        "Нельзя переносить встречу на прошедший день.",
      );
  }
  const materialize = occurrence.eventId === undefined;
  const requires: ContractAssumption[] =
    operation === "delete" ? ["A7", "A9"] : ["A3", "A4", "A8"];
  if (scope === "following" && operation !== "delete")
    requires.push("A5", "A6");
  if (materialize) requires.unshift("A2");
  return {
    allowed: true,
    materialize,
    affects: { from: occurrence.originalDate, includesPast: false },
    requires,
  };
}

/** What the renderer sends; main rebuilds everything else and never trusts a token from it. */
export interface SeriesRequest {
  accountId: string;
  operation: SeriesOperation;
  scope: SeriesScope;
  seriesId: string;
  originalDate: string;
  eventId?: string;
  /** The interval the user was looking at; a changed server state is detected against it. */
  beforeStart: string;
  beforeEnd: string;
  title?: string;
  newStartsAt?: string;
  newEndsAt?: string;
}
export interface SeriesGateState {
  open: boolean;
  reason?: SeriesRefusal | "contract-unverified";
  /** Why the action is closed, or a short confirmation when it is open. */
  message: string;
  /** Scope, date and what stays untouched, for the confirmation dialog. */
  summary: string;
}
export interface SeriesApplyResult {
  status: "applied" | "already-applied";
  materialized: boolean;
}
export interface SeriesBridge {
  gate(request: SeriesRequest): Promise<CalendarReply<SeriesGateState>>;
  apply(request: SeriesRequest): Promise<CalendarReply<SeriesApplyResult>>;
}

/**
 * Series, original date and own event id of a calendar event, or null when it is not a
 * series occurrence. The original date is the local start date, which equals the real one
 * only while the occurrence has not been moved (assumption A4).
 */
export function seriesTarget(
  event: Pick<
    CalendarEvent,
    "lookup" | "originalEventId" | "recurring" | "startsAt"
  >,
): { seriesId: string; originalDate: string; eventId?: string } | null {
  const own = "id" in event.lookup ? event.lookup.id : undefined;
  const seriesId =
    event.originalEventId ?? (event.recurring === true ? own : undefined);
  if (!seriesId) return null;
  const originalDate =
    "originalEventId" in event.lookup
      ? event.lookup.date
      : calendarDateAt(event.startsAt);
  return { seriesId, originalDate, ...(own ? { eventId: own } : {}) };
}
