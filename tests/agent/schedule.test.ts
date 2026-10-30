import assert from "node:assert/strict";
import { test } from "node:test";
import {
  schedulePeriod,
  readSchedule,
  collectEvents,
} from "../../src/main/schedule.js";
import { occurrenceAliases } from "../../src/shared/occurrence-key.js";
import { legacyOccurrenceKey } from "../../src/shared/series-scope.js";
import type { CalendarEvent } from "../../src/shared/calendar.js";

test("schedule uses Almaty whole days and Monday weeks across year boundaries", () => {
  const now = "2026-12-31T20:00:00Z";
  assert.deepEqual(schedulePeriod({ period: "today" }, now), {
    from: "2027-01-01",
    to: "2027-01-01",
  });
  assert.deepEqual(schedulePeriod({ period: "tomorrow" }, now), {
    from: "2027-01-02",
    to: "2027-01-02",
  });
  assert.deepEqual(schedulePeriod({ period: "this-week" }, now), {
    from: "2026-12-28",
    to: "2027-01-03",
  });
  assert.deepEqual(schedulePeriod({ period: "next-week" }, now), {
    from: "2027-01-04",
    to: "2027-01-10",
  });
  assert.throws(() =>
    schedulePeriod(
      { period: "custom", from: "2026-02-30", to: "2026-03-01" },
      now,
    ),
  );
  assert.throws(() =>
    schedulePeriod(
      { period: "custom", from: "2026-01-01", to: "2026-03-01" },
      now,
    ),
  );
  assert.throws(() =>
    schedulePeriod({ period: "today", accountId: "other" }, now),
  );
});

test("schedule includes past and overnight meetings, excludes next midnight, sorts and preserves incomplete errors", async () => {
  const calls: unknown[] = [];
  const event = (key: string, startsAt: string, endsAt: string) => ({
    key,
    lookup: { id: key },
    title: key,
    startsAt,
    endsAt,
    calendarIds: [],
    organizer: "",
    location: "",
    description: "",
  });
  const result = await readSchedule(
    "account-a",
    { period: "today" },
    {
      events: async (input: unknown) => {
        calls.push(input);
        return {
          events: [
            event("late", "2026-10-29T12:00:00Z", "2026-10-29T13:00:00Z"),
            event("overnight", "2026-10-28T18:00:00Z", "2026-10-28T20:00:00Z"),
            event("next", "2026-10-29T19:00:00Z", "2026-10-29T20:00:00Z"),
          ],
          issues: [
            {
              source: "my",
              kind: "network" as const,
              message: "Неполные данные",
            },
          ],
        };
      },
    },
    new AbortController().signal,
    "2026-10-29T15:00:00Z",
  );
  assert.deepEqual(
    result.events.map((e) => e.title),
    ["overnight", "late"],
  );
  assert.equal(result.complete, false);
  assert.equal(result.issues.length, 1);
  assert.deepEqual(calls, [
    {
      accountId: "account-a",
      date: "2026-10-29",
      view: "week",
      myCalendar: true,
      calendarIds: [],
    },
  ]);
});

test("multiweek schedule reads each week once and empty success is complete", async () => {
  let calls = 0;
  const result = await readSchedule(
    "a",
    { period: "custom", from: "2026-10-31", to: "2026-11-03" },
    {
      events: async () => {
        calls++;
        return { events: [], issues: [] };
      },
    },
    new AbortController().signal,
  );
  assert.equal(calls, 2);
  assert.equal(result.complete, true);
  assert.deepEqual(result.events, []);
});

test("schedule deduplicates a meeting crossing weeks and propagates cancellation", async () => {
  const event = {
    key: "span",
    lookup: { id: "span" },
    title: "Long meeting",
    startsAt: "2026-11-01T18:00:00Z",
    endsAt: "2026-11-02T20:00:00Z",
    calendarIds: [],
    organizer: "",
    location: "",
    description: "",
  };
  const calendar = { events: async () => ({ events: [event], issues: [] }) };
  const input = { period: "custom", from: "2026-10-31", to: "2026-11-03" };
  const result = await readSchedule(
    "a",
    input,
    calendar,
    new AbortController().signal,
  );
  assert.equal(result.events.length, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readSchedule("a", input, calendar, controller.signal), {
    name: "AbortError",
  });
});

const seriesView = (id: string | null, startsAt: string): CalendarEvent => ({
  key: id ? `event:${id}` : legacyOccurrenceKey("43", startsAt),
  lookup: id ? { id } : { originalEventId: "43", date: startsAt.slice(0, 10) },
  originalEventId: "43",
  recurring: true,
  title: "Серия",
  startsAt,
  endsAt: new Date(Date.parse(startsAt) + 7200000).toISOString(),
  calendarIds: [],
  organizer: "",
  location: "",
  description: "",
  aliases: occurrenceAliases({ seriesId: "43", id, startsAt }),
});

test("collectEvents merges the views of one occurrence from different weekly reads and keeps the materialized one", async () => {
  const startsAt = "2026-11-01T18:00:00Z";
  for (const materializedFirst of [false, true]) {
    const views = [seriesView(null, startsAt), seriesView("900", startsAt)];
    const [earlier, later] = materializedFirst ? views.reverse() : views;
    const { events, issues } = await collectEvents(
      "a",
      { from: "2026-10-31", to: "2026-11-03" },
      {
        events: async (input) => ({
          events: [
            (input as { date: string }).date === "2026-10-31"
              ? earlier!
              : later!,
          ],
          issues: [],
        }),
      },
      new AbortController().signal,
    );
    assert.deepEqual(issues, []);
    assert.deepEqual(
      events.map((e) => e.key),
      ["event:900"],
    );
  }
});

test("collectEvents keeps separate events and summary output stays unchanged in shape", async () => {
  const a = seriesView("900", "2026-11-02T05:00:00Z");
  const b = seriesView("901", "2026-11-02T05:00:00Z");
  const result = await readSchedule(
    "a",
    { period: "custom", from: "2026-11-02", to: "2026-11-02" },
    { events: async () => ({ events: [a, b], issues: [] }) },
    new AbortController().signal,
  );
  assert.deepEqual(
    result.events.map((e) => e.key),
    ["event:900", "event:901"],
  );
  assert.deepEqual(Object.keys(result.events[0]!).sort(), [
    "endsAt",
    "key",
    "location",
    "organizer",
    "startsAt",
    "title",
  ]);
});

test("schedule preserves source participants and agenda for copying", async () => {
  const event = {
    ...seriesView("source-copy", "2099-11-02T05:00:00Z"),
    description: "Synthetic agenda",
    participants: [
      {
        id: "person-a",
        name: "Synthetic person",
        status: "accepted",
        organizer: false,
      },
    ],
  };
  const result = await readSchedule(
    "a",
    {
      period: "custom",
      from: "2099-11-02",
      to: "2099-11-02",
      includeDetails: true,
    },
    { events: async () => ({ events: [event], issues: [] }) },
    new AbortController().signal,
  );
  assert.deepEqual(result.events[0]?.participants, event.participants);
  assert.equal(result.events[0]?.description, event.description);
});
