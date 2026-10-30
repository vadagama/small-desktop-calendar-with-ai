import { CalendarError } from "./calendar.js";

/** Proof that the action was never invoked, so a create claim can be released. */
export class CalendarWriteNotStarted extends CalendarError {
  constructor() {
    super(
      "invalid",
      "Не удалось подготовить локальный кеш. Изменения не отправлены в Small.",
    );
  }
}
