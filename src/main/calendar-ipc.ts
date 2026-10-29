import type { EventRescheduleService } from "./event-reschedule.js";
import type { EventChangeService } from "./event-change.js";
import { ipcMain, shell, clipboard, type IpcMainInvokeEvent } from "electron";
import { calendarChannels, type CalendarReply } from "../shared/calendar.js";
import { CalendarError, type CalendarService } from "./calendar.js";
import { SmallAuthError } from "./small-auth.js";
import type { AvailabilityService } from "./availability.js";

export function registerCalendarHandlers(
  service: CalendarService,
  trusted: (event: IpcMainInvokeEvent) => boolean,
  availability: AvailabilityService,
  changes: EventChangeService,
  reschedules: EventRescheduleService,
) {
  const handle = <T>(
    channel: string,
    action: (input: unknown) => Promise<T>,
  ) => {
    ipcMain.handle(
      channel,
      async (event, input: unknown): Promise<CalendarReply<T>> => {
        if (!trusted(event))
          return {
            ok: false,
            kind: "denied",
            error: "Доступ к календарю отклонён",
          };
        try {
          return { ok: true, data: await action(input) };
        } catch (error) {
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
                : "Не удалось загрузить данные календаря Small.",
          };
        }
      },
    );
  };
  handle(calendarChannels.respond, (input) => reschedules.respond(input));
  const httpsLink = (input: unknown) => {
    if (typeof input !== "string" || input.length > 4000)
      throw new CalendarError("invalid", "Некорректная ссылка.");
    const url = new URL(input);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new CalendarError("invalid", "Доступны только HTTPS-ссылки.");
    return url.href;
  };
  handle(calendarChannels.openLink, async (input) => {
    await shell.openExternal(httpsLink(input));
  });
  handle(calendarChannels.copyLink, async (input) => {
    clipboard.writeText(httpsLink(input));
  });
  handle(calendarChannels.reschedule, (input) => reschedules.reschedule(input));
  handle(calendarChannels.applyChange, (input) =>
    reschedules.applyChange(input),
  );
  handle(calendarChannels.previewChange, (input) => changes.preview(input));
  handle(calendarChannels.calendars, (input) => service.calendars(input));
  handle(calendarChannels.events, (input) => service.events(input));
  handle(calendarChannels.detail, (input) => service.detail(input));
  handle(calendarChannels.people, (input) => service.searchPeople(input));
  handle(calendarChannels.slots, (input) => availability.find(input));
}
