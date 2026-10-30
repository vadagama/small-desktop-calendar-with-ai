import type { EventRescheduleService } from "./event-reschedule.js";
import type { EventChangeService } from "./event-change.js";
import { ipcMain, shell, clipboard, type IpcMainInvokeEvent } from "electron";
import { calendarChannels, type CalendarReply } from "../shared/calendar.js";
import { CalendarError, type CalendarService } from "./calendar.js";
import { SmallAuthError } from "./small-auth.js";
import type { AvailabilityService } from "./availability.js";
import type { CalendarSync } from "./calendar-sync.js";
import type { CachedCatalog } from "./calendar-catalog.js";
import {
  eventTarget,
  editTarget,
  rescheduleTarget,
  type WriteTarget,
} from "./write-target.js";

export function registerCalendarHandlers(
  service: CalendarService,
  trusted: (event: IpcMainInvokeEvent) => boolean,
  availability: AvailabilityService,
  changes: EventChangeService,
  reschedules: EventRescheduleService,
  sync: CalendarSync,
  catalog: CachedCatalog,
) {
  // Whatever the outcome (success, refusal or unknown), Small's state may now
  // differ from the cached copy.
  const written =
    <T>(
      action: (input: unknown) => Promise<T>,
      target: (input: unknown) => WriteTarget | null,
    ) =>
    async (input: unknown) => {
      try {
        return await action(input);
      } finally {
        await sync.invalidate(target(input) ?? undefined);
      }
    };
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
            ...(error instanceof CalendarError && error.unknownOutcome
              ? { unknownOutcome: true as const }
              : {}),
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
  handle(
    calendarChannels.respond,
    written((input) => reschedules.respond(input), eventTarget),
  );
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
  handle(
    calendarChannels.reschedule,
    written((input) => reschedules.reschedule(input), rescheduleTarget),
  );
  handle(
    calendarChannels.applyChange,
    written((input) => reschedules.applyChange(input), eventTarget),
  );
  handle(
    calendarChannels.updateEvent,
    written((input) => reschedules.update(input), editTarget),
  );
  handle(calendarChannels.previewChange, (input) => changes.preview(input));
  handle(calendarChannels.calendars, (input) => catalog.calendars(input));
  handle(calendarChannels.events, (input) => sync.read(input));
  handle(calendarChannels.detail, (input) => service.detail(input));
  handle(calendarChannels.people, (input) => catalog.searchPeople(input));
  handle(calendarChannels.slots, (input) => availability.find(input));
}
