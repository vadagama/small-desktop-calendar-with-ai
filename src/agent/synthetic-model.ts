import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";

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
function textResponse(text: string): StreamResponse {
  return {
    stream: simulateReadableStream({
      initialDelayInMs: 200,
      chunkDelayInMs: 60,
      chunks: [
        { type: "text-start", id: "answer" },
        ...text.split(/(?<=\s)/).map((delta) => ({
          type: "text-delta" as const,
          id: "answer",
          delta,
        })),
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

/** Deterministic local T03 model, never a fallback for a configured LLM. */
export function createSyntheticModel(prompt: string) {
  const callId = crypto.randomUUID();
  return new MockLanguageModelV4({
    doStream: async (options) => {
      if (/ошибка модели/i.test(prompt))
        throw new Error("Synthetic model failure");
      const toolMessage = options.prompt.findLast(
        (message) => message.role === "tool",
      );
      if (toolMessage?.role === "tool") {
        const result = toolMessage.content.find(
          (part) => part.type === "tool-result",
        );
        const parsed = z
          .object({ sum: z.number() })
          .safeParse(
            result?.output.type === "json" ? result.output.value : null,
          );
        return textResponse(
          parsed.success
            ? `Результат: ${parsed.data.sum}`
            : "Проверьте ввод: нужны два целых числа в допустимом диапазоне.",
        );
      }
      const numbers = prompt
        .match(/-?\d+(?:[.,]\d+)?/g)
        ?.map((value) => Number(value.replace(",", ".")));
      if (!numbers || numbers.length !== 2)
        return textResponse(
          "Укажите два целых числа, например «Сложи 2 и 3». Календарь ещё не подключён.",
        );
      return {
        stream: simulateReadableStream({
          initialDelayInMs: 400,
          chunkDelayInMs: 80,
          chunks: [
            { type: "tool-input-start", id: callId, toolName: "addNumbers" },
            {
              type: "tool-input-delta",
              id: callId,
              delta: JSON.stringify({ a: numbers[0], b: numbers[1] }),
            },
            { type: "tool-input-end", id: callId },
            {
              type: "tool-call",
              toolCallId: callId,
              toolName: "addNumbers",
              input: JSON.stringify({ a: numbers[0], b: numbers[1] }),
            },
            {
              type: "finish",
              finishReason: { unified: "tool-calls", raw: undefined },
              usage,
            },
          ],
        }),
      };
    },
  });
}
