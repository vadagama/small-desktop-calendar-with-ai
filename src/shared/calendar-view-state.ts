import { isSameOccurrence, occurrenceAliases } from "./occurrence-key.js";
import { legacyOccurrenceKey } from "./series-scope.js";
import type {
  CalendarEvent,
  CalendarView,
  CalendarFreshness,
  CalendarIssue,
  CalendarQuery,
  CalendarResult,
} from "./calendar.js";
import { diffEvents, isEmptyDiff, type CalendarDiff } from "./calendar-diff.js";
import {
  invalidationAffects,
  type EventInvalidation,
  type TimeWindow,
} from "./calendar-invalidation.js";
import { calendarRange, calendarDateAt } from "./calendar-time.js";

/** What the calendar shows for one query key; replaced, never mixed across keys. */
export interface CalendarData {
  key: string;
  events: CalendarEvent[];
  issues: CalendarIssue[];
  fetchedAt: number;
  freshness: CalendarFreshness;
  /** Last non-empty change between two confirmed lists of this key. */
  diff: CalendarDiff | null;
  /** Grows only when `diff` is replaced; animations key off it. */
  revision: number;
}
export interface CalendarFailure {
  key: string;
  message: string;
}
export type CalendarConnection = "online" | "offline";
export interface CalendarViewQuery {
  accountId: string | null;
  date: string;
  view: CalendarQuery["view"];
  my: boolean;
  ids: string[];
}

/** The account is part of the key, so another account's data can never match. */
export const calendarQueryKey = (query: CalendarViewQuery) =>
  JSON.stringify([
    query.accountId,
    query.date,
    query.view,
    query.my,
    query.ids,
  ]);

/** Pushed changes carry the query main last read; match it field by field. */
export function sameCalendarQuery(
  pushed: CalendarQuery,
  query: CalendarViewQuery,
) {
  const sorted = (ids: string[]) => JSON.stringify([...ids].sort());
  return (
    pushed.accountId === query.accountId &&
    pushed.date === query.date &&
    pushed.view === query.view &&
    pushed.myCalendar === query.my &&
    sorted(pushed.calendarIds) === sorted(query.ids)
  );
}

/**
 * Applies a confirmed result. The same key keeps its history (so a diff can be
 * shown), an older answer than the one on screen is dropped, and delivering the
 * same answer twice changes nothing.
 */
export function applyCalendarResult(
  previous: CalendarData | null,
  key: string,
  result: CalendarResult,
  now: number,
): CalendarData {
  const fetchedAt = result.fetchedAt ?? now;
  const base = {
    key,
    events: result.events,
    issues: result.issues,
    fetchedAt,
    freshness: result.freshness ?? "fresh",
  };
  if (previous?.key !== key)
    return { ...base, diff: null, revision: previous?.revision ?? 0 };
  if (fetchedAt < previous.fetchedAt) return previous;
  const diff = diffEvents(previous.events, result.events);
  return isEmptyDiff(diff)
    ? { ...base, diff: previous.diff, revision: previous.revision }
    : { ...base, diff, revision: previous.revision + 1 };
}

/** The card of a meeting Small just confirmed, shown before the next read brings the full one. */
export function eventFromCreatedMeeting(
  draft: {
    title: string;
    agenda: string;
    location: string;
    startsAt: string;
    endsAt: string;
    organizer: { name: string };
    recurrence: "none" | "weekly";
  },
  eventId: string,
): CalendarEvent {
  return {
    ...(draft.recurrence === "weekly"
      ? {
          key: legacyOccurrenceKey(eventId, draft.startsAt),
          lookup: {
            originalEventId: eventId,
            date: calendarDateAt(draft.startsAt),
          },
          aliases: occurrenceAliases({
            seriesId: eventId,
            startsAt: draft.startsAt,
          }),
        }
      : { key: `event:${eventId}`, lookup: { id: eventId } }),
    title: draft.title,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    calendarIds: [],
    participation: "organizer",
    accepted: true,
    organizer: draft.organizer.name,
    description: draft.agenda,
    location: draft.location,
    recurring: draft.recurrence === "weekly",
  };
}

