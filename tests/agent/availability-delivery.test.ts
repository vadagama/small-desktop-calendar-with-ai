import { test } from "node:test";
import assert from "node:assert/strict";
import { AvailabilitySessions } from "../../src/main/availability-session.js";
import {
  analysisQuery,
  type AvailabilityOpening,
} from "../../src/shared/availability-analysis.js";
const opening: AvailabilityOpening = {
  kind: "availability-analysis",
  query: analysisQuery.parse({
    accountId: "a",
    participantIds: ["p"],
    date: "2026-11-10",
  }),
  people: [{ participantId: "p", name: "Тестовый", position: "" }],
};
test("availability state isolates owners, accounts and duplicate tool calls", () => {
  const state = new AvailabilitySessions();
  state.set(1, opening);
  assert.equal(state.context(2, "a"), undefined);
  assert.deepEqual(state.context(1, "a"), opening);
  assert.equal(state.deliver(1, "job", "call"), true);
  assert.equal(state.deliver(1, "job", "call"), false);
  assert.equal(state.deliver(1, "next-job", "call"), true);
  assert.equal(state.context(1, "b"), undefined);
  assert.equal(state.context(1, "a"), undefined);
});
test("closing blocks a late result but the next explicit prompt can open again", () => {
  const state = new AvailabilitySessions();
  state.set(1, opening);
  state.close(1, "job");
  assert.equal(state.deliver(1, "job", "late"), false);
  assert.equal(state.deliver(1, "new-job", "new-call"), true);
  state.set(1, opening);
  state.clear();
  assert.equal(state.context(1, "a"), undefined);
});

test("closed or empty dashboard drops its confirmed selection from the conversation", async () => {
  const { CalendarConversation } =
    await import("../../src/main/calendar-conversation.js");
  const state = new CalendarConversation();
  state.availability = opening;
  state.selected = ["p"];
  state.selectionConfirmed = true;
  state.clearAvailability();
  assert.equal(state.availability, undefined);
  assert.deepEqual(state.selected, []);
  assert.equal(state.selectionConfirmed, false);
  state.selected = ["other-catalog-selection"];
  state.clearAvailability();
  assert.deepEqual(state.selected, ["other-catalog-selection"]);
});
