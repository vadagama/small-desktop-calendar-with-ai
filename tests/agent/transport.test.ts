import assert from "node:assert/strict";
import { test } from "node:test";
import type { UIMessage, UIMessageChunk } from "ai";
import type {
  AgentEvent,
  AgentRequest,
  AssistantBridge,
  StartResult,
} from "../../src/shared/assistant.js";
import { DesktopTransport } from "../../src/renderer/transport.js";

function fixture(reply: StartResult = { ok: true }) {
  const listeners = new Set<(event: AgentEvent) => void>();
  const requests: AgentRequest[] = [];
  const cancelled: string[] = [];
  const bridge: AssistantBridge = {
    start: async (request) => {
      requests.push(request);
      return reply;
    },
    cancel: async (id) => {
      cancelled.push(id);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    transport: new DesktopTransport(bridge),
    listeners,
    requests,
    cancelled,
    emit: (event: AgentEvent) => {
      for (const listener of listeners) listener(event);
    },
  };
}
const messages: UIMessage[] = [
  { id: "user", role: "user", parts: [{ type: "text", text: "Сложи 2 и 3" }] },
];
const options = {
  trigger: "submit-message" as const,
  chatId: "1aff0568-474e-4b9f-8ae0-1065aa10350c",
  messageId: undefined,
  messages,
  abortSignal: undefined,
};

test("transports native SDK chunks and ignores events from another turn", async () => {
  const f = fixture();
  const stream = await f.transport.sendMessages(options);
  const requestId = f.requests[0]!.requestId;
  f.emit({
    requestId: "stale",
    type: "chunk",
    chunk: { type: "error", errorText: "stale" },
  });
  const chunks: UIMessageChunk[] = [
    { type: "start", messageId: "answer" },
    { type: "finish" },
  ];
  const reader = stream.getReader();
  f.emit({ requestId, type: "chunk", chunk: chunks[0]! });
  assert.deepEqual((await reader.read()).value, chunks[0]);
  f.emit({ requestId, type: "chunk", chunk: chunks[1]! });
  f.emit({ requestId, type: "end" });
  assert.deepEqual((await reader.read()).value, chunks[1]);
  assert.equal((await reader.read()).done, true);
  assert.equal(f.requests[0]!.prompt, "Сложи 2 и 3");
  assert.equal(f.listeners.size, 0);
});

test("follow-up messages retain the conversation identity without replaying renderer history", async () => {
  const f = fixture();
  const first = await f.transport.sendMessages(options);
  f.emit({ requestId: f.requests[0]!.requestId, type: "end" });
  assert.equal((await first.getReader().read()).done, true);

  const followup: UIMessage[] = [
    ...messages,
    {
      id: "answer",
      role: "assistant",
      parts: [{ type: "text", text: "Какого участника выбрать?" }],
    },
    {
      id: "followup",
      role: "user",
      parts: [{ type: "text", text: "Второго" }],
    },
  ];
  const second = await f.transport.sendMessages({
    ...options,
    messages: followup,
  });
  f.emit({ requestId: f.requests[1]!.requestId, type: "end" });
  assert.equal((await second.getReader().read()).done, true);

  for (const request of f.requests) {
    assert.equal(request.conversationId, options.chatId);
    assert.deepEqual(Object.keys(request).sort(), [
      "conversationId",
      "prompt",
      "requestId",
    ]);
  }
  assert.equal(f.requests[1]!.prompt, "Второго");
  assert.notEqual(f.requests[0]!.requestId, f.requests[1]!.requestId);
  assert.equal(f.listeners.size, 0);
});

test("starting another chat uses its own conversation identity", async () => {
  const f = fixture();
  for (const chatId of [
    options.chatId,
    "30fd7070-6467-4d00-8664-502fc775649b",
  ]) {
    const stream = await f.transport.sendMessages({ ...options, chatId });
    f.emit({ requestId: f.requests.at(-1)!.requestId, type: "end" });
    assert.equal((await stream.getReader().read()).done, true);
  }
  assert.equal(f.requests[0]!.conversationId, options.chatId);
  assert.equal(
    f.requests[1]!.conversationId,
    "30fd7070-6467-4d00-8664-502fc775649b",
  );
});

test("abort cancels only the current request and removes its subscription", async () => {
  const f = fixture();
  const controller = new AbortController();
  const stream = await f.transport.sendMessages({
    ...options,
    abortSignal: controller.signal,
  });
  controller.abort();
  await assert.rejects(stream.getReader().read(), { name: "AbortError" });
  assert.deepEqual(f.cancelled, [f.requests[0]!.requestId]);
  assert.equal(f.listeners.size, 0);
});

test("a rejected start becomes an error and does not leave a listener", async () => {
  const f = fixture({ ok: false, error: "Ассистент занят" });
  const stream = await f.transport.sendMessages(options);
  await assert.rejects(stream.getReader().read(), /Ассистент занят/);
  assert.equal(f.listeners.size, 0);
});

test("closing a transport cancels pending work", async () => {
  const f = fixture();
  const stream = await f.transport.sendMessages(options);
  f.transport.close();
  await assert.rejects(stream.getReader().read(), { name: "AbortError" });
  assert.equal(f.cancelled.length, 1);
  assert.equal(f.listeners.size, 0);
});

test("an already aborted send does not start a request", async () => {
  const f = fixture();
  await assert.rejects(
    f.transport.sendMessages({ ...options, abortSignal: AbortSignal.abort() }),
    { name: "AbortError" },
  );
  assert.equal(f.requests.length, 0);
});

test("cancelling the consumer stream cancels remote work and removes its listener", async () => {
  const f = fixture();
  const stream = await f.transport.sendMessages(options);
  await stream.cancel();
  assert.deepEqual(f.cancelled, [f.requests[0]!.requestId]);
  assert.equal(f.listeners.size, 0);
});
