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
    assert.equal(calls, name === "searchPeople" ? 6 : 0);
    assert.equal((await result.steps).length, 6);
    if (calls)
      assert.ok(
        model.doStreamCalls[1]?.prompt.some(
          (message) => message.role === "tool",
        ),
      );
  }
});
