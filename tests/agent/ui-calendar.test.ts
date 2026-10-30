import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays,
  weekStart,
  monthDays,
} from "../../src/renderer/ui/calendar.js";

test("shared calendar navigates year boundaries and renders Monday-first leap months", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(weekStart("2026-11-01"), "2026-10-26");
  const days = monthDays("2028-02-15");
  assert.ok(days.includes("2028-02-29"));
  assert.equal(days.length % 7, 0);
  assert.equal(days[0], "2028-01-31");
});
