import { ParticipantMemory } from "../../src/main/participant-memory.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { AssistantMemoryStore } from "../../src/main/assistant-memory.js";
import { MemoryProposals } from "../../src/main/memory-proposals.js";
import { CalendarConversation } from "../../src/main/calendar-conversation.js";
import { createCalendarToolExecutor } from "../../src/main/calendar-tools.js";
import { runMemoryTool } from "../../src/main/memory-tools.js";

function setup() {
  const values = new Map<string, string>();
  const store = new AssistantMemoryStore("/nonexistent", {
    get: async (k) => values.get(k) ?? null,
    set: async (k, v) => {
      values.set(k, v);
    },
    remove: async (k) => {
      values.delete(k);
    },
  });
  const conversation = new CalendarConversation();
  conversation.bindAccount("a");
  const person = {
    participantId: "person-a",
    name: "Тестовый",
    position: "Тест",
  };
  const calendar: Pick<
    import("../../src/main/calendar.js").CalendarService,
    "events" | "searchPeople"
  > = {
    events: async () => ({ events: [], issues: [] }),
    searchPeople: async () => ({ people: [person], page: 1, nextPage: null }),
  };
  const signal = new AbortController().signal;
  const context: import("../../src/main/memory-tools.js").MemoryToolContext = {
    store,
    proposals: new MemoryProposals(store),
    ownerId: 1,
    epoch: 1,
    messageId: "test",
  };
  const calls: Record<string, unknown>[] = [];
  const execute = (prompt: string) =>
    createCalendarToolExecutor(
      "a",
      prompt,
      signal,
      calendar,
      {
        find: async (input: unknown) => {
          calls.push(input as Record<string, unknown>);
          return {
            participantIds: ["person-a", "organizer"],
            date: "2099-11-02",
            durationMinutes: 30,
            timezone: "Asia/Almaty" as const,
            slots: [
              {
                start: "2099-11-02T05:00:00.000Z",
                end: new Date(
                  Date.parse("2099-11-02T05:00:00.000Z") +
                    Number((input as Record<string, unknown>).durationMinutes) *
                      60000,
                ).toISOString(),
              },
            ],
          };
        },
      },
      "Тестовый организатор",
      undefined,
      conversation,
      new ParticipantMemory("/nonexistent", store),
      "organizer",
      undefined,
      undefined,
      context,
    );
  return {
    store,
    conversation,
    context,
    calendar,
    signal,
    person,
    execute,
    calls,
  };
}
test("main applies defaults, explicit task persists across turns and changed memory invalidates composition", async () => {
  const s = setup();
  let state = await s.store.read("a");
  state = await s.store.write("a", {
    revision: state.revision,
    requestId: randomUUID(),
    change: {
      action: "preferences",
      value: { durationMinutes: 30, timeFrom: "10:00", bufferMinutes: 15 },
    },
  });
  s.conversation.forgetMemoryEvidence(state.revision);
  let execute = s.execute("Найди время с Тестовым");
  await execute("searchPeople", { query: "Тестовый", page: 1 });
  await execute("selectParticipants", { participantIds: ["person-a"] });
  const query = { participantIds: ["person-a"], date: "2099-11-02" };
  assert.equal((await execute("findSlots", query)).ok, true);
  assert.equal(s.calls.at(-1)?.durationMinutes, 30);
  assert.equal(s.calls.at(-1)?.timeFrom, "10:00");
  assert.equal(s.calls.at(-1)?.bufferMinutes, 15);
  execute = s.execute("На час, в 09:00 без перерыва");
  assert.equal(
    (
      await execute("assistantMemory", {
        action: "task",
        evidence: "На час, в 09:00 без перерыва",
        preferences: { durationMinutes: 60 },
        ignoreTimeWindow: true,
        ignoreBuffer: true,
      })
    ).ok,
    true,
  );
  assert.equal(
    (await execute("findSlots", { ...query, timeFrom: "10:00" })).ok,
    true,
  );
  assert.equal(s.calls.at(-1)?.durationMinutes, 60);
  assert.equal(s.calls.at(-1)?.timeFrom, undefined);
  assert.equal(s.calls.at(-1)?.bufferMinutes, 0);
  execute = s.execute("Покажи ещё варианты");
  await execute("findSlots", query);
  assert.equal(s.calls.at(-1)?.durationMinutes, 60);
  assert.equal((await s.store.read("a")).preferences.durationMinutes, 30);
  s.conversation.commit("old context", [
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolName: "assistantMemory",
          toolCallId: "test",
          input: { action: "recall" },
        },
      ],
    },
  ]);
  state = await s.store.write("a", {
    revision: state.revision,
    requestId: randomUUID(),
    change: { action: "clear", category: "all" },
  });
  s.conversation.forgetMemoryEvidence(state.revision);
  assert.deepEqual(s.conversation.messages, []);
  assert.deepEqual(s.conversation.selected, []);
  assert.equal((await s.execute("Продолжи")("findSlots", query)).ok, false);
  s.conversation.bindAccount("b");
  assert.deepEqual(s.conversation.taskPreferences, {});
});
test("recall is bounded; collisions and invented task evidence require clarification", async () => {
  const s = setup();
  let state = await s.store.read("a");
  for (let i = 0; i < 12; i++)
    state = await s.store.write("a", {
      revision: state.revision,
      requestId: randomUUID(),
      change: { action: "entry", text: `${i}: ${"т".repeat(1800)}` },
    });
  const recall = await runMemoryTool(
    { action: "recall" },
    s.context,
    "a",
    "Вопрос",
    s.conversation,
    s.calendar,
    s.signal,
  );
  assert.ok("truncated" in recall && recall.truncated);
  assert.ok(JSON.stringify(recall).length < 15000);
  await assert.rejects(
    runMemoryTool(
      {
        action: "task",
        evidence: "на час",
        preferences: { durationMinutes: 60 },
      },
      s.context,
      "a",
      "на полчаса",
      s.conversation,
      s.calendar,
      s.signal,
    ),
    /точную цитату/,
  );
  state = await s.store.write("a", {
    revision: state.revision,
    requestId: randomUUID(),
    change: {
      action: "group",
      value: {
        name: "Тестовый",
        participantIds: [s.person.participantId],
        people: [s.person],
      },
    },
  });
  await assert.rejects(
    runMemoryTool(
      { action: "useGroup", query: "Тестовый" },
      s.context,
      "a",
      "Встреча с Тестовым",
      s.conversation,
      s.calendar,
      s.signal,
    ),
    /человек или/,
  );
  const result = await runMemoryTool(
    { action: "useGroup", query: "Тестовый" },
    s.context,
    "a",
    "Встреча для группы Тестовый",
    s.conversation,
    s.calendar,
    s.signal,
  );
  assert.equal(result.kind, "memory-selection");
  assert.deepEqual(s.conversation.selected, [s.person.participantId]);
});

