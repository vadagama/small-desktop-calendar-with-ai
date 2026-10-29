import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { streamCalendarTurn } from "../../src/agent/calendar-runtime.js";

test("calendar SDK loop returns a service result to the model and rejects arbitrary tools", async () => {
  for (const name of ["searchPeople", "runShell"]) {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          initialDelayInMs: null,
          chunkDelayInMs: null,
          chunks: [
            {
              type: "tool-call" as const,
              toolCallId: "call",
              toolName: name,
              input: '{"query":"Тест","page":1}',
            },
            {
              type: "finish" as const,
              finishReason: { unified: "tool-calls" as const, raw: undefined },
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
      }),
    });
    const result = await streamCalendarTurn(
      model,
      { prompt: "Найди Тест", abortSignal: new AbortController().signal },
      async () => {
        calls++;
        return { ok: true, data: { people: [], page: 1, nextPage: null } };
      },
    );
    await result.consumeStream();
    assert.equal(calls, name === "searchPeople" ? 20 : 0);
    assert.equal((await result.steps).length, 20);
    if (calls)
      assert.ok(
        model.doStreamCalls[1]?.prompt.some(
          (message) => message.role === "tool",
        ),
      );
  }
});

test("custom instructions reach the model, skills load on demand, disabled tools cannot execute", async () => {
  const { loadAgentDefaults } =
    await import("../../src/agent/agent-content.js");
  const configuration = await loadAgentDefaults();
  configuration.settings.instructions = "Предпочитай краткие ответы.";
  configuration.settings.skills[0]!.enabled = false;
  configuration.settings.skills.find((s) => s.id === "schedule")!.enabled =
    false;
  configuration.settings.skills.find((s) => s.id === "analytics")!.enabled =
    false;
  configuration.settings.skills[1]!.content = "CUSTOM_SKILL_BODY";
  for (const [name, input] of [
    ["loadSkill", '{"name":"availability"}'],
    ["searchPeople", '{"query":"Тест","page":1}'],
    ["listMeetings", '{"period":"today"}'],
    ["meetingAnalytics", '{"period":"today"}'],
  ] as const) {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          initialDelayInMs: null,
          chunkDelayInMs: null,
          chunks: [
            {
              type: "tool-call" as const,
              toolCallId: "test-call",
              toolName: name,
              input,
            },
            {
              type: "finish" as const,
              finishReason: { unified: "tool-calls" as const, raw: undefined },
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
      }),
    });
    const result = await streamCalendarTurn(
      model,
      { prompt: "Тест", abortSignal: new AbortController().signal },
      async () => {
        calls++;
        return { ok: true, data: { people: [], page: 1, nextPage: null } };
      },
      configuration,
    );
    await result.consumeStream();
    assert.equal(calls, 0);
    const first = model.doStreamCalls[0]!;
    assert.ok(
      JSON.stringify(first.prompt).includes("Предпочитай краткие ответы."),
    );
    assert.ok(!JSON.stringify(first.prompt).includes("CUSTOM_SKILL_BODY"));
    assert.ok(!first.tools?.some((tool) => tool.name === "searchPeople"));
    assert.ok(!first.tools?.some((tool) => tool.name === "listMeetings"));
    assert.ok(!first.tools?.some((tool) => tool.name === "meetingAnalytics"));
    if (name === "loadSkill")
      assert.ok(
        JSON.stringify(model.doStreamCalls[1]!.prompt).includes(
          "CUSTOM_SKILL_BODY",
        ),
      );
  }
});

test("enabled analytics skill exposes meetingAnalytics and routes it to the executor", async () => {
  const { loadAgentDefaults } =
    await import("../../src/agent/agent-content.js");
  const configuration = await loadAgentDefaults();
  const called: [string, unknown][] = [];
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        initialDelayInMs: null,
        chunkDelayInMs: null,
        chunks: [
          {
            type: "tool-call" as const,
            toolCallId: "analytics-call",
            toolName: "meetingAnalytics",
            input: '{"period":"this-week"}',
          },
          {
            type: "finish" as const,
            finishReason: { unified: "tool-calls" as const, raw: undefined },
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
    }),
  });
  const result = await streamCalendarTurn(
    model,
    {
      prompt: "Сколько часов встреч на неделе?",
      abortSignal: new AbortController().signal,
    },
    async (name, input) => {
      called.push([name, input]);
      return { ok: false, kind: "denied", error: "test" };
    },
    configuration,
  );
  await result.consumeStream();
  assert.deepEqual(called[0], ["meetingAnalytics", { period: "this-week" }]);
  assert.ok(
    model.doStreamCalls[0]!.tools?.some((t) => t.name === "meetingAnalytics"),
  );
});