/** Adds an event to a stored range without touching when that range was confirmed. */
export function insertCalendarEvent(
  store: CalendarStore,
  key: string,
  event: CalendarEvent,
): CalendarStore {
  const data = store[key];
  if (!data || data.events.some((known) => isSameOccurrence(known, event)))
    return store;
  return { ...store, [key]: { ...data, events: [...data.events, event] } };
}

/**
 * Before a read replaces the range, Small's version of an event we inserted ourselves
 * becomes the "previous" one, so confirming our own guess does not look like a change.
 */
export function adoptConfirmedEvents(
  store: CalendarStore,
  key: string,
  ours: ReadonlySet<string>,
  confirmed: CalendarEvent[],
): CalendarStore {
  const data = store[key];
  if (!data || !ours.size) return store;
  const events = data.events.map((event) =>
    ours.has(event.key)
      ? (confirmed.find((other) => isSameOccurrence(event, other)) ?? event)
      : event,
  );
  return { ...store, [key]: { ...data, events } };
}

/** Recently viewed ranges, oldest first, so going back to one needs no loading screen. */
export type CalendarStore = Record<string, CalendarData>;
export const CALENDAR_STORE_LIMIT = 8;

export function storeCalendarResult(
  store: CalendarStore,
  key: string,
  result: CalendarResult,
  now: number,
): CalendarStore {
  const previous = store[key] ?? null;
  const next = applyCalendarResult(previous, key, result, now);
  if (next === previous) return store;
  const { [key]: _replaced, ...others } = store;
  return Object.fromEntries(
    Object.entries({ ...others, [key]: next }).slice(-CALENDAR_STORE_LIMIT),
  );
}

/**
 * After a write only the ranges it may have changed are stale. The range being renewed
 * stays so it does not flash a loading screen; its refresh replaces it anyway.
 */
export function pruneAffectedCalendarStore(
  store: CalendarStore,
  keep: string,
  match: EventInvalidation,
): CalendarStore {
  let dropped = false;
  const kept = Object.entries(store).filter(([key, data]) => {
    if (key === keep) return true;
    let range: TimeWindow | null = null;
    try {
      const [, date, view] = JSON.parse(key) as [unknown, string, CalendarView];
      range = calendarRange(date, view);
    } catch {
      // An unreadable key leaves the range unknown, which counts as affected.
    }
    const affected = invalidationAffects(range, data.events, match);
    if (affected) dropped = true;
    return !affected;
  });
  return dropped ? Object.fromEntries(kept) : store;
}

export interface CalendarViewInput {
  accountId: string | null;
  key: string;
  data: CalendarData | null;
  failure: CalendarFailure | null;
  connection: CalendarConnection;
  /** A request for the current key is in flight. */
  pending: boolean;
}
export function deriveCalendarView(input: CalendarViewInput) {
  const current =
    input.accountId && input.data?.key === input.key ? input.data : null;
  const failure =
    input.accountId && input.failure?.key === input.key ? input.failure : null;
  const offline = Boolean(current) && input.connection === "offline";
  return {
    events: current?.events ?? [],
    issues: current?.issues ?? [],
    /** Blocking: there is nothing confirmed to show. */
    error: current ? "" : (failure?.message ?? ""),
    /** Non-blocking: data is on screen but the last attempt to renew it failed. */
    refreshError: current ? (failure?.message ?? "") : "",
    loading: Boolean(input.accountId) && !current && !failure,
    refreshing: Boolean(current) && input.pending,
    stale:
      Boolean(current) &&
      (current!.freshness === "stale" || offline || Boolean(failure)),
    offline,
    fetchedAt: current?.fetchedAt ?? null,
    changes: { diff: current?.diff ?? null, revision: current?.revision ?? 0 },
  };
}
