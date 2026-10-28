import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { streamSyntheticTurn } from "../../src/agent/runtime.js";

before(() => {
  mock.method(globalThis, "fetch", () => {
    assert.fail("T01 must not make network requests");
  });
});
after(() => mock.restoreAll());

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const parts: T[] = [];
  for await (const part of stream) parts.push(part);
  return parts;
}

type StreamResponse = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;

const usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

function toolResponse(input: string, toolName = "addNumbers"): StreamResponse {
  return {
    stream: simulateReadableStream({
      initialDelayInMs: null,
      chunkDelayInMs: null,
      chunks: [
        { type: "tool-call", toolCallId: "synthetic-call", toolName, input },
        {
          type: "finish",
          finishReason: { unified: "tool-calls", raw: undefined },
          usage,
        },
      ],
    }),
  };
}

function textResponse(): StreamResponse {
  return {
    stream: simulateReadableStream({
      initialDelayInMs: null,
      chunkDelayInMs: null,
      chunks: [
        { type: "text-start", id: "answer" },
        { type: "text-delta", id: "answer", delta: "Результат: " },
        { type: "text-delta", id: "answer", delta: "5" },
        { type: "text-end", id: "answer" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: undefined },
          usage,
        },
      ],
    }),
  };
}

test("streams a validated tool result back to the model before the final answer", async () => {
  const model = new MockLanguageModelV4({
    doStream: [toolResponse('{"a":2,"b":3}'), textResponse()],
  });
  const result = await streamSyntheticTurn(model, { prompt: "Сложи 2 и 3." });
  const parts = await collect(result.fullStream);
  assert.deepEqual(
    parts.filter((p) => p.type === "tool-result").map((p) => p.output),
    [{ sum: 5 }],
  );
  assert.deepEqual(
    parts.filter((p) => p.type === "text-delta").map((p) => p.text),
    ["Результат: ", "5"],
  );
  const toolMessage = model.doStreamCalls[1]?.prompt.find(
    (p) => p.role === "tool",
  );
  assert.ok(toolMessage);
  const output = toolMessage.content[0];
  assert.equal(output?.type, "tool-result");
  assert.ok(output && output.type === "tool-result");
  assert.deepEqual(output.output, { type: "json", value: { sum: 5 } });
  assert.equal(await result.text, "Результат: 5");
});

for (const input of [
  '{"a":"2","b":3}',
  '{"a":2}',
  '{"a":1000001,"b":3}',
  '{"a":1.5,"b":3}',
  '{"a":2,"b":3,"command":"unused"}',
  "not json",
]) {
  test(`rejects invalid tool input without a successful tool result: ${input}`, async () => {
    const model = new MockLanguageModelV4({
      doStream: [toolResponse(input), textResponse()],
    });
    const result = await streamSyntheticTurn(model, {
      prompt: "Проверь вход.",
    });
    const parts = await collect(result.fullStream);
    assert.ok(parts.some((p) => p.type === "tool-error"));
    assert.ok(!parts.some((p) => p.type === "tool-result"));
  });
}

test("rejects tools outside the synthetic allowlist", async () => {
  const model = new MockLanguageModelV4({
    doStream: [toolResponse("{}", "runShell"), textResponse()],
  });
  const result = await streamSyntheticTurn(model, {
    prompt: "Проверь инструмент.",
  });
  const parts = await collect(result.fullStream);
  assert.ok(parts.some((p) => p.type === "tool-error"));
  assert.ok(!parts.some((p) => p.type === "tool-result"));
});

test("stops a model that repeatedly requests tools at the step limit", async () => {
  const model = new MockLanguageModelV4({
    doStream: async () => toolResponse('{"a":2,"b":3}'),
  });
  const result = await streamSyntheticTurn(model, { prompt: "Повторяй." });
  await result.consumeStream();
  assert.equal((await result.steps).length, 3);
});

test("cancels an active stream before a tool executes", async () => {
  const controller = new AbortController();
  const model = new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream({
        start(stream) {
          stream.enqueue({ type: "text-start", id: "pending" });
          stream.enqueue({
            type: "text-delta",
            id: "pending",
            delta: "Ожидание",
          });
          abortSignal?.addEventListener(
            "abort",
            () => stream.error(abortSignal.reason),
            { once: true },
          );
        },
      }),
    }),
  });
  const result = await streamSyntheticTurn(model, {
    prompt: "Начни.",
    abortSignal: controller.signal,
  });
  const parts = [];
  for await (const part of result.fullStream) {
    parts.push(part);
    if (part.type === "text-delta") controller.abort();
  }
  assert.ok(parts.some((p) => p.type === "abort"));
  assert.ok(!parts.some((p) => p.type === "tool-result"));
  assert.equal(model.doStreamCalls.length, 1);
});

test("an already aborted request does not call the model", async () => {
  const model = new MockLanguageModelV4({
    doStream: async () => toolResponse('{"a":2,"b":3}'),
  });
  await assert.rejects(
    streamSyntheticTurn(model, {
      prompt: "Начни.",
      abortSignal: AbortSignal.abort(),
    }),
    { name: "AbortError" },
  );
  assert.equal(model.doStreamCalls.length, 0);
});

test("reports a provider failure without retrying or producing a tool result", async () => {
  const failure = new Error("synthetic provider failure");
  const model = new MockLanguageModelV4({
    doStream: async () => {
      throw failure;
    },
  });
  const result = await streamSyntheticTurn(model, { prompt: "Начни." });
  const parts = await collect(result.fullStream);
  assert.ok(parts.some((p) => p.type === "error" && p.error === failure));
  assert.ok(!parts.some((p) => p.type === "tool-result"));
  assert.equal(model.doStreamCalls.length, 1);
});
