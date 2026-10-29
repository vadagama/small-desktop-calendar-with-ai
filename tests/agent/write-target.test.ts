import assert from "node:assert/strict";
import { test } from "node:test";
import {
  eventTarget,
  meetingTarget,
  rescheduleTarget,
} from "../../src/main/write-target.js";
import { recurringWindow } from "../../src/shared/calendar-invalidation.js";

const move = {
  accountId: "a",
  eventId: "42",
  beforeStart: "2026-10-29T04:00:00Z",
  beforeEnd: "2026-10-29T04:30:00Z",
  startsAt: "2026-10-29T04:15:00Z",
  endsAt: "2026-10-29T04:45:00Z",
};

test("a reschedule touches the event and both the old and the new time", () => {
  assert.deepEqual(rescheduleTarget(move), {
    accountId: "a",
    eventIds: ["42"],
    windows: [
      { start: move.beforeStart, end: move.beforeEnd },
      { start: move.startsAt, end: move.endsAt },
    ],
  });
});

test("a numeric id is read as text and unknown fields are ignored", () => {
  assert.deepEqual(
    rescheduleTarget({ ...move, eventId: 42, extra: true })?.eventIds,
    ["42"],
  );
  assert.deepEqual(
    eventTarget({ accountId: "a", eventId: 7, change: { kind: "cancel" } }),
    { accountId: "a", eventIds: ["7"], windows: [] },
  );
});

test("input that cannot be read has no target, so everything is dropped", () => {
  for (const bad of [
    null,
    "x",
    {},
    { ...move, accountId: "" },
    { ...move, eventId: "" },
    { ...move, beforeStart: undefined },
  ])
    assert.equal(rescheduleTarget(bad), null);
  assert.equal(eventTarget({ accountId: "a" }), null);
  assert.equal(eventTarget(undefined), null);
});

test("a created meeting touches its own span, a weekly one every later range", () => {
  const draft = {
    organizer: { id: "a" },
    startsAt: "2026-10-29T04:00:00Z",
    endsAt: "2026-10-29T05:00:00Z",
  };
  assert.deepEqual(meetingTarget({ ...draft, recurrence: "none" }), {
    accountId: "a",
    eventIds: [],
    windows: [{ start: draft.startsAt, end: draft.endsAt }],
  });
  assert.deepEqual(meetingTarget({ ...draft, recurrence: "weekly" }).windows, [
    recurringWindow(draft.startsAt),
  ]);
});
