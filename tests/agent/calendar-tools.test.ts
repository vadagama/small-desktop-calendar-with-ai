import assert from "node:assert/strict";
import { test } from "node:test";
import { createCalendarToolExecutor } from "../../src/main/calendar-tools.js";

const query = {
  participantIds: ["person-a"],
  date: "2026-11-02",
  durationMinutes: 30,
};
function setup(prompt = "Участники: [person-a]") {
  const calls: unknown[] = [];
  const controller = new AbortController();
  const execute = createCalendarToolExecutor(
    "account-a",
    prompt,
    controller.signal,
    {
      searchPeople: async (input: unknown) => {
        calls.push(input);
        return { people: [], page: 1, nextPage: null };
      },
    },
    {
      find: async (input: unknown) => {
        calls.push(input);
        return { ...query, slots: [], timezone: "Asia/Almaty" as const };
      },
    },
  );
  return { execute, calls, controller };
}
test("binds calendar tools to the account captured outside model input", async () => {
  const { execute, calls } = setup();
  const result = await execute("findSlots", query);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ ...query, accountId: "account-a" }]);
});
test("rejects invented participants and partial matches before reading availability", async () => {
  for (const prompt of [
    "Найди время для команды",
    "Участники: [person-ab]",
    "Участники: [person-a, person-b]",
  ]) {
    const { execute, calls } = setup(prompt);
    assert.equal((await execute("findSlots", query)).ok, false);
    assert.equal(calls.length, 0);
  }
});
test("rejects account injection, unknown tools and extra parameters", async () => {
  const { execute, calls } = setup();
  for (const [name, input] of [
    ["findSlots", { ...query, accountId: "other" }],
    ["deleteEvent", {}],
    ["searchPeople", { query: "A", page: 1, url: "https://invalid" }],
  ] as const)
    assert.equal((await execute(name, input)).ok, false);
  assert.equal(calls.length, 0);
});
test("cancelled jobs cannot start calendar reads", async () => {
  const { execute, calls, controller } = setup();
  controller.abort();
  await assert.rejects(execute("findSlots", query), { name: "AbortError" });
  assert.equal(calls.length, 0);
});
test("unexpected failures do not leak service details", async () => {
  const execute = createCalendarToolExecutor(
    "a",
    "",
    new AbortController().signal,
    {
      searchPeople: async () => {
        throw new Error("private server payload");
      },
    },
    {
      find: async () => {
        throw new Error("unused");
      },
    },
  );
  const result = await execute("searchPeople", { query: "Тест", page: 1 });
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes("private"));
});

test("discards a successful calendar response arriving after cancellation", async () => {
  const controller = new AbortController();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const execute = createCalendarToolExecutor(
    "account-a",
    "",
    controller.signal,
    {
      searchPeople: async () => {
        await waiting;
        return { people: [], page: 1, nextPage: null };
      },
    },
    {
      find: async () => {
        throw new Error("unused");
      },
    },
  );
  const result = execute("searchPeople", { query: "Тест", page: 1 });
  controller.abort();
  release();
  await assert.rejects(result, { name: "AbortError" });
});
