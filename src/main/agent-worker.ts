import { streamCalendarTurn } from "../agent/calendar-runtime.js";
import type {
  CalendarToolCall,
  CalendarToolResult,
} from "../shared/calendar-tools.js";
import { toUIMessageStream, type ToolSet } from "ai";
import { streamSyntheticTurn } from "../agent/runtime.js";
import { createSyntheticModel } from "../agent/synthetic-model.js";
import { createProfileModel } from "../agent/provider.js";
import type { ModelConnection } from "../shared/profiles.js";
import type {
  AgentControl,
  AgentEvent,
  AgentRequest,
} from "../shared/assistant.js";

const port = process.parentPort;
if (!port) throw new Error("Assistant requires an Electron utility process");
const controller = new AbortController();
const send = (event: AgentEvent) => port.postMessage(event);

const pending = new Map<string, (result: CalendarToolResult) => void>();
async function run(
  { requestId, prompt }: AgentRequest,
  profile: ModelConnection | null,
  calendar: boolean,
) {
  try {
    const options = { prompt, abortSignal: controller.signal };
    const result =
      calendar && profile
        ? await streamCalendarTurn(
            createProfileModel(profile),
            options,
            (name, input) => {
              controller.signal.throwIfAborted();
              const callId = crypto.randomUUID();
              return new Promise<CalendarToolResult>((resolve, reject) => {
                const abort = () => {
                  pending.delete(callId);
                  reject(controller.signal.reason);
                };
                controller.signal.addEventListener("abort", abort, {
                  once: true,
                });
                pending.set(callId, (result) => {
                  controller.signal.removeEventListener("abort", abort);
                  resolve(result);
                });
                port.postMessage({
                  type: "calendar-tool",
                  requestId,
                  callId,
                  name,
                  input,
                } satisfies CalendarToolCall);
              });
            },
          )
        : await streamSyntheticTurn(
            profile
              ? createProfileModel(profile)
              : createSyntheticModel(prompt),
            options,
          );
    // https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text
    const stream = toUIMessageStream<ToolSet>({
      stream: result.stream,
      sendReasoning: false,
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
  else if (data.type === "calendar-result") {
    const resolve = pending.get(data.callId);
    pending.delete(data.callId);
    resolve?.(data.result);
  } else void run(data.request, data.profile, data.calendar);
});
