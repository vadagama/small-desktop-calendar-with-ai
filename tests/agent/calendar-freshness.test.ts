import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeFreshness,
  type CalendarFreshnessInput,
} from "../../src/shared/calendar-freshness.js";
import { calendarChangeMarks } from "../../src/shared/calendar-change-marks.js";

// 09:00 in Asia/Almaty.
const at = Date.parse("2026-10-29T04:00:00Z");
const describe = (overrides: Partial<CalendarFreshnessInput> = {}) =>
  describeFreshness({
    fetchedAt: at,
    offline: false,
    refreshError: "",
    ...overrides,
  });

test("nothing confirmed means nothing to say", () => {
  assert.equal(describe({ fetchedAt: null }), null);
  assert.equal(describe({ fetchedAt: null, offline: true }), null);
});

test("while everything works the panel has nothing to say", () => {
  assert.equal(describe(), null);
});

test("lost contact and a failed refresh say when the data is from, in Almaty time", () => {
  assert.equal(
    describe({ offline: true }),
    "Нет связи с Small. Данные на 09:00",
  );
  assert.equal(
    describe({ refreshError: "down" }),
    "Не удалось обновить. Данные на 09:00",
  );
});

test("lost contact is the more important of the two", () => {
  assert.equal(
    describe({ offline: true, refreshError: "down" }),
    "Нет связи с Small. Данные на 09:00",
  );
});

test("marks cover every card of a changed event, skip a revealed one and ignore removals", () => {
  const cards: Record<string, string[]> = {
    "event:1": ["event:1:2026-10-29", "event:1:2026-10-30"],
    "event:2": ["event:2:2026-10-29"],
    "event:3": ["event:3:2026-10-29"],
  };
  const diff = {
    added: ["event:1"],
    changed: ["event:2"],
    moved: ["event:3"],
    removed: ["event:9"],
  };
  assert.deepEqual(
    calendarChangeMarks(diff, (key) => cards[key] ?? []),
    {
      "event:1:2026-10-29": "added",
      "event:1:2026-10-30": "added",
      "event:2:2026-10-29": "changed",
      "event:3:2026-10-29": "moved",
    },
  );
  assert.deepEqual(
    calendarChangeMarks(diff, (key) => cards[key] ?? [], "event:1:2026-10-30"),
    {
      "event:1:2026-10-29": "added",
      "event:2:2026-10-29": "changed",
      "event:3:2026-10-29": "moved",
    },
  );
  assert.deepEqual(
    calendarChangeMarks(
      { added: [], changed: [], moved: [], removed: ["event:1"] },
      (key) => cards[key] ?? [],
    ),
    {},
  );
});
