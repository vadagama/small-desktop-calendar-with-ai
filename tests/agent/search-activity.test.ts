import assert from "node:assert/strict";
import { test } from "node:test";
import type { UIMessage, ToolUIPart } from "ai";
import {
  groupSearchActivity,
  searchActivityStatus,
} from "../../src/renderer/search-activity.js";

const search = (id: string, ok = true): ToolUIPart => ({
  type: "tool-searchPeople",
  toolCallId: id,
  state: "output-available",
  input: { query: "Тест", page: 1 },
  output: { ok },
});

test("search retries and participant selection share a group across SDK steps", () => {
  const parts: UIMessage["parts"] = [
    search("1"),
    { type: "step-start" },
    {
      type: "tool-selectParticipants",
      toolCallId: "2",
      state: "output-error",
      input: {},
      errorText: "synthetic failure",
    },
    { type: "step-start" },
    search("3"),
  ];
  const groups = groupSearchActivity(parts);
  assert.equal(groups.length, 1);
  assert.ok(Array.isArray(groups[0]));
  assert.equal(groups[0].length, 3);
  assert.equal(searchActivityStatus(groups[0], false), "Завершён");
  assert.equal(searchActivityStatus(groups[0], true), "Выполняется");
});

test("visible text and other tools separate search groups without losing parts", () => {
  const text = { type: "text", text: "Уточнение" } as const;
  const other = {
    type: "tool-findSlots",
    toolCallId: "slot",
    state: "input-available",
    input: {},
  } as const;
  const groups = groupSearchActivity([
    search("1"),
    text,
    search("2"),
    other,
    search("3"),
  ]);
  assert.equal(groups.length, 5);
  assert.equal(groups[1], text);
  assert.equal(groups[3], other);
});

test("search status covers errors, pending input and cancellation", () => {
  assert.equal(
    searchActivityStatus([search("1", false)], false),
    "Не завершён",
  );
  const pending = {
    type: "dynamic-tool",
    toolName: "searchPeople",
    toolCallId: "2",
    state: "input-available",
    input: {},
  } as const;
  assert.equal(searchActivityStatus([pending], true), "Выполняется");
  assert.equal(searchActivityStatus([pending], false), "Прерван");
  assert.ok(Array.isArray(groupSearchActivity([pending])[0]));
});
