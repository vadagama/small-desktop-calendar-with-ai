import assert from "node:assert/strict";
import { test } from "node:test";
import { createProfileModel } from "../../src/agent/provider.js";
import { streamCalendarTurn } from "../../src/agent/calendar-runtime.js";

test("calendar tools expose object schemas to OpenAI-compatible servers", async () => {
  let parameters: Array<{ name: string; parameters: { type?: string } }> = [];
  const model = createProfileModel(
    {
      id: "personal",
      baseURL: "https://example.test/v1",
      modelId: "synthetic",
      apiKey: "synthetic",
    },
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      parameters = body.tools.map((t: { function: unknown }) => t.function);
      return new Response(
        'data: {"id":"synthetic","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  );
  const result = await streamCalendarTurn(
    model,
    { prompt: "Hello", abortSignal: AbortSignal.timeout(5000) },
    async () => ({ ok: false, kind: "denied", error: "Synthetic" }),
  );
  await result.consumeStream();
  assert.ok(parameters.some((t) => t.name === "listMeetings"));
  for (const tool of parameters)
    assert.equal(tool.parameters.type, "object", tool.name);
});

for (const input of [
  { period: "custom", from: "2026-10-01" },
  { period: "custom", from: "2026-10-10", to: "2026-10-01" },
  { period: "today", unexpected: true },
]) {
  test(`schedule input validation remains enforced: ${JSON.stringify(input)}`, async () => {
    let requests = 0;
    let executed = false;
    const model = createProfileModel(
      {
        id: "personal",
        baseURL: "https://example.test/v1",
        modelId: "synthetic",
        apiKey: "synthetic",
      },
      async () => {
        const first = ++requests === 1;
        const delta = first
          ? {
              tool_calls: [
                {
                  index: 0,
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "listMeetings",
                    arguments: JSON.stringify(input),
                  },
                },
              ],
            }
          : { content: "Invalid input" };
        return new Response(
          `data: ${JSON.stringify({ id: "synthetic", choices: [{ index: 0, delta, finish_reason: first ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    );
    const result = await streamCalendarTurn(
      model,
      { prompt: "Hello", abortSignal: AbortSignal.timeout(5000) },
      async (name) => {
        if (name === "listMeetings") executed = true;
        return { ok: false, kind: "denied", error: "Synthetic" };
      },
    );
    await result.consumeStream();
    assert.equal(requests, 2);
    assert.equal(executed, false);
  });
}
