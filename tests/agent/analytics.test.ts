import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeMeetings } from "../../src/main/analytics.js";
import type { CalendarEvent } from "../../src/shared/calendar.js";

// Almaty is UTC+5: the day 2026-10-29 is [2026-10-28T19:00Z, 2026-10-29T19:00Z).
const me = "me";
const event = (
  key: string,
  startsAt: string,
  endsAt: string,
  extra: Partial<CalendarEvent> = {},
): CalendarEvent => ({
  key,
  lookup: { id: key },
  title: key,
  startsAt,
  endsAt,
  calendarIds: [],
  organizer: "Анна",
  location: "",
  description: "",
  participation: "organizer",
  ...extra,
});
const day = { from: "2026-10-29", to: "2026-10-29", participantId: me };
const run = (events: CalendarEvent[], more = {}) =>
  analyzeMeetings({ ...day, events, ...more });

test("overlapping meetings give a sum of durations and a smaller union of busy time", () => {
  const r = run([
    event("a", "2026-10-29T05:00:00Z", "2026-10-29T06:00:00Z"),
    event("b", "2026-10-29T05:30:00Z", "2026-10-29T06:30:00Z"),
    event("c", "2026-10-29T08:00:00Z", "2026-10-29T08:30:00Z"),
  ]);
  assert.equal(r.totals.count, 3);
  assert.equal(r.totals.sumMinutes, 150);
  assert.equal(r.totals.busyMinutes, 120);
  assert.equal(r.totals.overlapMinutes, 30);
  assert.equal(r.complete, true);
});

test("period is half-open and boundary meetings count only inside the period", () => {
  const r = run([
    event("endsAtStart", "2026-10-28T18:00:00Z", "2026-10-28T19:00:00Z"),
    event("startsAtEnd", "2026-10-29T19:00:00Z", "2026-10-29T20:00:00Z"),
    event("crossStart", "2026-10-28T18:30:00Z", "2026-10-28T19:30:00Z"),
    event("crossEnd", "2026-10-29T18:30:00Z", "2026-10-29T19:45:00Z"),
    event("lastHour", "2026-10-29T18:00:00Z", "2026-10-29T19:00:00Z"),
  ]);
  assert.deepEqual(
    r.events.map((e) => [e.key, e.minutes]),
    [
      ["crossStart", 30],
      ["lastHour", 60],
      ["crossEnd", 30],
    ],
  );
  assert.equal(r.totals.sumMinutes, 120);
});

test("multi-day period counts every occurrence once with clipped time", () => {
  const r = analyzeMeetings({
    from: "2026-10-29",
    to: "2026-10-30",
    participantId: me,
    events: [
      event("x", "2026-10-29T05:00:00Z", "2026-10-29T06:00:00Z"),
      event("y", "2026-10-30T05:00:00Z", "2026-10-30T07:00:00Z"),
    ],
  });
  assert.equal(r.totals.count, 2);
  assert.equal(r.totals.sumMinutes, 180);
  assert.equal(r.totals.busyMinutes, 180);
});

test("answer status splits confirmed, unconfirmed and declined; unknown is never accepted", () => {
  const own = (status: string) => ({
    participation: "invited" as const,
    participants: [{ id: me, name: "Я", status, organizer: false }],
  });
  const r = run([
    event("organizer", "2026-10-29T05:00:00Z", "2026-10-29T06:00:00Z"),
    event(
      "accepted",
      "2026-10-29T06:00:00Z",
      "2026-10-29T07:00:00Z",
      own("accepted"),
    ),
    event(
      "declined",
      "2026-10-29T07:00:00Z",
      "2026-10-29T08:00:00Z",
      own("declined"),
    ),
    event(
      "waiting",
      "2026-10-29T08:00:00Z",
      "2026-10-29T09:00:00Z",
      own("needs-action"),
    ),
    event("nostatus", "2026-10-29T09:00:00Z", "2026-10-29T10:00:00Z", {
      participation: "unknown",
    }),
    event("informed", "2026-10-29T10:00:00Z", "2026-10-29T11:00:00Z", {
      participation: "informed",
    }),
  ]);
  assert.equal(r.groups.confirmed.count, 2);
  assert.equal(r.groups.declined.count, 1);
  assert.equal(r.groups.unconfirmed.count, 3);
  assert.equal(r.groups.unconfirmed.minutes, 180);
  assert.equal(r.totals.count, 2);
  assert.equal(r.totals.sumMinutes, 120);
});

test("all-day looking meetings are counted apart and never become hours", () => {
  const r = run([
    event("full", "2026-10-28T19:00:00Z", "2026-10-29T19:00:00Z"),
    event("long", "2026-10-29T03:00:00Z", "2026-10-30T03:00:00Z"),
    event("midnight", "2026-10-29T19:00:00Z", "2026-10-29T19:00:00Z"),
    event("early", "2026-10-28T19:00:00Z", "2026-10-28T21:00:00Z"),
  ]);
  assert.equal(r.groups["possible-all-day"].count, 2);
  assert.equal(r.groups["possible-all-day"].minutes, 0);
  assert.equal(r.groups.invalid.count, 1);
  assert.equal(r.totals.count, 1);
  assert.equal(r.totals.sumMinutes, 120);
});

