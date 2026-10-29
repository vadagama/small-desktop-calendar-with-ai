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

/** An occurrence of a series belongs to its original event. */
export function eventMatches(
  event: Pick<CalendarEvent, "key" | "lookup">,
  eventIds: string[],
) {
  const own =
    "id" in event.lookup ? event.lookup.id : event.lookup.originalEventId;
  return (
    eventIds.includes(own) || eventIds.some((id) => event.key === `event:${id}`)
  );
}

/** `range: null` means the span of the cached range is unknown, so it is affected. */
export function invalidationAffects(
  range: TimeWindow | null,
  events: Pick<CalendarEvent, "key" | "lookup">[],
  match: EventInvalidation,
) {
  if (!range) return true;
  return (
    match.windows.some((window) => overlaps(range, window)) ||
    events.some((event) => eventMatches(event, match.eventIds))
  );
}
