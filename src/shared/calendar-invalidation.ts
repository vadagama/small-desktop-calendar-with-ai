import type { CalendarEvent } from "./calendar.js";

export interface TimeWindow {
  start: string;
  end: string;
}
/** What a write may have changed: events by id, and the time spans they may now occupy. */
export interface EventInvalidation {
  eventIds: string[];
  windows: TimeWindow[];
}

const FAR_FUTURE = "9999-12-31T00:00:00.000Z";
/** Every range there can be: for writes whose affected times cannot be named. */
export const ANY_TIME: TimeWindow = {
  start: "1970-01-01T00:00:00.000Z",
  end: FAR_FUTURE,
};

/** A series operation may touch any occurrence, so it touches every range holding the series. */
export const seriesInvalidation = (
  event: Pick<CalendarEvent, "lookup" | "originalEventId">,
): EventInvalidation => ({
  eventIds: [
    event.originalEventId ??
      ("id" in event.lookup ? event.lookup.id : event.lookup.originalEventId),
  ],
  windows: [ANY_TIME],
});

/** A recurring meeting appears in every later range, not only around its first date. */
export const recurringWindow = (start: string): TimeWindow => ({
  start,
  end: FAR_FUTURE,
});

/** A newly created meeting changes the ranges it falls into, and all later ones if weekly. */
export const meetingInvalidation = (draft: {
  startsAt: string;
  endsAt: string;
  recurrence: "none" | "weekly";
}): EventInvalidation => ({
  eventIds: [],
  windows: [
    draft.recurrence === "weekly"
      ? recurringWindow(draft.startsAt)
      : { start: draft.startsAt, end: draft.endsAt },
  ],
});

// A time that cannot be read cannot prove a range is untouched.
function overlaps(range: TimeWindow, window: TimeWindow) {
  const rangeStart = Date.parse(range.start);
  const rangeEnd = Date.parse(range.end);
  const windowStart = Date.parse(window.start);
  const windowEnd = Date.parse(window.end);
  if ([rangeStart, rangeEnd, windowStart, windowEnd].some(Number.isNaN))
    return true;
  return rangeStart < windowEnd && windowStart < rangeEnd;
}

/** An occurrence of a series belongs to its original event, however it was reported. */
export function eventMatches(
  event: Pick<CalendarEvent, "key" | "lookup" | "originalEventId">,
  eventIds: string[],
) {
  const own =
    "id" in event.lookup ? event.lookup.id : event.lookup.originalEventId;
  return (
    eventIds.includes(own) ||
    (event.originalEventId !== undefined &&
      eventIds.includes(event.originalEventId)) ||
    eventIds.some((id) => event.key === `event:${id}`)
  );
}

/** `range: null` means the span of the cached range is unknown, so it is affected. */
export function invalidationAffects(
  range: TimeWindow | null,
  events: Pick<CalendarEvent, "key" | "lookup" | "originalEventId">[],
  match: EventInvalidation,
) {
  if (!range) return true;
  return (
    match.windows.some((window) => overlaps(range, window)) ||
    events.some((event) => eventMatches(event, match.eventIds))
  );
}
