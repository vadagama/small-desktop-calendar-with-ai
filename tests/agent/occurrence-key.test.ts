import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OccurrenceSet,
  isSameOccurrence,
  occurrenceAliases,
  occurrenceIdentities,
} from "../../src/shared/occurrence-key.js";
import { legacyOccurrenceKey } from "../../src/shared/series-scope.js";
import type { CalendarEvent } from "../../src/shared/calendar.js";

const at = (date: string, hour = 5) =>
  `${date}T${String(hour).padStart(2, "0")}:00:00Z`;
const base = (
  patch: Partial<CalendarEvent> & { key: string },
): CalendarEvent => ({
  lookup: { id: "1" },
  title: "Планёрка",
  startsAt: at("2026-11-05"),
  endsAt: at("2026-11-05", 6),
  calendarIds: [],
  organizer: "",
  location: "",
  description: "",
  ...patch,
});
/** Virtual occurrence: the key is the old time-based one, the alias is the date. */
const virtual = (series: string, date: string, hour = 5): CalendarEvent => {
  const startsAt = at(date, hour);
  return base({
    key: legacyOccurrenceKey(series, startsAt),
    lookup: { originalEventId: series, date },
    originalEventId: series,
    recurring: true,
    startsAt,
    endsAt: at(date, hour + 1),
    aliases: occurrenceAliases({ seriesId: series, startsAt }),
  });
};
const materialized = (
  id: string,
  series: string,
  date: string,
  hour = 5,
): CalendarEvent => {
  const startsAt = at(date, hour);
  return base({
    key: `event:${id}`,
    lookup: { id },
    originalEventId: series,
    recurring: true,
    startsAt,
    endsAt: at(date, hour + 1),
    aliases: occurrenceAliases({ seriesId: series, id, startsAt }),
  });
};
const plain = (id: string) => base({ key: `event:${id}`, lookup: { id } });
const keys = (set: OccurrenceSet) => set.values().map((e) => e.key);

test("aliases: a virtual view gets the date, a materialized one also the old virtual key", () => {
  const startsAt = at("2026-11-05");
  assert.deepEqual(occurrenceAliases({ seriesId: "43", startsAt }), [
    "series:43:2026-11-05",
  ]);
  assert.deepEqual(occurrenceAliases({ seriesId: "43", id: "900", startsAt }), [
    "series:43:2026-11-05",
    `series:43:${Date.parse(startsAt)}`,
  ]);
  for (const input of [
    { startsAt },
    { seriesId: null, id: "9", startsAt },
    { seriesId: "", startsAt },
  ])
    assert.deepEqual(occurrenceAliases(input), []);
  // 19:30Z is already the next calendar day in Almaty.
  assert.deepEqual(
    occurrenceAliases({ seriesId: "43", startsAt: "2026-11-05T19:30:00Z" }),
    ["series:43:2026-11-06"],
  );
});

test("identities are the key followed by the aliases", () => {
  assert.deepEqual(occurrenceIdentities(plain("5")), ["event:5"]);
  const v = virtual("43", "2026-11-05");
  assert.deepEqual(occurrenceIdentities(v), [v.key, "series:43:2026-11-05"]);
});

test("a virtual and a materialized view of one occurrence are the same, moves within the day included", () => {
  const v = virtual("43", "2026-11-05");
  assert.equal(
    isSameOccurrence(v, materialized("900", "43", "2026-11-05")),
    true,
  );
  // Moved within the day: only the date alias still links them.
  assert.equal(
    isSameOccurrence(v, materialized("900", "43", "2026-11-05", 9)),
    true,
  );
  assert.equal(isSameOccurrence(v, v), true);
  assert.equal(isSameOccurrence(v, virtual("43", "2026-11-05")), true);
  // Different day, different series, unrelated events.
  assert.equal(
    isSameOccurrence(v, materialized("900", "43", "2026-11-12")),
    false,
  );
  assert.equal(
    isSameOccurrence(v, materialized("900", "44", "2026-11-05")),
    false,
  );
  assert.equal(isSameOccurrence(v, plain("900")), false);
  assert.equal(isSameOccurrence(plain("1"), plain("2")), false);
});

test("two different events of their own are never merged, even on the same series and day", () => {
  const a = materialized("900", "43", "2026-11-05");
  const b = materialized("901", "43", "2026-11-05");
  assert.equal(isSameOccurrence(a, b), false);
  assert.equal(
    isSameOccurrence(a, materialized("900", "43", "2026-11-05")),
    true,
  );
});

test("the materialized view wins in either order and keeps the position", () => {
  for (const order of ["virtual-first", "materialized-first"]) {
    const set = new OccurrenceSet();
    set.add(plain("1"));
    const v = virtual("43", "2026-11-05");
    const m = materialized("900", "43", "2026-11-05");
    if (order === "virtual-first") {
      set.add(v);
      set.add(plain("2"));
      set.add(m);
    } else {
      set.add(m);
      set.add(plain("2"));
      set.add(v);
    }
    assert.deepEqual(keys(set), ["event:1", "event:900", "event:2"], order);
  }
});

test("the index follows a replacement: a later virtual view still merges", () => {
  const set = new OccurrenceSet();
  set.add(virtual("43", "2026-11-05"));
  set.add(materialized("900", "43", "2026-11-05"));
  set.add(virtual("43", "2026-11-05"));
  assert.deepEqual(keys(set), ["event:900"]);
  set.add(virtual("43", "2026-11-12"));
  assert.equal(set.values().length, 2);
});

test("different events of their own stay separate; the same key keeps the old later-wins rule", () => {
  const set = new OccurrenceSet();
  set.add(materialized("900", "43", "2026-11-05"));
  set.add(materialized("901", "43", "2026-11-05"));
  assert.deepEqual(keys(set), ["event:900", "event:901"]);
  const later = { ...plain("5"), title: "Новое" };
  set.add(plain("5"));
  set.add(later);
  assert.equal(set.values().find((e) => e.key === "event:5")?.title, "Новое");
  const twice = new OccurrenceSet();
  twice.add(virtual("43", "2026-11-05"));
  twice.add({ ...virtual("43", "2026-11-05"), title: "Позже" });
  assert.deepEqual(
    twice.values().map((e) => e.title),
    ["Позже"],
  );
});

test("an occurrence moved to another day is a different one; unrelated events are untouched", () => {
  const set = new OccurrenceSet();
  set.add(virtual("43", "2026-11-05"));
  set.add(materialized("900", "43", "2026-11-06"));
  set.add(plain("7"));
  assert.equal(set.values().length, 3);
});

test("thousands of events stay linear and keep their order", () => {
  const set = new OccurrenceSet();
  const started = Date.now();
  for (let i = 0; i < 5000; i++) set.add(plain(String(i)));
  for (let i = 0; i < 5000; i += 100) set.add(virtual(String(i), "2026-11-05"));
  assert.equal(set.values().length, 5050);
  assert.deepEqual(keys(set).slice(0, 3), ["event:0", "event:1", "event:2"]);
  assert.ok(Date.now() - started < 2000);
});