test("invalid intervals are reported, not counted", () => {
  const r = run([
    event("zero", "2026-10-29T05:00:00Z", "2026-10-29T05:00:00Z"),
    event("reversed", "2026-10-29T06:00:00Z", "2026-10-29T05:00:00Z"),
    event("garbage", "nope", "2026-10-29T05:00:00Z"),
  ]);
  assert.equal(r.groups.invalid.count, 3);
  assert.equal(r.totals.count, 0);
  assert.equal(r.totals.sumMinutes, 0);
});

test("the same occurrence is counted once by key or lookup identity", () => {
  const r = run([
    event("k", "2026-10-29T05:00:00Z", "2026-10-29T06:00:00Z"),
    event("k", "2026-10-29T05:00:00Z", "2026-10-29T06:00:00Z"),
    event("other-key", "2026-10-29T07:00:00Z", "2026-10-29T08:00:00Z", {
      lookup: { id: "k" },
    }),
    event("s1", "2026-10-29T09:00:00Z", "2026-10-29T10:00:00Z", {
      lookup: { originalEventId: "o", date: "2026-10-29" },
    }),
    event("s2", "2026-10-29T09:00:00Z", "2026-10-29T10:00:00Z", {
      lookup: { originalEventId: "o", date: "2026-10-29" },
    }),
  ]);
  assert.equal(r.totals.count, 2);
  assert.equal(r.duplicates, 3);
  assert.equal(r.totals.sumMinutes, 120);
});

test("regular meetings are only server-confirmed series", () => {
  const r = run([
    event("weekly", "2026-10-29T05:00:00Z", "2026-10-29T06:00:00Z", {
      recurring: true,
    }),
    event("explicit-no", "2026-10-29T06:00:00Z", "2026-10-29T07:00:00Z", {
      recurring: false,
    }),
    event("same-title", "2026-10-29T07:00:00Z", "2026-10-29T08:00:00Z", {
      title: "weekly",
    }),
  ]);
  assert.equal(r.totals.regularCount, 1);
  assert.equal(r.totals.regularMinutes, 60);
});

test("topics follow ordered keyword rules; others are uncategorized and rules are shown", () => {
  const r = run(
    [
      event("1", "2026-10-29T05:00:00Z", "2026-10-29T06:00:00Z", {
        title: "Планирование спринта",
      }),
      event("2", "2026-10-29T06:00:00Z", "2026-10-29T06:30:00Z", {
        title: "Daily Standup",
      }),
      event("3", "2026-10-29T07:00:00Z", "2026-10-29T08:00:00Z", {
        title: "Обед",
      }),
    ],
    {
      rules: [
        { topic: "Процесс", keywords: ["спринт", " standup "] },
        { topic: "Планы", keywords: ["планирование"] },
        { topic: "Пустое", keywords: ["", "  "] },
      ],
    },
  );
  assert.deepEqual(
    r.byTopic.map((b) => [b.name, b.count, b.minutes]),
    [
      ["Процесс", 2, 90],
      ["Без категории", 1, 60],
    ],
  );
  assert.equal(r.events[0]?.rule, "Процесс: «спринт»");
  assert.equal(r.events[2]?.rule, null);
});

test("organizers and participants are summarised without counting the account itself", () => {
  const people = (ids: string[]) =>
    ids.map((id) => ({
      id,
      name: id.toUpperCase(),
      status: "accepted",
      organizer: false,
    }));
  const r = run([
    event("1", "2026-10-29T05:00:00Z", "2026-10-29T06:00:00Z", {
      organizer: "Анна",
      participants: people([me, "p1", "p2"]),
    }),
    event("2", "2026-10-29T06:00:00Z", "2026-10-29T06:30:00Z", {
      organizer: "",
      participants: people([me, "p1"]),
    }),
  ]);
  assert.deepEqual(
    r.byOrganizer.map((b) => [b.name, b.minutes]),
    [
      ["Анна", 60],
      ["Не указан", 30],
    ],
  );
  assert.deepEqual(
    r.topParticipants.map((b) => [b.name, b.count, b.minutes]),
    [
      ["P1", 2, 90],
      ["P2", 1, 60],
    ],
  );
});

test("incomplete or truncated reads mark the result partial and keep issues", () => {
  const issue = { source: "my", kind: "network" as const, message: "Нет сети" };
  const base = [event("a", "2026-10-29T05:00:00Z", "2026-10-29T06:00:00Z")];
  assert.equal(run(base, { issues: [issue] }).complete, false);
  assert.deepEqual(run(base, { issues: [issue] }).issues, [issue]);
  assert.equal(run(base, { truncated: true }).complete, false);
  assert.equal(run(base).complete, true);
  assert.deepEqual(run([]).unavailable, ["cancellations", "teams", "tags"]);
});

test("invalid periods are rejected", () => {
  const periods: [string, string][] = [
    ["2026-02-30", "2026-03-01"],
    ["2026-10-30", "2026-10-29"],
    ["x", "2026-10-29"],
  ];
  for (const [from, to] of periods)
    assert.throws(() =>
      analyzeMeetings({ from, to, participantId: me, events: [] }),
    );
});
