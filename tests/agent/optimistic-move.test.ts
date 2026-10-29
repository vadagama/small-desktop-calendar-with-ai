import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarEvent } from "../../src/shared/calendar.js";
import {
  AWAITING_EXPIRES_MS,
  beginMove,
  classifyMoveReply,
  isMoveLocked,
  moveBadge,
  overlayMoves,
  resolveMove,
  settleMoves,
  type PendingMoves,
} from "../../src/shared/optimistic-move.js";

const before = {
  startsAt: "2026-10-29T04:00:00Z",
  endsAt: "2026-10-29T04:30:00Z",
};
const after = {
  startsAt: "2026-10-29T04:15:00Z",
  endsAt: "2026-10-29T04:45:00Z",
};
const event = (key: string, times = before): CalendarEvent => ({
  key,
  lookup: { id: key.slice(6) },
  title: "Synthetic meeting",
  calendarIds: ["7"],
  organizer: "Synthetic organizer",
  description: "",
  location: "",
  ...times,
});
const started = (now = 1000): PendingMoves =>
  beginMove({}, "event:1", before, after, now);

test("replies are classified: only a flagged failure is unknown", () => {
  assert.equal(classifyMoveReply({ ok: true }), "applied");
  assert.equal(classifyMoveReply({ ok: false }), "refused");
  assert.equal(
    classifyMoveReply({ ok: false, unknownOutcome: true }),
    "unknown",
  );
});

test("a move starts as saving and locks the event, a second one meanwhile is ignored", () => {
  const moves = started();
  assert.equal(moves["event:1"]?.phase, "saving");
  assert.equal(isMoveLocked(moves, "event:1"), true);
  assert.equal(isMoveLocked(moves, "event:2"), false);
  assert.equal(
    beginMove(moves, "event:1", before, { ...after, endsAt: "x" }, 2000),
    moves,
  );
  const unknown = resolveMove(moves, "event:1", "unknown", 2000);
  assert.equal(isMoveLocked(unknown, "event:1"), true);
  assert.equal(beginMove(unknown, "event:1", before, after, 3000), unknown);
});

test("a move Small confirmed no longer locks the event and a next move replaces it", () => {
  const awaiting = resolveMove(started(), "event:1", "applied", 2000);
  assert.equal(isMoveLocked(awaiting, "event:1"), false);
  const next = beginMove(
    awaiting,
    "event:1",
    after,
    { startsAt: "2026-10-29T04:30:00Z", endsAt: "2026-10-29T05:00:00Z" },
    3000,
  );
  assert.deepEqual(
    [next["event:1"]?.phase, next["event:1"]?.before, next["event:1"]?.since],
    ["saving", after, 3000],
  );
});

test("a refusal frees the event at once; applied and unknown keep the optimistic time", () => {
  assert.deepEqual(resolveMove(started(), "event:1", "refused", 2000), {});
  const awaiting = resolveMove(started(), "event:1", "applied", 2000);
  assert.deepEqual(
    [awaiting["event:1"]?.phase, awaiting["event:1"]?.since],
    ["awaiting", 2000],
  );
  const unknown = resolveMove(started(), "event:1", "unknown", 3000);
  assert.deepEqual(
    [unknown["event:1"]?.phase, moveBadge(unknown["event:1"]!)],
    ["unknown", "unknown"],
  );
  assert.equal(moveBadge(awaiting["event:1"]!), null);
  assert.equal(moveBadge(started()["event:1"]!), "saving");
  const untouched = started();
  assert.equal(resolveMove(untouched, "event:9", "refused", 1), untouched);
});

test("the overlay shows the new time, leaves others alone and keeps the list identity when idle", () => {
  const list = [event("event:1"), event("event:2")];
  assert.equal(overlayMoves(list, {}), list);
  assert.equal(overlayMoves(list, started()).length, 2);
  const shown = overlayMoves(list, started());
  assert.deepEqual(
    [shown[0]?.startsAt, shown[0]?.endsAt, shown[1]?.startsAt],
    [after.startsAt, after.endsAt, before.startsAt],
  );
  assert.equal(list[0]?.startsAt, before.startsAt);
});

test("a move that is still saving is never settled by data", () => {
  const moves = started(1000);
  const result = settleMoves(moves, [event("event:1", after)], 9999, 9999);
  assert.equal(result.moves, moves);
  assert.deepEqual(result.settled, []);
});

test("a confirmed move settles when the list shows the new time, equivalent offsets included", () => {
  const moves = resolveMove(started(), "event:1", "applied", 2000);
  const shifted = {
    startsAt: "2026-10-29T09:15:00+05:00",
    endsAt: "2026-10-29T09:45:00+05:00",
  };
  const result = settleMoves(moves, [event("event:1", shifted)], 2500, 2600);
  assert.deepEqual(result.settled, [
    { key: "event:1", phase: "awaiting", outcome: "confirmed" },
  ]);
  assert.deepEqual(result.moves, {});
});

test("a confirmed move waits while the list still shows the old time, then expires", () => {
  const moves = resolveMove(started(), "event:1", "applied", 2000);
  const waiting = settleMoves(moves, [event("event:1")], 2500, 2600);
  assert.equal(waiting.moves, moves);
  assert.deepEqual(waiting.settled, []);
  const expired = settleMoves(
    moves,
    [event("event:1")],
    2500,
    2000 + AWAITING_EXPIRES_MS + 1,
  );
  assert.deepEqual(
    expired.settled.map((item) => item.outcome),
    ["expired"],
  );
  assert.deepEqual(expired.moves, {});
});

test("an unknown move is decided by fresh data only", () => {
  const moves = resolveMove(started(), "event:1", "unknown", 2000);
  // A copy confirmed before the outcome became unknown proves nothing.
  const stale = settleMoves(moves, [event("event:1")], 1999, 5000);
  assert.equal(stale.moves, moves);
  assert.equal(settleMoves(moves, [event("event:1")], null, 5000).moves, moves);
  const reverted = settleMoves(moves, [event("event:1")], 2000, 5000);
  assert.deepEqual(
    reverted.settled.map((item) => item.outcome),
    ["reverted"],
  );
  const confirmed = settleMoves(moves, [event("event:1", after)], 2100, 5000);
  assert.deepEqual(
    confirmed.settled.map((item) => item.outcome),
    ["confirmed"],
  );
  const diverged = settleMoves(
    moves,
    [
      event("event:1", {
        startsAt: "2026-10-29T06:00:00Z",
        endsAt: "2026-10-29T06:30:00Z",
      }),
    ],
    2100,
    5000,
  );
  assert.deepEqual(
    diverged.settled.map((item) => item.outcome),
    ["diverged"],
  );
  const gone = settleMoves(moves, [event("event:2")], 2100, 5000);
  assert.deepEqual(
    gone.settled.map((item) => item.outcome),
    ["gone"],
  );
});

test("settling one move leaves the others in place", () => {
  let moves = beginMove(started(), "event:2", before, after, 1000);
  moves = resolveMove(moves, "event:1", "applied", 2000);
  const result = settleMoves(
    moves,
    [event("event:1", after), event("event:2")],
    3000,
    3000,
  );
  assert.deepEqual(Object.keys(result.moves), ["event:2"]);
  assert.equal(result.moves["event:2"]?.phase, "saving");
});
