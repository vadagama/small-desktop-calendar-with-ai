import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutEvents } from "../../prototype/src/event-layout.js";
test("overlapping events share columns; touching intervals use full width", () => {
  const events = [
    { id: "a", start: 600, duration: 60 },
    { id: "b", start: 600, duration: 30 },
    { id: "c", start: 630, duration: 30 },
    { id: "d", start: 660, duration: 30 },
  ];
  const result = layoutEvents(events);
  assert.deepEqual(
    result.map(({ column, columns }) => [column, columns]),
    [
      [0, 2],
      [1, 2],
      [1, 2],
      [0, 1],
    ],
  );
});
test("nested and chained overlaps have stable non-overlapping columns", () => {
  const result = layoutEvents([
    { id: "a", start: 600, duration: 120 },
    { id: "b", start: 610, duration: 30 },
    { id: "c", start: 620, duration: 40 },
  ]);
  assert.deepEqual(
    result.map(({ column, columns }) => [column, columns]),
    [
      [0, 3],
      [1, 3],
      [2, 3],
    ],
  );
});
