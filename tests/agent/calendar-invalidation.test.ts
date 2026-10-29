import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarEvent } from "../../src/shared/calendar.js";
import {
  ANY_TIME,
  eventMatches,
  invalidationAffects,
  meetingInvalidation,
  recurringWindow,
  seriesInvalidation,
} from "../../src/shared/calendar-invalidation.js";

type Ref = Pick<CalendarEvent, "key" | "lookup">;
const single = (id: string): Ref => ({
  key: `event:${id}`,
  lookup: { id },
});
const occurrence = (original: string): Ref => ({
  key: `series:${original}:1`,
  lookup: { originalEventId: original, date: "2026-10-29" },
});
const week = {
  start: "2026-10-26T00:00:00.000Z",
  end: "2026-11-02T00:00:00.000Z",
};
const none = { eventIds: [], windows: [] };

test("an event is matched by its id, and an occurrence by its original event", () => {
  assert.equal(eventMatches(single("42"), ["42"]), true);
  assert.equal(eventMatches(single("42"), ["43"]), false);
  assert.equal(eventMatches(occurrence("42"), ["42"]), true);
  assert.equal(eventMatches(occurrence("42"), ["43"]), false);
  assert.equal(eventMatches(single("42"), []), false);
});

test("a range is affected when a window overlaps it, never when it only touches", () => {
  const window = (start: string, end: string) => ({
    eventIds: [],
    windows: [{ start, end }],
  });
  assert.equal(
    invalidationAffects(
      week,
      [],
      window("2026-10-28T09:00:00Z", "2026-10-28T10:00:00Z"),
    ),
    true,
  );
  // Ends exactly where the range starts, and starts exactly where it ends.
  assert.equal(
    invalidationAffects(
      week,
      [],
      window("2026-10-25T00:00:00Z", "2026-10-26T00:00:00Z"),
    ),
    false,
  );
  assert.equal(
    invalidationAffects(
      week,
      [],
      window("2026-11-02T00:00:00Z", "2026-11-02T01:00:00Z"),
    ),
    false,
  );
  assert.equal(
    invalidationAffects(
      week,
      [],
      window("2026-11-09T09:00:00Z", "2026-11-09T10:00:00Z"),
    ),
    false,
  );
});

test("a range is affected when it holds the event, whatever its time", () => {
  const match = { eventIds: ["42"], windows: [] };
  assert.equal(
    invalidationAffects(week, [single("1"), single("42")], match),
    true,
  );
  assert.equal(
    invalidationAffects(week, [single("1"), occurrence("42")], match),
    true,
  );
  assert.equal(invalidationAffects(week, [single("1")], match), false);
  assert.equal(invalidationAffects(week, [], none), false);
});

test("what cannot be read cannot prove a range untouched", () => {
  assert.equal(invalidationAffects(null, [], none), true);
  assert.equal(
    invalidationAffects(week, [], {
      eventIds: [],
      windows: [{ start: "not a date", end: "2026-10-28T10:00:00Z" }],
    }),
    true,
  );
  assert.equal(
    invalidationAffects({ start: "oops", end: week.end }, [], {
      eventIds: [],
      windows: [{ start: "2026-10-28T09:00:00Z", end: "2026-10-28T10:00:00Z" }],
    }),
    true,
  );
});

test("a new meeting touches its own span, a weekly one every later range", () => {
  const once = meetingInvalidation({
    startsAt: "2026-10-28T09:00:00Z",
    endsAt: "2026-10-28T10:00:00Z",
    recurrence: "none",
  });
  assert.equal(invalidationAffects(week, [], once), true);
  assert.equal(
    invalidationAffects(
      { start: "2026-11-09T00:00:00Z", end: "2026-11-16T00:00:00Z" },
      [],
      once,
    ),
    false,
  );
  const weekly = meetingInvalidation({
    startsAt: "2026-10-28T09:00:00Z",
    endsAt: "2026-10-28T10:00:00Z",
    recurrence: "weekly",
  });
  assert.deepEqual(weekly.windows, [recurringWindow("2026-10-28T09:00:00Z")]);
  assert.equal(
    invalidationAffects(
      { start: "2027-03-01T00:00:00Z", end: "2027-03-08T00:00:00Z" },
      [],
      weekly,
    ),
    true,
  );
  // Ranges before the first occurrence are not affected.
  assert.equal(
    invalidationAffects(
      { start: "2026-10-12T00:00:00Z", end: "2026-10-19T00:00:00Z" },
      [],
      weekly,
    ),
    false,
  );
});

test("a series is matched by the original event the calendar reports, wherever its key points", () => {
  const reported = {
    key: "series:9:111",
    lookup: { originalEventId: "9", date: "2026-10-29" },
  };
  assert.equal(eventMatches(reported, ["9"]), true);
  // A materialized occurrence has its own id but names the series it belongs to.
  const materialized = {
    key: "event:50",
    lookup: { id: "50" },
    originalEventId: "9",
  };
  assert.equal(eventMatches(materialized, ["9"]), true);
  assert.equal(eventMatches(materialized, ["50"]), true);
  assert.equal(eventMatches(materialized, ["51"]), false);
});

test("a series operation touches every range that holds the series, at any time", () => {
  const target = seriesInvalidation({
    lookup: { id: "50" },
    originalEventId: "9",
  });
  assert.deepEqual(target.eventIds, ["9"]);
  assert.deepEqual(target.windows, [ANY_TIME]);
  const fromOccurrence = seriesInvalidation({
    lookup: { originalEventId: "9", date: "2026-10-29" },
  });
  assert.deepEqual(fromOccurrence.eventIds, ["9"]);
  const plain = seriesInvalidation({ lookup: { id: "7" } });
  assert.deepEqual(plain.eventIds, ["7"]);
  for (const range of [
    { start: "1999-01-04T00:00:00Z", end: "1999-01-11T00:00:00Z" },
    { start: "2026-10-26T00:00:00Z", end: "2026-11-02T00:00:00Z" },
    { start: "2300-01-01T00:00:00Z", end: "2300-01-08T00:00:00Z" },
  ])
    assert.equal(invalidationAffects(range, [], target), true);
});
