import { test } from "node:test";
import assert from "node:assert/strict";
import type { CalendarEvent } from "../../src/shared/calendar.js";
import {
  diffEvents,
  eventFingerprint,
  isEmptyDiff,
} from "../../src/shared/calendar-diff.js";

const event = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  key: "event:42",
  lookup: { id: "42" },
  title: "Synthetic meeting",
  startsAt: "2026-10-29T04:00:00Z",
  endsAt: "2026-10-29T05:00:00Z",
  calendarIds: ["7", "9"],
  participation: "organizer",
  accepted: true,
  organizer: "Synthetic organizer",
  description: "Agenda",
  location: "Room",
  recurring: false,
  participants: [
    { id: "p-b", name: "Beta", status: "accepted", organizer: false },
    { id: "p-a", name: "Alpha", status: "unknown", organizer: true },
  ],
  ...overrides,
});

test("order of calendars and participants does not change the fingerprint", () => {
  const base = event();
  const shuffled = event({
    calendarIds: ["9", "7"],
    participants: [...base.participants!].reverse(),
  });
  assert.equal(eventFingerprint(base), eventFingerprint(shuffled));
});

test("equivalent UTC offsets are the same instant", () => {
  assert.equal(
    eventFingerprint(event()),
    eventFingerprint(
      event({
        startsAt: "2026-10-29T09:00:00+05:00",
        endsAt: "2026-10-29T10:00:00+05:00",
      }),
    ),
  );
});

test("every visible field changes the fingerprint", () => {
  const base = eventFingerprint(event());
  const variants: Partial<CalendarEvent>[] = [
    { title: "Other" },
    { startsAt: "2026-10-29T04:15:00Z" },
    { endsAt: "2026-10-29T05:30:00Z" },
    { calendarIds: ["7"] },
    { participation: "invited" },
    { accepted: false },
    { organizer: "Someone else" },
    { description: "Agenda 2" },
    { location: "Other room" },
    { recurring: true },
    { lookup: { id: "43" } },
    {
      participants: [
        { id: "p-b", name: "Beta", status: "declined", organizer: false },
        { id: "p-a", name: "Alpha", status: "unknown", organizer: true },
      ],
    },
  ];
  for (const variant of variants)
    assert.notEqual(
      eventFingerprint(event(variant)),
      base,
      JSON.stringify(variant),
    );
});

test("unloaded participants differ from an empty list", () => {
  const unloaded = event();
  delete unloaded.participants;
  assert.notEqual(
    eventFingerprint(unloaded),
    eventFingerprint(event({ participants: [] })),
  );
});

test("an unparsable date still gives a stable fingerprint without throwing", () => {
  const broken = event({ startsAt: "not-a-date" });
  assert.equal(eventFingerprint(broken), eventFingerprint(broken));
  assert.notEqual(eventFingerprint(broken), eventFingerprint(event()));
});

test("identical lists give an empty diff and inputs are not mutated", () => {
  const before = [event(), event({ key: "event:43", lookup: { id: "43" } })];
  const snapshot = JSON.stringify(before);
  const diff = diffEvents(before, structuredClone(before));
  assert.ok(isEmptyDiff(diff));
  assert.equal(JSON.stringify(before), snapshot);
});

test("diff separates added, removed, changed and moved events", () => {
  const kept = event({ key: "event:1", lookup: { id: "1" } });
  const gone = event({ key: "event:2", lookup: { id: "2" } });
  const renamed = event({ key: "event:3", lookup: { id: "3" } });
  const shifted = event({ key: "event:4", lookup: { id: "4" } });
  const both = event({ key: "event:5", lookup: { id: "5" } });
  const fresh = event({ key: "event:6", lookup: { id: "6" } });
  const diff = diffEvents(
    [kept, gone, renamed, shifted, both],
    [
      kept,
      { ...renamed, title: "Renamed" },
      { ...shifted, startsAt: "2026-10-29T06:00:00Z" },
      { ...both, title: "Both", endsAt: "2026-10-29T08:00:00Z" },
      fresh,
    ],
  );
  assert.deepEqual(diff, {
    added: ["event:6"],
    removed: ["event:2"],
    changed: ["event:3"],
    moved: ["event:4", "event:5"],
  });
});

test("a moved series occurrence is reported as removed plus added", () => {
  const occurrence = (start: string) =>
    event({
      key: `series:9:${Date.parse(start)}`,
      lookup: { originalEventId: "9", date: "2026-10-29" },
      startsAt: start,
    });
  const diff = diffEvents(
    [occurrence("2026-10-29T04:00:00Z")],
    [occurrence("2026-10-29T06:00:00Z")],
  );
  assert.equal(diff.added.length, 1);
  assert.equal(diff.removed.length, 1);
  assert.deepEqual([diff.changed, diff.moved], [[], []]);
});

test("an event that reappears with the same data is not reported as changed", () => {
  const diff = diffEvents(
    [event()],
    [event({ participants: [...event().participants!].reverse() })],
  );
  assert.ok(isEmptyDiff(diff));
});
