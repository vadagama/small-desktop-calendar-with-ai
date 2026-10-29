import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarEvent } from "../../src/shared/calendar.js";
import {
  eventFromCreatedMeeting,
  insertCalendarEvent,
  adoptConfirmedEvents,
  storeCalendarResult,
} from "../../src/shared/calendar-view-state.js";
const draft = {
  title: "Synthetic",
  agenda: "Agenda",
  location: "Room",
  startsAt: "2099-10-29T04:00:00Z",
  endsAt: "2099-10-29T04:30:00Z",
  organizer: { name: "Organizer" },
  recurrence: "none" as const,
};
const event = (): CalendarEvent => eventFromCreatedMeeting(draft, "new");
const initial = () =>
  storeCalendarResult(
    {},
    "range",
    { events: [], issues: [], fetchedAt: 100 },
    100,
  );
test("a confirmed creation appears in the loaded range without claiming a fresh read", () => {
  const store = insertCalendarEvent(initial(), "range", event());
  assert.deepEqual(store.range!.events, [event()]);
  assert.equal(store.range!.fetchedAt, 100);
  assert.equal(insertCalendarEvent(store, "range", event()), store);
  assert.deepEqual(insertCalendarEvent({}, "other-account", event()), {});
});
test("a confirmed server card replaces our local card without a second change animation", () => {
  const store = insertCalendarEvent(initial(), "range", event());
  const full = { ...event(), description: "Full server description" };
  const adopted = adoptConfirmedEvents(store, "range", new Set(["event:new"]), [
    full,
  ]);
  const confirmed = storeCalendarResult(
    adopted,
    "range",
    { events: [full], issues: [], fetchedAt: 200 },
    200,
  );
  assert.deepEqual(confirmed.range!.events, [full]);
  assert.equal(confirmed.range!.revision, 0);
  assert.equal(confirmed.range!.diff, null);
});
test("adoption respects occurrence aliases and does not merge two materialized IDs", () => {
  const virtual: CalendarEvent = {
    ...event(),
    key: "series:s:1",
    lookup: { originalEventId: "s", date: "2099-10-29" },
    aliases: ["occurrence:s:2099-10-29"],
  };
  const materialized = { ...event(), aliases: virtual.aliases ?? [] };
  const store = insertCalendarEvent(initial(), "range", virtual);
  assert.equal(insertCalendarEvent(store, "range", materialized), store);
  assert.deepEqual(
    adoptConfirmedEvents(store, "range", new Set([virtual.key]), [materialized])
      .range!.events,
    [materialized],
  );
  const other = {
    ...materialized,
    key: "event:other",
    lookup: { id: "other" },
  };
  const materializedStore = insertCalendarEvent(
    initial(),
    "range",
    materialized,
  );
  assert.equal(
    insertCalendarEvent(materializedStore, "range", other).range!.events.length,
    2,
  );
});

test("a just-created weekly meeting matches the first virtual or materialized occurrence", () => {
  const weekly = eventFromCreatedMeeting(
    { ...draft, recurrence: "weekly" },
    "series-new",
  );
  const materialized: CalendarEvent = {
    ...event(),
    key: "event:materialized",
    lookup: { id: "materialized" },
    aliases: ["series:series-new:2099-10-29"],
  };
  const store = insertCalendarEvent(initial(), "range", weekly);
  assert.equal(insertCalendarEvent(store, "range", materialized), store);
  assert.deepEqual(
    adoptConfirmedEvents(store, "range", new Set([weekly.key]), [materialized])
      .range!.events,
    [materialized],
  );
});
