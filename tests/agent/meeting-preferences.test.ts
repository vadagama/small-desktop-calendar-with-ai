import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveMeetingPreferences } from "../../src/main/meeting-preferences.js";
test("request overrides preset and memory per field, including zero and explicit exceptions", () => {
  const saved = { durationMinutes: 30, bufferMinutes: 15, timeFrom: "10:00" };
  assert.deepEqual(
    resolveMeetingPreferences(
      saved,
      { durationMinutes: 60, bufferMinutes: 0 },
      { durationMinutes: 45 },
    ).values,
    { durationMinutes: 60, timeFrom: "10:00", bufferMinutes: 0 },
  );
  assert.equal(
    resolveMeetingPreferences(saved, {}, { durationMinutes: 45 }).sources
      .durationMinutes,
    "preset",
  );
  assert.equal(
    resolveMeetingPreferences(saved, { ignoreTimeWindow: true }).values
      .timeFrom,
    undefined,
  );
  assert.equal(saved.durationMinutes, 30);
});
