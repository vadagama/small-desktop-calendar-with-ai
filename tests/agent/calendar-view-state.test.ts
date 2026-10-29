import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  CalendarEvent,
  CalendarQuery,
  CalendarResult,
} from "../../src/shared/calendar.js";
import {
  CALENDAR_STORE_LIMIT,
  adoptConfirmedEvents,
  applyCalendarResult,
  eventFromCreatedMeeting,
  insertCalendarEvent,
  calendarQueryKey,
  deriveCalendarView,
  pruneAffectedCalendarStore,
  sameCalendarQuery,
  storeCalendarResult,
  type CalendarStore,
  type CalendarViewQuery,
} from "../../src/shared/calendar-view-state.js";

const event = (key: string, title = "Synthetic meeting"): CalendarEvent => ({
  key,
  lookup: { id: key.slice(6) },
  title,
  startsAt: "2026-10-29T04:00:00Z",
  endsAt: "2026-10-29T05:00:00Z",
  calendarIds: ["7"],
  organizer: "Synthetic organizer",
  description: "",
  location: "",
});
const result = (
  events: CalendarEvent[],
  fetchedAt?: number,
  freshness?: "fresh" | "stale",
): CalendarResult => ({
  events,
  issues: [],
  ...(fetchedAt === undefined ? {} : { fetchedAt }),
  ...(freshness ? { freshness } : {}),
});
const query: CalendarViewQuery = {
  accountId: "a",
  date: "2026-10-29",
  view: "week",
  my: true,
  ids: [],
};
const key = calendarQueryKey(query);
const input = (overrides: Partial<Parameters<typeof deriveCalendarView>[0]>) =>
  deriveCalendarView({
    accountId: "a",
    key,
    data: null,
    failure: null,
    connection: "online",
    pending: false,
    ...overrides,
  });

test("the first result of a key has no diff; a later change gets one and bumps the revision", () => {
  const first = applyCalendarResult(
    null,
    key,
    result([event("event:1")], 100),
    0,
  );
  assert.equal(first.diff, null);
  assert.equal(first.revision, 0);
  const second = applyCalendarResult(
    first,
    key,
    result([event("event:1"), event("event:2")], 200),
    0,
  );
  assert.deepEqual(second.diff?.added, ["event:2"]);
  assert.equal(second.revision, 1);
});

test("delivering the same answer twice, or an unchanged one, keeps the last diff and revision", () => {
  const first = applyCalendarResult(
    null,
    key,
    result([event("event:1")], 100),
    0,
  );
  const changed = applyCalendarResult(
    first,
    key,
    result([event("event:1", "Renamed")], 200),
    0,
  );
  const again = applyCalendarResult(
    changed,
    key,
    result([event("event:1", "Renamed")], 200),
    0,
  );
  const later = applyCalendarResult(
    again,
    key,
    result([event("event:1", "Renamed")], 300),
    0,
  );
  assert.deepEqual(changed.diff?.changed, ["event:1"]);
  assert.equal(later.revision, changed.revision);
  assert.deepEqual(later.diff, changed.diff);
  assert.equal(later.fetchedAt, 300);
});

test("an answer older than the one on screen is ignored", () => {
  const fresh = applyCalendarResult(
    null,
    key,
    result([event("event:1"), event("event:2")], 200),
    0,
  );
  const stale = applyCalendarResult(
    fresh,
    key,
    result([event("event:1")], 100, "stale"),
    0,
  );
  assert.equal(stale, fresh);
});

test("a result for another key starts a new history and never diffs against the old one", () => {
  const first = applyCalendarResult(
    null,
    key,
    result([event("event:1")], 100),
    0,
  );
  const other = applyCalendarResult(
    { ...first, revision: 3 },
    calendarQueryKey({ ...query, date: "2026-11-05" }),
    result([event("event:9")], 50),
    0,
  );
  assert.equal(other.diff, null);
  assert.equal(other.revision, 3);
});

test("a missing fetchedAt falls back to the local clock and freshness to fresh", () => {
  const data = applyCalendarResult(null, key, result([event("event:1")]), 777);
  assert.equal(data.fetchedAt, 777);
  assert.equal(data.freshness, "fresh");
});

