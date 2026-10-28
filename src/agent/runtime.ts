import { ToolLoopAgent, isStepCount, tool, type LanguageModel } from "ai";
import { z } from "zod";

/** T01 only: inject an explicit model instance; no default provider or credentials. */
function createSyntheticAgent(model: Exclude<LanguageModel, string>) {
  // https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent
  return new ToolLoopAgent({
    model,
    instructions:
      "Ты синтетический тестовый ассистент. Складывай числа через addNumbers. " +
      "При ошибке входа объясни её. У тебя нет доступа к календарю или системе.",
    stopWhen: isStepCount(3),
    maxRetries: 0,
    tools: {
      addNumbers: tool({
        description:
          "Сложить два синтетических целых числа локально, без побочных эффектов.",
        inputSchema: z.strictObject({
          a: z.number().int().min(-1_000_000).max(1_000_000),
          b: z.number().int().min(-1_000_000).max(1_000_000),
        }),
        execute: async ({ a, b }, { abortSignal }) => {
          abortSignal?.throwIfAborted();
          return { sum: a + b };
        },
      }),
    },
  });
}

/** Native SDK fullStream events; cancellation is checked before any model call. */
export async function streamSyntheticTurn(
  model: Exclude<LanguageModel, string>,
  options: { prompt: string; abortSignal?: AbortSignal },
) {
  options.abortSignal?.throwIfAborted();
  return createSyntheticAgent(model).stream(options);
}
