import { z } from "zod";
import type { EventMutations } from "./event-mutations.js";
import type { SmallAuth } from "./small-auth.js";
import type { EventChangeService } from "./event-change.js";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { calendarChannels, type CalendarReply } from "../shared/calendar.js";
import { CalendarError, type CalendarService } from "./calendar.js";
import { SmallAuthError } from "./small-auth.js";
import type { AvailabilityService } from "./availability.js";

export function registerCalendarHandlers(
  service: CalendarService,
  trusted: (event: IpcMainInvokeEvent) => boolean,
  availability: AvailabilityService,
  changes: EventChangeService,
  mutations: EventMutations,
  auth: SmallAuth,
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
  const guarded = async <T>(
    input: unknown,
    action: (assertCurrent: () => void) => Promise<T>,
  ) => {
    const revision = auth.sessionRevision;
    const check = () => {
      if (revision !== auth.sessionRevision)
        throw new SmallAuthError("Изменился аккаунт Small.", "auth");
    };
    const q = z.object({ accountId: z.string() }).parse(input);
    const state = await auth.read();
    check();
    if (state.status !== "signed-in" || state.profile.id !== q.accountId)
      throw new SmallAuthError("Войдите в нужный аккаунт Small.", "auth");
    return action(check);
  };
  handle(calendarChannels.confirmChange, (input) =>
    guarded(input, (check) => mutations.confirm(input, check)),
  );
  handle(calendarChannels.reconcileChange, (input) =>
    guarded(input, (check) => mutations.reconcile(input, check)),
  );
  handle(calendarChannels.previewChange, (input) => changes.preview(input));
  handle(calendarChannels.calendars, (input) => service.calendars(input));
  handle(calendarChannels.events, (input) => service.events(input));
  handle(calendarChannels.detail, (input) => service.detail(input));
  handle(calendarChannels.people, (input) => service.searchPeople(input));
  handle(calendarChannels.slots, (input) => availability.find(input));
}
