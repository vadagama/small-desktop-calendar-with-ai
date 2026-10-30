import { test } from "node:test";
import assert from "node:assert/strict";
import { recurrenceSummary } from "../../src/shared/recurrence-summary.js";

test("recurrence summaries show daily and weekly frequency, interval and selected days", () => {
  assert.equal(
    recurrenceSummary({ FREQ: "WEEKLY", INTERVAL: 2, BYDAY: ["FR"] }),
    "Каждые 2 недели: пт",
  );
  assert.equal(
    recurrenceSummary({ FREQ: "WEEKLY", BYDAY: ["MO", "WE"] }),
    "Каждую неделю: пн, ср",
  );
  assert.equal(
    recurrenceSummary({ FREQ: "WEEKLY", INTERVAL: 5 }),
    "Каждые 5 недель",
  );
  assert.equal(recurrenceSummary({ FREQ: "DAILY" }), "Каждый день");
  assert.equal(
    recurrenceSummary({ FREQ: "DAILY", INTERVAL: 3 }),
    "Каждые 3 дня",
  );
});

test("missing and unsupported rules do not invent a recurrence schedule", () => {
  assert.equal(recurrenceSummary(), "Повторяющееся событие");
  assert.equal(recurrenceSummary({ FREQ: "UNKNOWN" }), "Повторяющееся событие");
  assert.equal(
    recurrenceSummary({ FREQ: "WEEKLY", BYDAY: ["BAD"] }),
    "Повторяющееся событие",
  );
});

test("single weekday is described in natural Russian", () => {
  assert.equal(
    recurrenceSummary({ FREQ: "WEEKLY", BYDAY: ["SA"] }),
    "Каждую субботу",
  );
});