test("preset expands current group, supplies title and agenda; request overrides its duration without enabling recurrence", async () => {
  const s = setup();
  let state = await s.store.read("a");
  const write = async (change: unknown) =>
    (state = await s.store.write("a", {
      revision: state.revision,
      requestId: randomUUID(),
      change,
    }));
  await write({
    action: "preferences",
    value: { durationMinutes: 30, bufferMinutes: 15 },
  });
  await write({
    action: "group",
    value: {
      name: "Команда",
      participantIds: [s.person.participantId],
      people: [s.person],
    },
  });
  await write({
    action: "preset",
    value: {
      name: "Еженедельный синк",
      title: "Синк",
      agenda: "План",
      durationMinutes: 45,
      groupId: state.groups[0]!.id,
    },
  });
  s.conversation.forgetMemoryEvidence(state.revision);
  const execute = s.execute("Подготовь формат Еженедельный синк на час");
  assert.equal(
    (
      await execute("assistantMemory", {
        action: "usePreset",
        query: "Еженедельный синк",
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await execute("assistantMemory", {
        action: "task",
        evidence: "на час",
        preferences: { durationMinutes: 60 },
      })
    ).ok,
    true,
  );
  const result = await execute("prepareMeetingDraft", {
    participantIds: [s.person.participantId],
    startsAt: "2099-11-02T05:00:00.000Z",
    location: "",
    conference: { mode: "none" },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (
    !result.ok ||
    !("kind" in result.data) ||
    result.data.kind !== "meeting-draft"
  )
    throw Error("expected draft");
  assert.equal(result.data.durationMinutes, 60);
  assert.equal(result.data.title, "Синк");
  assert.equal(result.data.agenda, "План");
  assert.equal(result.data.recurrence, "none");
  assert.equal(result.data.memoryPolicy?.bufferMinutes, 15);
  assert.deepEqual(result.data.participantIds.sort(), [
    "organizer",
    "person-a",
  ]);
});

test("a group selection can subsequently bind a confirmed participant nickname", async () => {
  const s = setup();
  let state = await s.store.read("a");
  state = await s.store.write("a", {
    revision: state.revision,
    requestId: randomUUID(),
    change: {
      action: "group",
      value: {
        name: "Команда",
        participantIds: [s.person.participantId],
        people: [s.person],
      },
    },
  });
  s.conversation.forgetMemoryEvidence(state.revision);
  const execute = s.execute("Запомни: участник группы Команда — Тест");
  await execute("assistantMemory", { action: "useGroup", query: "Команда" });
  await execute("assistantMemory", { action: "recall" });
  await execute("assistantMemory", {
    action: "review",
    questions: [],
    change: { action: "entry", text: `Тест — ${s.person.name}.` },
  });
  const proposal = await execute("participantMemory", {
    action: "remember",
    participantId: s.person.participantId,
    alias: "Тест",
  });
  assert.ok(
    proposal.ok &&
      "kind" in proposal.data &&
      proposal.data.kind === "memory-proposal",
  );
  if (
    !proposal.ok ||
    !("kind" in proposal.data) ||
    proposal.data.kind !== "memory-proposal"
  )
    throw Error("expected proposal");
  await s.context.proposals.confirm("a", proposal.data.id, 1, 1, () => {});
  assert.deepEqual((await s.store.read("a")).participants[0]?.aliases, [
    "Тест",
  ]);
});

test("memory proposals reject unknown edit ids before showing a confirmation card and allow corrected creates", async () => {
  const s = setup();
  const execute = s.execute("Запомни контекст, группу и формат");
  await execute("searchPeople", { query: "Тестовый", page: 1 });
  await execute("selectParticipants", {
    participantIds: [s.person.participantId],
  });
  const changes = [
    {
      action: "entry",
      text: "Встречи с коллегами после обеда, личные — в любое время.",
    },
    {
      action: "group",
      value: { name: "Команда", participantIds: [s.person.participantId] },
    },
    { action: "preset", value: { name: "Синк", durationMinutes: 30 } },
  ];
  for (const change of changes) {
    await execute("assistantMemory", { action: "recall" });
    await execute("assistantMemory", {
      action: "review",
      questions: [],
      change: { ...change, id: "invented-id" },
    });
    const invalid = await execute("assistantMemory", {
      action: "propose",
      change: { ...change, id: "invented-id" },
    });
    assert.equal(
      invalid.ok,
      false,
      "an unknown id must not produce a broken card",
    );
    if (invalid.ok) throw Error("expected invalid proposal");
    assert.match(invalid.error, /без id/);
    await execute("assistantMemory", {
      action: "review",
      questions: [],
      change,
    });
    const result = await execute("assistantMemory", {
      action: "propose",
      change,
    });
    assert.ok(
      result.ok &&
        "kind" in result.data &&
        result.data.kind === "memory-proposal",
    );
    if (
      !result.ok ||
      !("kind" in result.data) ||
      result.data.kind !== "memory-proposal"
    )
      throw Error("expected proposal");
    await s.context.proposals.confirm("a", result.data.id, 1, 1, () => {});
  }
  const state = await s.store.read("a");
  assert.equal(state.entries.length, 1);
  assert.equal(state.groups.length, 1);
  assert.equal(state.presets.length, 1);
  assert.deepEqual(state.groups[0]?.people, [s.person]);
  await execute("assistantMemory", { action: "recall" });
  await execute("assistantMemory", {
    action: "review",
    questions: [],
    change: {
      action: "entry",
      id: state.entries[0]!.id,
      text: "Уточнённый контекст",
    },
  });
  const result = await execute("assistantMemory", {
    action: "propose",
    change: {
      action: "entry",
      id: state.entries[0]!.id,
      text: "Уточнённый контекст",
    },
  });
  if (
    !result.ok ||
    !("kind" in result.data) ||
    result.data.kind !== "memory-proposal"
  )
    throw Error("expected edit proposal");
  const updated = await s.context.proposals.confirm(
    "a",
    result.data.id,
    1,
    1,
    () => {},
  );
  assert.equal(updated.entries.length, 1);
  assert.equal(updated.entries[0]?.text, "Уточнённый контекст");
});

test("memory clarification blocks proposals until a later answer is reviewed, without repeating remember", async () => {
  const s = setup();
  const initial = s.execute("Запомни: синк команды после обеда");
  const change = { action: "entry", text: "Синк команды после обеда." };
  assert.equal(
    (await initial("assistantMemory", { action: "propose", change })).ok,
    false,
  );
  await initial("assistantMemory", { action: "recall" });
  const review = await initial("assistantMemory", {
    action: "review",
    change,
    questions: ["После обеда — начиная с какого времени?"],
  });
  assert.equal(review.ok, true, JSON.stringify(review));
  assert.equal(
    (await initial("assistantMemory", { action: "propose", change })).ok,
    false,
  );
  assert.equal(
    (
      await initial("assistantMemory", {
        action: "review",
        change,
        questions: [],
      })
    ).ok,
    false,
  );
  assert.equal((await s.store.read("a")).entries.length, 0);
  const answer = s.execute("С 14:00");
  const clarified = {
    action: "entry",
    text: "Синк команды предлагать начиная с 14:00 по Алматы.",
  };
  assert.equal(
    (
      await answer("assistantMemory", {
        action: "review",
        change: clarified,
        questions: [],
        evidence: "С 14:00",
      })
    ).ok,
    true,
  );
  const proposal = await answer("assistantMemory", {
    action: "propose",
    change: clarified,
  });
  if (
    !proposal.ok ||
    !("kind" in proposal.data) ||
    proposal.data.kind !== "memory-proposal"
  )
    throw Error(JSON.stringify(proposal));
  assert.equal((await s.store.read("a")).entries.length, 0);
  const saved = await s.context.proposals.confirm(
    "a",
    proposal.data.id,
    1,
    1,
    () => {},
  );
  assert.equal(saved.entries[0]?.text, clarified.text);
});

test("memory review cannot authorize changed text, a different session, stale memory or cancelled clarification", async () => {
  const s = setup();
  let execute = s.execute("Запомни тестовый контекст");
  const change = { action: "entry", text: "Тестовый контекст" };
  const inspect = async () => {
    await execute("assistantMemory", { action: "recall" });
    return execute("assistantMemory", {
      action: "review",
      change,
      questions: [],
    });
  };
  assert.equal((await inspect()).ok, true);
  assert.equal(
    (
      await execute("assistantMemory", {
        action: "propose",
        change: { ...change, text: "Другое" },
      })
    ).ok,
    false,
  );
  s.context.epoch++;
  assert.equal(
    (await execute("assistantMemory", { action: "propose", change })).ok,
    false,
  );
  assert.equal((await inspect()).ok, true);
  const state = await s.store.read("a");
  await s.store.write("a", {
    revision: state.revision,
    requestId: randomUUID(),
    change: { action: "preferences", value: { durationMinutes: 25 } },
  });
  assert.equal(
    (await execute("assistantMemory", { action: "propose", change })).ok,
    false,
  );
  assert.equal((await inspect()).ok, true);
  await execute("assistantMemory", { action: "cancel" });
  assert.equal(
    (await execute("assistantMemory", { action: "propose", change })).ok,
    false,
  );
  execute = s.execute("На 30 минут");
  assert.equal((await inspect()).ok, false);
});

test("review requires current recall and actual answer evidence; partial answers leave memory unchanged", async () => {
  const s = setup();
  const change = { action: "entry", text: "Команда встречается после обеда" };
  const initial = s.execute("Запомни: команда встречается после обеда");
  assert.equal(
    (
      await initial("assistantMemory", {
        action: "review",
        change,
        questions: [],
      })
    ).ok,
    false,
  );
  await initial("assistantMemory", { action: "recall" });
  await initial("assistantMemory", {
    action: "review",
    change,
    questions: ["Какая команда?", "Начиная с какого времени?"],
  });
  const answer = s.execute("Команда разработки");
  assert.equal(
    (
      await answer("assistantMemory", {
        action: "review",
        change,
        questions: [],
        evidence: "С 14:00",
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await answer("assistantMemory", {
        action: "review",
        change,
        questions: ["Начиная с какого времени?"],
        evidence: "Команда разработки",
      })
    ).ok,
    true,
  );
  assert.equal(
    (await answer("assistantMemory", { action: "propose", change })).ok,
    false,
  );
  assert.deepEqual((await s.store.read("a")).entries, []);
});

test("a negative clarification and account change revoke memory intent", async () => {
  const s = setup();
  const change = { action: "entry", text: "Тестовый контекст" };
  let execute = s.execute("Запомни тестовый контекст");
  await execute("assistantMemory", { action: "recall" });
  await execute("assistantMemory", {
    action: "review",
    change,
    questions: ["Для всех встреч?"],
  });
  execute = s.execute("Не сохраняй");
  assert.equal(
    (
      await execute("assistantMemory", {
        action: "review",
        change,
        questions: [],
        evidence: "Не сохраняй",
      })
    ).ok,
    false,
  );
  assert.equal(
    (await execute("assistantMemory", { action: "propose", change })).ok,
    false,
  );
  s.conversation.bindAccount("b");
  s.conversation.bindAccount("a");
  execute = s.execute("Да");
  await execute("assistantMemory", { action: "recall" });
  assert.equal(
    (
      await execute("assistantMemory", {
        action: "review",
        change,
        questions: [],
        evidence: "Да",
      })
    ).ok,
    false,
  );
});

test("participant nicknames cannot bypass semantic review", async () => {
  const s = setup();
  const execute = s.execute("Запомни: Тест — Тестовый");
  await execute("searchPeople", { query: "Тестовый", page: 1 });
  await execute("selectParticipants", {
    participantIds: [s.person.participantId],
  });
  assert.equal(
    (
      await execute("participantMemory", {
        action: "remember",
        participantId: s.person.participantId,
        alias: "Тест",
      })
    ).ok,
    false,
  );
  assert.deepEqual((await s.store.read("a")).entries, []);
});

test("each model turn receives current memory before any directory search", async () => {
  const { streamCalendarTurn } =
    await import("../../src/agent/calendar-runtime.js");
  const { MockLanguageModelV4 } = await import("ai/test");
  const { simulateReadableStream } = await import("ai");
  const s = setup();
  let state = await s.store.read("a");
  state = await s.store.write("a", {
    revision: state.revision,
    requestId: randomUUID(),
    change: {
      action: "group",
      value: {
        name: "Синтетическая команда",
        participantIds: [s.person.participantId],
        people: [s.person],
      },
    },
  });
  const groupId = state.groups[0]!.id;
  const calls: string[] = [];
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      assert.deepEqual(calls, ["assistantMemory"]);
      const context = JSON.stringify(options.prompt);
      assert.ok(
        context.includes(groupId),
        "saved group must be available before the first model request",
      );
      assert.ok(context.includes("Синтетическая команда"));
      return {
        stream: simulateReadableStream({
          initialDelayInMs: null,
          chunkDelayInMs: null,
          chunks: [
            {
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              usage: {
                inputTokens: {
                  total: 1,
                  noCache: 1,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: { total: 1, text: 1, reasoning: undefined },
              },
            },
          ],
        }),
      };
    },
  });
  const result = await streamCalendarTurn(
    model,
    {
      prompt: "Поставь встречу с синтетической командой на субботу",
      abortSignal: s.signal,
    },
    async (name, input) => {
      calls.push(name);
      assert.equal(name, "assistantMemory");
      assert.deepEqual(input, { action: "recall" });
      return s.execute("Встреча с синтетической командой")(name, input);
    },
  );
  await result.consumeStream();
  assert.equal(model.doStreamCalls.length, 1);
  assert.deepEqual(calls, ["assistantMemory"]);
});

test("explicit tool duration overrides saved defaults and survives a follow-up", async () => {
  const s = setup();
  let state = await s.store.read("a");
  state = await s.store.write("a", {
    revision: state.revision,
    requestId: randomUUID(),
    change: { action: "preferences", value: { durationMinutes: 25 } },
  });
  s.conversation.forgetMemoryEvidence(state.revision);
  let execute = s.execute("Копия на час");
  await execute("searchPeople", { query: "Тестовый", page: 1 });
  await execute("selectParticipants", { participantIds: ["person-a"] });
  const query = { participantIds: ["person-a"], date: "2099-11-02" };
  assert.equal(
    (await execute("findSlots", { ...query, durationMinutes: 60 })).ok,
    true,
  );
  assert.equal(s.calls.at(-1)?.durationMinutes, 60);
  execute = s.execute("да");
  const draft = await execute("prepareMeetingDraft", {
    participantIds: ["person-a"],
    title: "Синтетическая копия",
    agenda: "",
    startsAt: "2099-11-02T05:00:00Z",
    location: "",
    conference: { mode: "none" },
  });
  assert.equal(draft.ok, true);
  assert.equal(s.calls.at(-1)?.durationMinutes, 60);
  assert.equal((await s.store.read("a")).preferences.durationMinutes, 25);
});

test("numbered task choices apply once and preserve participants", async () => {
  const s = setup();
  const state = await s.store.read("a");
  s.conversation.forgetMemoryEvidence(state.revision);
  let execute = s.execute("Найди время");
  await execute("searchPeople", { query: "Тестовый", page: 1 });
  await execute("selectParticipants", { participantIds: ["person-a"] });
  const offered = await execute("assistantMemory", {
    action: "offerTask",
    options: [
      { label: "Час", preferences: { durationMinutes: 60 } },
      { label: "55 минут", preferences: { durationMinutes: 55 } },
    ],
  });
  assert.equal(offered.ok, true);
  execute = s.execute("2");
  assert.equal(
    (
      await execute("findSlots", {
        participantIds: ["person-a"],
        date: "2099-11-02",
      })
    ).ok,
    true,
  );
  assert.equal(s.calls.at(-1)?.durationMinutes, 55);
  assert.deepEqual(s.conversation.selected, ["person-a"]);
  // An unrelated new task cannot accidentally reuse the old menu.
  await s.execute("Другая встреча")("assistantMemory", {
    action: "task",
    resetTask: true,
    evidence: "Другая встреча",
  });
  assert.equal(s.conversation.taskPreferences.durationMinutes, undefined);
});

test("confirmed parameters can cite earlier user messages, but bare confirmation cannot invent them", async () => {
  const s = setup();
  s.conversation.commit("На час", []);
  const execute = s.execute("да");
  const accepted = await execute("assistantMemory", {
    action: "task",
    evidence: "На час",
    preferences: { durationMinutes: 60 },
  });
  assert.equal(accepted.ok, true);
  const invented = await execute("assistantMemory", {
    action: "task",
    evidence: "да",
    preferences: { durationMinutes: 55 },
  });
  assert.equal(invented.ok, false);
  assert.equal(s.conversation.taskPreferences.durationMinutes, 60);
});

test("an explicit saved group id checks members without searching the group name", async () => {
  const s = setup();
  let state = await s.store.read("a");
  state = await s.store.write("a", {
    revision: state.revision,
    requestId: randomUUID(),
    change: {
      action: "group",
      value: {
        name: "Синтетическая команда",
        participantIds: [s.person.participantId],
        people: [s.person],
      },
    },
  });
  const queries: string[] = [];
  s.context.directory = {
    searchPeople: async (input: unknown) => {
      const query = (input as { query: string }).query;
      queries.push(query);
      if (query !== s.person.name) throw new Error("role search unavailable");
      return { people: [s.person], page: 1, nextPage: null };
    },
  };
  const result = await s.execute("да")("assistantMemory", {
    action: "useGroup",
    id: state.groups[0]!.id,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(queries, [s.person.name]);
  assert.equal(s.conversation.selectionConfirmed, true);
});

test("copying a source meeting preserves its composition and hour over memory's 25 minutes", async () => {
  const s = setup();
  let state = await s.store.read("a");
  state = await s.store.write("a", {
    revision: state.revision,
    requestId: randomUUID(),
    change: { action: "preferences", value: { durationMinutes: 25 } },
  });
  s.conversation.forgetMemoryEvidence(state.revision);
  s.calendar.events = async () => ({
    issues: [],
    events: [
      {
        key: "event:synthetic-source",
        lookup: { id: "synthetic-source" },
        title: "Synthetic source",
        description: "Synthetic agenda",
        location: "Synthetic room",
        organizer: "Synthetic organizer",
        calendarIds: [],
        startsAt: "2099-11-02T05:00:00Z",
        endsAt: "2099-11-02T06:00:00Z",
        participants: [
          {
            id: s.person.participantId,
            name: s.person.name,
            organizer: false,
            status: "accepted",
          },
        ],
      },
    ],
  });
  let execute = s.execute("Сделай копию исходной встречи");
  await execute("listMeetings", {
    period: "custom",
    from: "2099-11-02",
    to: "2099-11-02",
  });
  const selected = await execute("selectParticipants", {
    participantIds: [],
    sourceEventKey: "event:synthetic-source",
  });
  assert.equal(selected.ok, true);
  assert.deepEqual(s.conversation.selected, [s.person.participantId]);
  execute = s.execute("да");
  const draft = await execute("prepareMeetingDraft", {
    participantIds: [s.person.participantId],
    startsAt: "2099-11-02T05:00:00Z",
    conference: { mode: "none" },
  });
  assert.equal(draft.ok, true);
  if (
    !draft.ok ||
    !("kind" in draft.data) ||
    draft.data.kind !== "meeting-draft"
  )
    return;
  assert.equal(draft.data.title, "Synthetic source");
  assert.equal(draft.data.agenda, "Synthetic agenda");
  assert.equal(draft.data.location, "Synthetic room");
  assert.equal(draft.data.durationMinutes, 60);
  assert.match(draft.data.memoryPolicy?.summary ?? "", /исходной встречи/);
});

test("task choices require an unambiguous answer and expire on cancellation, account change and timeout", async () => {
  const s = setup();
  const options = [
    { label: "Полчаса", preferences: { durationMinutes: 30 } },
    { label: "Час", preferences: { durationMinutes: 60 } },
  ];
  const offer = () =>
    s.execute("Предложи варианты")("assistantMemory", {
      action: "offerTask",
      options,
    });
  await offer();
  s.execute("да");
  assert.equal(s.conversation.taskPreferences.durationMinutes, undefined);
  s.execute("2");
  assert.equal(s.conversation.taskPreferences.durationMinutes, 60);
  await offer();
  s.execute("нет");
  s.execute("1");
  assert.equal(s.conversation.taskPreferences.durationMinutes, 60);
  await offer();
  s.conversation.taskOptions!.expires = 0;
  s.execute("1");
  assert.equal(s.conversation.taskPreferences.durationMinutes, 60);
  await offer();
  s.conversation.bindAccount("another");
  assert.equal(s.conversation.taskOptions, undefined);
  assert.deepEqual(s.conversation.taskPreferences, {});
});

test("a failed availability call cannot change task duration or composition", async () => {
  const s = setup();
  const state = await s.store.read("a");
  s.conversation.forgetMemoryEvidence(state.revision);
  const execute = s.execute("На час");
  await execute("assistantMemory", {
    action: "task",
    preferences: { durationMinutes: 60 },
    evidence: "На час",
  });
  const failed = await execute("findSlots", {
    participantIds: ["missing"],
    date: "2099-11-02",
    durationMinutes: 25,
  });
  assert.equal(failed.ok, false);
  assert.equal(s.conversation.taskPreferences.durationMinutes, 60);
  assert.deepEqual(s.conversation.selected, []);
});

test("copy rejects an unseen event or unavailable composition without substituting a memory group", async () => {
  const s = setup();
  const execute = s.execute("Копия");
  const unseen = await execute("selectParticipants", {
    participantIds: [],
    sourceEventKey: "event:absent",
  });
  assert.equal(unseen.ok, false);
  s.conversation.observedMeetings.set("event:absent", {
    key: "event:absent",
    title: "Synthetic",
    startsAt: "2099-11-02T05:00:00Z",
    endsAt: "2099-11-02T06:00:00Z",
    organizer: "",
    location: "",
  });
  const unavailable = await execute("selectParticipants", {
    participantIds: [],
    sourceEventKey: "event:absent",
  });
  assert.equal(unavailable.ok, false);
  assert.deepEqual(s.conversation.selected, []);
  assert.equal(s.conversation.meetingSource, undefined);
});
