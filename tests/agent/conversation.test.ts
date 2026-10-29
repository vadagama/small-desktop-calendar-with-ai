import assert from "node:assert/strict";
import { test } from "node:test";
import { CalendarConversation } from "../../src/main/calendar-conversation.js";

test("conversation retains complete turns and clears evidence on account switch", () => {
  const state = new CalendarConversation();
  state.bindAccount("a");
  state.commit("завтра", [{ role: "assistant", content: "Кого пригласить?" }]);
  assert.equal(state.messages.length, 2);
  state.people.set("p", { participantId: "p", name: "Тест", position: "" });
  state.selected = ["p"];
  state.bindAccount("b");
  assert.deepEqual(state.messages, []);
  assert.equal(state.people.size, 0);
  assert.deepEqual(state.selected, []);
});
