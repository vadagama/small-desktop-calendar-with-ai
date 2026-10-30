import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { WindowConversations } from "../../src/main/window-conversations.js";

test("completed conversations leave memory when their window is destroyed", () => {
  const conversations = new WindowConversations();
  for (let id = 0; id < 20; id++) {
    const owner = Object.assign(new EventEmitter(), { id });
    const first = conversations.get(owner, "one");
    first.commit("synthetic", []);
    assert.equal(conversations.get(owner, "one"), first);
    assert.notEqual(conversations.get(owner, "two"), first);
    conversations.clear();
    conversations.get(owner, "three");
    assert.equal(owner.listenerCount("destroyed"), 1);
    assert.equal(conversations.size, 1);
    owner.emit("destroyed");
    assert.equal(conversations.size, 0);
  }
});