test("without data a failure blocks and loading ends; with data it only marks the view stale", () => {
  assert.equal(input({}).loading, true);
  const failed = input({ failure: { key, message: "down" } });
  assert.deepEqual(
    [failed.loading, failed.error, failed.refreshError],
    [false, "down", ""],
  );
  const data = applyCalendarResult(
    null,
    key,
    result([event("event:1")], 100),
    0,
  );
  const kept = input({ data, failure: { key, message: "down" } });
  assert.deepEqual(
    [
      kept.events.length,
      kept.error,
      kept.refreshError,
      kept.stale,
      kept.loading,
    ],
    [1, "", "down", true, false],
  );
});

test("data of another key or account is never shown", () => {
  const data = applyCalendarResult(
    null,
    key,
    result([event("event:1")], 100),
    0,
  );
  const otherDate = input({
    data,
    key: calendarQueryKey({ ...query, date: "2026-11-05" }),
  });
  assert.deepEqual([otherDate.events, otherDate.loading], [[], true]);
  const otherAccount = input({
    data,
    key: calendarQueryKey({ ...query, accountId: "b" }),
    accountId: "b",
  });
  assert.deepEqual([otherAccount.events, otherAccount.loading], [[], true]);
  const signedOut = input({ data, accountId: null });
  assert.deepEqual(
    [signedOut.events, signedOut.loading, signedOut.error],
    [[], false, ""],
  );
});

test("stale cached data, loss of connection and background refresh are reported separately", () => {
  const fresh = applyCalendarResult(
    null,
    key,
    result([event("event:1")], 100),
    0,
  );
  const stale = applyCalendarResult(
    null,
    key,
    result([event("event:1")], 100, "stale"),
    0,
  );
  assert.equal(input({ data: fresh }).stale, false);
  assert.equal(input({ data: stale }).stale, true);
  const offline = input({ data: fresh, connection: "offline" });
  assert.deepEqual([offline.stale, offline.offline], [true, true]);
  const refreshing = input({ data: fresh, pending: true });
  assert.deepEqual([refreshing.refreshing, refreshing.loading], [true, false]);
  assert.equal(input({ pending: true }).refreshing, false);
  // Without data the connection state is not a "stale" notice.
  assert.equal(input({ connection: "offline" }).offline, false);
});

test("a pushed query matches the view regardless of the order of calendar ids", () => {
  const pushed: CalendarQuery = {
    accountId: "a",
    date: "2026-10-29",
    view: "week",
    myCalendar: false,
    calendarIds: ["2", "1"],
  };
  const view = { ...query, my: false, ids: ["1", "2"] };
  assert.equal(sameCalendarQuery(pushed, view), true);
  for (const different of [
    { ...view, accountId: "b" },
    { ...view, date: "2026-10-30" },
    { ...view, view: "day" as const },
    { ...view, my: true },
    { ...view, ids: ["1"] },
  ])
    assert.equal(sameCalendarQuery(pushed, different), false);
});

test("the query key separates account, date, view, selection", () => {
  const keys = new Set([
    key,
    calendarQueryKey({ ...query, accountId: "b" }),
    calendarQueryKey({ ...query, date: "2026-10-30" }),
    calendarQueryKey({ ...query, view: "day" }),
    calendarQueryKey({ ...query, my: false }),
    calendarQueryKey({ ...query, ids: ["1"] }),
  ]);
  assert.equal(keys.size, 6);
});

test("the store keeps recently viewed ranges, evicts the oldest and ignores older answers", () => {
  let store = {};
  const keys = Array.from({ length: CALENDAR_STORE_LIMIT + 2 }, (_, index) =>
    calendarQueryKey({
      ...query,
      date: `2026-11-${String(index + 1).padStart(2, "0")}`,
    }),
  );
  for (const [index, next] of keys.entries())
    store = storeCalendarResult(
      store,
      next,
      result([event("event:" + index)], 100),
      0,
    );
  assert.deepEqual(Object.keys(store), keys.slice(-CALENDAR_STORE_LIMIT));
  // Touching an old key moves it to the newest position.
  const oldest = keys[2]!;
  store = storeCalendarResult(
    store,
    oldest,
    result([event("event:99")], 200),
    0,
  );
  assert.equal(Object.keys(store).at(-1), oldest);
  // An older answer is a no-op that returns the very same store.
  assert.equal(storeCalendarResult(store, oldest, result([], 100), 0), store);
});

