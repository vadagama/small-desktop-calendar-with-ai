import { test } from "node:test";
import assert from "node:assert/strict";
import {
  endAfterDuration,
  meetingDuration,
} from "../../src/shared/meeting-time.js";

test("duration helpers calculate the end from the start, including midnight", () => {
  for (const [duration, end] of [
    [15, "14:15"],
    [30, "14:30"],
    [60, "15:00"],
    [90, "15:30"],
    [120, "16:00"],
  ] as const)
    assert.equal(endAfterDuration("14:00", duration), end);
  assert.equal(endAfterDuration("23:45", 90), "01:15");
  assert.equal(endAfterDuration("14:07", 15), "14:22");
});

test("duration rejects invalid clocks and measures overnight intervals", () => {
  assert.equal(endAfterDuration("", 30), null);
  assert.equal(endAfterDuration("24:00", 30), null);
  assert.equal(meetingDuration("23:45", "01:15"), 90);
  assert.equal(meetingDuration("14:00", "14:00"), 0);
  assert.ok(Number.isNaN(meetingDuration("no", "14:00")));
});
