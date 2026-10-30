import { isDeepStrictEqual } from "node:util";
import type { MemoryChange } from "../shared/assistant-memory.js";
import { MemoryError } from "./assistant-memory.js";

export const isMemoryRequest = (prompt: string) =>
  /запомн|сохран|удал|забуд|очист|remember|save|forget|delete/iu.test(prompt);
export const isMemoryCancellation = (prompt: string) =>
  /(?:^|\s)(?:не\s+(?:сохраняй|запоминай)|отмени\s+(?:сохранение|запоминание)|cancel)(?:\s|[.!?,]|$)|^\s*(?:отмена|не надо|не нужно)[.!?]?\s*$/iu.test(
    prompt,
  );

interface ReviewContext {
  owner: number;
  epoch: number;
  revision: number;
  turn: number;
}

/** Temporary review evidence; semantic ambiguity is assessed by the model. */
export class MemoryReviewSession {
  private readRevision: number | undefined;
  private pending:
    | (ReviewContext & {
        prompt: string;
        change: MemoryChange;
        questions: string[];
        expires: number;
      })
    | undefined;

  clear() {
    this.pending = undefined;
    this.readRevision = undefined;
  }
  recall(revision: number) {
    this.readRevision = revision;
  }
  private current(ctx: ReviewContext) {
    const item = this.pending;
    return item &&
      item.owner === ctx.owner &&
      item.epoch === ctx.epoch &&
      item.revision === ctx.revision &&
      item.expires > Date.now()
      ? item
      : undefined;
  }
  review(
    ctx: ReviewContext,
    prompt: string,
    change: MemoryChange,
    questions: string[],
    evidence?: string,
  ) {
    if (isMemoryCancellation(prompt)) {
      this.clear();
      throw new MemoryError(
        "Сохранение отменено пользователем. Не создавайте карточку.",
      );
    }
    if (this.readRevision !== ctx.revision)
      throw new MemoryError(
        "Сначала прочитайте актуальную память через assistantMemory recall и проверьте противоречия и дубликаты.",
      );
    const previous = this.current(ctx);
    if (
      previous?.questions.length &&
      previous.turn === ctx.turn &&
      !questions.length
    )
      throw new MemoryError(
        "Сначала задайте вопросы пользователю и дождитесь ответа в следующем сообщении.",
      );
    const continuing =
      previous && previous.questions.length > 0 && previous.turn < ctx.turn;
    if (!isMemoryRequest(prompt) && !continuing)
      throw new MemoryError(
        "Для изменения памяти нужна явная просьба пользователя.",
      );
    if (continuing && (!evidence || !prompt.includes(evidence)))
      throw new MemoryError(
        "Укажите точную цитату ответа пользователя в evidence и проверьте оставшиеся вопросы.",
      );
    this.pending = {
      ...ctx,
      prompt: continuing ? previous.prompt : prompt,
      change: structuredClone(change),
      questions,
      expires: previous?.expires ?? Date.now() + 10 * 60_000,
    };
    return {
      kind: "memory-review" as const,
      ready: questions.length === 0,
      questions,
      message: questions.length
        ? "Задайте эти вопросы пользователю. До ответа не вызывайте propose: память не изменена."
        : "Проверка завершена. Предложите проверенное изменение через propose; запись требует подтверждения кнопкой.",
    };
  }
  authorize(ctx: ReviewContext, change: MemoryChange) {
    const item = this.current(ctx);
    if (
      !item ||
      item.turn !== ctx.turn ||
      item.questions.length ||
      !isDeepStrictEqual(item.change, change)
    )
      throw new MemoryError(
        "Перед propose выполните assistantMemory review для этого изменения и актуальной памяти. Сначала уточните открытые вопросы у пользователя.",
      );
    return item.prompt;
  }
}
