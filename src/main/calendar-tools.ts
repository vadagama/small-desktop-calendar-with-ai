import { meetingDraftInput } from "../shared/meeting-draft.js";
import { prepareMeetingDraft } from "./meeting-draft.js";
import {
  peopleToolInput,
  slotsToolInput,
  type CalendarToolExecutor,
} from "../shared/calendar-tools.js";
import { CalendarError, type CalendarService } from "./calendar.js";
import { SmallAuthError } from "./small-auth.js";
import type { AvailabilityService } from "./availability.js";

/** Each executor belongs to one authenticated turn; the model cannot choose an account. */
export function createCalendarToolExecutor(
  accountId: string,
  prompt: string,
  signal: AbortSignal,
  calendar: Pick<CalendarService, "searchPeople">,
  availability: Pick<AvailabilityService, "find">,
  organizerName: string = accountId,
): CalendarToolExecutor {
  const selection = prompt.match(/Участники:\s*\[([A-Za-z0-9_,\s-]+)\]/giu);
  const explicitIds =
    selection?.length === 1
      ? selection[0]!
          .slice(selection[0]!.indexOf("[") + 1, -1)
          .split(",")
          .map((id) => id.trim())
      : [];
  let calls = 0;
  return async (name, input) => {
    signal.throwIfAborted();
    try {
      if (++calls > 12)
        throw new CalendarError(
          "invalid",
          "Лимит поиска исчерпан. Уточните запрос.",
        );
      let data;
      if (name === "searchPeople") {
        const parsed = peopleToolInput.safeParse(input);
        if (!parsed.success)
          throw new CalendarError(
            "invalid",
            "Проверьте имя и страницу поиска.",
          );
        data = await calendar.searchPeople({ ...parsed.data, accountId });
      } else if (name === "findSlots" || name === "prepareMeetingDraft") {
        const parsed = (
          name === "findSlots" ? slotsToolInput : meetingDraftInput
        ).safeParse(input);
        if (!parsed.success)
          throw new CalendarError(
            "invalid",
            "Проверьте участников, дату и длительность.",
          );
        if (
          !explicitIds.length ||
          explicitIds.length !== parsed.data.participantIds.length ||
          new Set(explicitIds).size !== explicitIds.length ||
          parsed.data.participantIds.some((id) => !explicitIds.includes(id))
        )
          throw new CalendarError(
            "invalid",
            "Укажите полный состав в формате «Участники: [ID1, ID2]». Состав команды по названию не подтверждён.",
          );
        data =
          name === "findSlots"
            ? await availability.find({ ...parsed.data, accountId })
            : await prepareMeetingDraft(
                { id: accountId, name: organizerName },
                parsed.data,
                availability,
                signal,
              );
      } else throw new CalendarError("denied", "Инструмент недоступен.");
      signal.throwIfAborted();
      return { ok: true, data };
    } catch (error) {
      signal.throwIfAborted();
      return {
        ok: false,
        kind:
          error instanceof CalendarError
            ? error.kind
            : error instanceof SmallAuthError
              ? error.code
              : "network",
        error:
          error instanceof CalendarError || error instanceof SmallAuthError
            ? error.message
            : "Не удалось прочитать календарь Small.",
      };
    }
  };
}
