import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarSelection } from "../../prototype/src/calendar-selection.js";

test("cell click starts on a half hour and lasts thirty minutes", () => {
  assert.deepEqual(calendarSelection(615), { start: 600, duration: 30 });
  assert.deepEqual(calendarSelection(638), { start: 630, duration: 30 });
});
test("drag endpoint snaps to fifteen minutes", () => {
  assert.deepEqual(calendarSelection(600, 663), { start: 600, duration: 60 });
  assert.deepEqual(calendarSelection(600, 674), { start: 600, duration: 75 });
  assert.deepEqual(calendarSelection(600, 730), { start: 600, duration: 135 });
});
test("reverse selection and day boundaries stay valid", () => {
  assert.deepEqual(calendarSelection(600, 577), { start: 570, duration: 60 });
  assert.deepEqual(calendarSelection(1439, 1500), {
    start: 1410,
    duration: 30,
  });
  assert.deepEqual(calendarSelection(0, -60), { start: 0, duration: 30 });
});
test("selection respects the existing eight-hour creation limit", () => {
  assert.deepEqual(calendarSelection(600, 1300), { start: 600, duration: 480 });
  assert.deepEqual(calendarSelection(900, 0), { start: 450, duration: 480 });
});
