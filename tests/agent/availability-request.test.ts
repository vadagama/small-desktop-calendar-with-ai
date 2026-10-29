import { test } from "node:test";
import assert from "node:assert/strict";
import { isAvailabilityRequest } from "../../src/main/availability-request.js";
const path = "/gate/team/api/calendar/events/find-slots";
const body = {
  participant_ids: ["synthetic-a"],
  duration_minutes: 30,
  start_date: "2026-10-29",
  timezone: "Asia/Almaty",
  include_weekends: false,
};
test("only the two read-only POST contracts are allowed", () => {
  assert.equal(isAvailabilityRequest(path, body), true);
  assert.equal(
    isAvailabilityRequest("/gate/team/api/calendar/events/busy-intervals", {
      participant_ids: ["synthetic-a"],
      date: "2026-10-29",
      timezone: "Asia/Almaty",
    }),
    true,
  );
  for (const candidate of [
    "/gate/team/api/calendar/events",
    path + "?force=true",
    "https://evil.invalid" + path,
    "/gate/team/api/calendar/events/from-template",
  ])
    assert.equal(isAvailabilityRequest(candidate, body), false);
  for (const candidate of [
    { ...body, force: true },
    { ...body, participant_ids: [] },
    { ...body, participant_ids: ["a", "a"] },
    { ...body, duration_minutes: 0 },
    { ...body, start_date: "2026-02-30" },
    { ...body, timezone: "UTC" },
  ])
    assert.equal(isAvailabilityRequest(path, candidate), false);
});
