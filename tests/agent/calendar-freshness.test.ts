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
    now: at,
    offline: false,
    refreshError: "",
    refreshing: false,
    ...overrides,
  });
const minutes = (count: number) => at + count * 60_000;

test("nothing confirmed means no label", () => {
  assert.equal(describe({ fetchedAt: null }), null);
});

test("age is rounded down and a clock that is behind never goes negative", () => {
  assert.equal(describe()?.text, "Обновлено только что");
  assert.equal(describe({ now: at + 59_999 })?.text, "Обновлено только что");
  assert.equal(describe({ now: at - 5_000 })?.text, "Обновлено только что");
  assert.equal(describe({ now: minutes(1) })?.text, "Обновлено 1 минуту назад");
});

test("Russian plural forms of minutes", () => {
  const forms: Record<number, string> = {
    1: "минуту",
    2: "минуты",
    4: "минуты",
    5: "минут",
    11: "минут",
    12: "минут",
    14: "минут",
    21: "минуту",
    22: "минуты",
    25: "минут",
    59: "минут",
  };
  for (const [count, word] of Object.entries(forms))
    assert.equal(
      describe({ now: minutes(Number(count)) })?.text,
      `Обновлено ${count} ${word} назад`,
      count,
    );
});

test("an hour or older switches to the clock time in Almaty", () => {
  assert.equal(describe({ now: minutes(60) })?.text, "Обновлено в 09:00");
  assert.equal(describe({ now: minutes(600) })?.text, "Обновлено в 09:00");
});

test("offline, a failed refresh and an ongoing refresh are described separately", () => {
  assert.deepEqual(describe({ offline: true }), {
    text: "Нет связи с Small. Данные на 09:00",
    tone: "warning",
  });
  assert.deepEqual(describe({ refreshError: "down" }), {
    text: "Не удалось обновить. Данные на 09:00",
    tone: "warning",
  });
  assert.deepEqual(describe({ refreshing: true, offline: true }), {
    text: "Обновляю…",
    tone: "fresh",
  });
  assert.equal(describe({ now: minutes(3) })?.tone, "fresh");
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
