import { toUIMessageStream } from "ai";
import { streamSyntheticTurn } from "../agent/runtime.js";
import { createSyntheticModel } from "../agent/synthetic-model.js";
import type {
  AgentControl,
  AgentEvent,
  AgentRequest,
} from "../shared/assistant.js";

const port = process.parentPort;
if (!port) throw new Error("Assistant requires an Electron utility process");
const controller = new AbortController();
const send = (event: AgentEvent) => port.postMessage(event);

async function run({ requestId, prompt }: AgentRequest) {
  try {
    const result = await streamSyntheticTurn(createSyntheticModel(prompt), {
      prompt,
      abortSignal: controller.signal,
    });
    // https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text
    const stream = toUIMessageStream({
      stream: result.stream,
      onError: () => "Не удалось получить ответ. Попробуйте ещё раз.",
    });
    for await (const chunk of stream) send({ requestId, type: "chunk", chunk });
  } catch {
    send({
      requestId,
      type: "chunk",
      chunk: controller.signal.aborted
        ? { type: "abort" }
        : {
            type: "error",
            errorText: "Не удалось получить ответ. Попробуйте ещё раз.",
          },
    });
  } finally {
    send({ requestId, type: "end" });
  }
}
port.on("message", ({ data }: { data: AgentControl }) => {
  if (data.type === "cancel") controller.abort();
  else void run(data.request);
});
