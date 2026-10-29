import type { CalendarEvent, CalendarIssue } from "./calendar.js";

/** Cached events of one query range with the time they were confirmed by Small. */
export interface CalendarSnapshot {
  events: CalendarEvent[];
  issues: CalendarIssue[];
  fetchedAt: number;
}

/**
 * `moved`: the time changed (other fields may have changed too).
 * `changed`: some other field changed, the time did not.
 * The lists are disjoint. A series occurrence is keyed by its start time, so a
 * moved occurrence shows up as `removed` plus `added`.
 */
export interface CalendarDiff {
  added: string[];
  removed: string[];
  changed: string[];
  moved: string[];
}

// Equivalent offsets ("Z" and "+05:00") are the same instant; an unparsable value
// stays as written so that it still compares deterministically.
const instant = (value: string) => {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : time;
};
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const timeOf = (event: CalendarEvent) =>
  JSON.stringify([instant(event.startsAt), instant(event.endsAt)]);

/**
 * Canonical text of everything a user can see in an event. Order of calendars and
 * participants and equivalent date offsets do not matter. Unloaded participants
 * (`undefined`) differ from an empty list, so partial data never looks identical
 * to complete data.
 */
export function eventFingerprint(event: CalendarEvent): string {
  return JSON.stringify([
    event.key,
    "id" in event.lookup
      ? ["id", event.lookup.id]
      : ["series", event.lookup.originalEventId, event.lookup.date],
    event.title,
    instant(event.startsAt),
    instant(event.endsAt),
    [...event.calendarIds].sort(byText),
    event.participation ?? null,
    event.accepted ?? null,
    event.organizer,
    event.description,
    event.location,
    event.recurring ?? null,
    event.participants
      ? [...event.participants]
          .sort((a, b) => byText(a.id, b.id))
          .map((p) => [p.id, p.name, p.status, p.organizer])
      : null,
  ]);
}

export function diffEvents(
  previous: readonly CalendarEvent[],
  next: readonly CalendarEvent[],
): CalendarDiff {
  const before = new Map(previous.map((event) => [event.key, event]));
  const after = new Map(next.map((event) => [event.key, event]));
  const diff: CalendarDiff = { added: [], removed: [], changed: [], moved: [] };
  for (const [key, event] of after) {
    const old = before.get(key);
    if (!old) diff.added.push(key);
    else if (eventFingerprint(old) !== eventFingerprint(event))
      (timeOf(old) === timeOf(event) ? diff.changed : diff.moved).push(key);
  }
  for (const key of before.keys()) if (!after.has(key)) diff.removed.push(key);
  return diff;
}

export const isEmptyDiff = (diff: CalendarDiff) =>
  !diff.added.length &&
  !diff.removed.length &&
  !diff.changed.length &&
  !diff.moved.length;
