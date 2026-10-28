import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { once } from "node:events";
import { createProfileModel } from "../../src/agent/provider.js";
import { streamSyntheticTurn } from "../../src/agent/runtime.js";

async function server(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
) {
  const instance = createServer(handler);
  instance.listen(0, "127.0.0.1");
  await once(instance, "listening");
  const address = instance.address();
  assert.ok(address && typeof address === "object");
  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise<void>((resolve) => {
        instance.closeAllConnections();
        instance.close(() => resolve());
      }),
  };
}

test("real OpenAI-compatible streaming executes a tool and returns its result to the same endpoint", async () => {
  const bodies: Array<{
    model: string;
    messages: Array<{ role: string; content: string }>;
  }> = [];
  const authorizations: Array<string | undefined> = [];
  const key = `synthetic-${crypto.randomUUID()}`;
  const api = await server(async (request, response) => {
    authorizations.push(request.headers.authorization);
    let body = "";
    for await (const chunk of request) body += chunk;
    bodies.push(JSON.parse(body));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const delta =
      bodies.length === 1
        ? {
            tool_calls: [
              {
                index: 0,
                id: "call-1",
                type: "function",
                function: { name: "addNumbers", arguments: '{"a":2,"b":3}' },
              },
            ],
          }
        : { content: "Результат: 5" };
    for (const chunk of [
      { id: "synthetic", choices: [{ index: 0, delta, finish_reason: null }] },
      {
        id: "synthetic",
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: bodies.length === 1 ? "tool_calls" : "stop",
          },
        ],
      },
    ])
      response.write(`data: ${JSON.stringify(chunk)}\n\n`);
    response.end("data: [DONE]\n\n");
  });
  try {
    const model = createProfileModel({
      id: "small",
      baseURL: api.baseURL,
      modelId: "synthetic-glm",
      apiKey: key,
    });
    const result = await streamSyntheticTurn(model, { prompt: "Сложи 2 и 3" });
    await result.consumeStream();
    assert.equal(await result.text, "Результат: 5");
    assert.equal(bodies.length, 2);
    assert.ok(bodies.every((body) => body.model === "synthetic-glm"));
    assert.equal(
      bodies[1]?.messages.find((message) => message.role === "tool")?.content,
      '{"sum":5}',
    );
    assert.deepEqual(authorizations, [`Bearer ${key}`, `Bearer ${key}`]);
  } finally {
    await api.close();
  }
});

test("redirects never forward a profile key to another origin", async () => {
  let forwarded = 0;
  const target = await server((_request, response) => {
    forwarded++;
    response.end();
  });
  const source = await server((_request, response) => {
    response.writeHead(307, { Location: `${target.baseURL}/chat/completions` });
    response.end();
  });
  try {
    const model = createProfileModel({
      id: "personal",
      baseURL: source.baseURL,
      modelId: "synthetic",
      apiKey: "synthetic-key",
    });
    const result = await streamSyntheticTurn(model, { prompt: "Проверка" });
    const errors = [];
    for await (const chunk of result.fullStream)
      if (chunk.type === "error") errors.push(chunk);
    assert.equal(errors.length, 1);
    assert.equal(forwarded, 0);
  } finally {
    await source.close();
    await target.close();
  }
});
