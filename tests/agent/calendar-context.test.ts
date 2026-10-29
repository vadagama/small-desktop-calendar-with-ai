import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarClock } from "../../src/agent/calendar-context.js";
test("relative day anchors use Almaty midnight and cross year boundaries", () => {
  const text = calendarClock("2026-12-31T19:30:00Z");
  assert.ok(text.includes("Сегодня: 2027-01-01"));
  assert.ok(text.includes("Завтра: 2027-01-02"));
  assert.ok(text.includes("2027-01-02 — суббота"));
});