test("going back to a stored range shows its events at once, with no loading", () => {
  const first = storeCalendarResult(
    {},
    key,
    result([event("event:1")], 100),
    0,
  );
  const otherKey = calendarQueryKey({ ...query, date: "2026-11-05" });
  const both = storeCalendarResult(
    first,
    otherKey,
    result([event("event:2")], 150),
    0,
  );
  const back = input({ data: both[key] ?? null });
  assert.deepEqual([back.events.length, back.loading], [1, false]);
});

test("after a write only the ranges it may have touched are dropped, the renewed one stays", () => {
  const range = (date: string) => calendarQueryKey({ ...query, date });
  const first = range("2026-10-29");
  const second = range("2026-11-05");
  const third = range("2026-11-12");
  let store: CalendarStore = {};
  for (const [next, name] of [
    [first, "event:1"],
    [second, "event:2"],
    [third, "event:3"],
  ] as const)
    store = storeCalendarResult(store, next, result([event(name)], 100), 0);
  // Event 1 moves out of its week into the second one.
  const move = {
    eventIds: ["1"],
    windows: [
      { start: "2026-10-29T04:00:00Z", end: "2026-10-29T04:30:00Z" },
      { start: "2026-11-05T04:00:00Z", end: "2026-11-05T04:30:00Z" },
    ],
  };
  assert.deepEqual(
    Object.keys(pruneAffectedCalendarStore(store, first, move)),
    [first, third],
  );
  // The range being renewed stays even when it is affected.
  assert.deepEqual(
    Object.keys(pruneAffectedCalendarStore(store, second, move)),
    [second, third],
  );
  // Nothing affected: the very same store comes back.
  const none = { eventIds: [], windows: [] };
  assert.equal(pruneAffectedCalendarStore(store, first, none), store);
  // A key that cannot be read cannot prove its range untouched.
  const odd = { ...store, "[not a key]": store[first]! };
  assert.equal(
    Object.keys(pruneAffectedCalendarStore(odd, first, none)).includes(
      "[not a key]",
    ),
    false,
  );
});

test("a created meeting is inserted once and keeps the confirmation time", () => {
  const store = storeCalendarResult(
    {},
    "k",
    result([event("event:1")], 100),
    100,
  );
  const ours = eventFromCreatedMeeting(
    {
      title: "Synthetic new",
      agenda: "",
      location: "",
      startsAt: "2026-10-29T06:00:00Z",
      endsAt: "2026-10-29T06:30:00Z",
      organizer: { name: "Synthetic organizer" },
      recurrence: "none",
    },
    "2",
  );
  const added = insertCalendarEvent(store, "k", ours);
  assert.deepEqual(
    added.k!.events.map((e) => e.key),
    ["event:1", "event:2"],
  );
  assert.equal(added.k!.fetchedAt, 100);
  assert.equal(insertCalendarEvent(added, "k", ours), added);
  assert.equal(insertCalendarEvent(store, "other", ours), store);
});

test("Small's version of our own event is not reported as a change", () => {
  const guess = event("event:2", "Synthetic new");
  const confirmed = { ...guess, participants: [] };
  const store = insertCalendarEvent(
    storeCalendarResult({}, "k", result([event("event:1")], 100), 100),
    "k",
    guess,
  );
  const adopted = adoptConfirmedEvents(store, "k", new Set(["event:2"]), [
    event("event:1"),
    confirmed,
  ]);
  const next = storeCalendarResult(
    adopted,
    "k",
    result([event("event:1"), confirmed], 200),
    200,
  );
  assert.equal(next.k!.revision, 0);
  // Without adopting, the same read looks like a change of the event.
  const plain = storeCalendarResult(
    store,
    "k",
    result([event("event:1"), confirmed], 200),
    200,
  );
  assert.equal(plain.k!.revision, 1);
  assert.equal(adoptConfirmedEvents(store, "k", new Set(), []), store);
});
