import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import type { CalendarReply } from "../shared/calendar.js";
import { seriesChannels } from "../shared/series-channels.js";
import { CalendarError } from "./calendar.js";
import { SmallAuthError } from "./small-auth.js";
import type { SeriesController } from "./series-controller.js";

export function registerSeriesHandlers(
  controller: Pick<SeriesController, "gate" | "apply">,
  trusted: (event: IpcMainInvokeEvent) => boolean,
) {
  const handle = <T>(channel: string, action: (input: unknown) => Promise<T>) =>
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
          const known =
            error instanceof CalendarError || error instanceof SmallAuthError;
          return {
            ok: false,
            kind:
              error instanceof CalendarError
                ? error.kind
                : error instanceof SmallAuthError
                  ? error.code
                  : error instanceof z.ZodError
                    ? "invalid"
                    : "network",
            error: known
              ? error.message
              : error instanceof z.ZodError
                ? "Проверьте параметры изменения серии."
                : "Не удалось выполнить действие с серией Small.",
          };
        }
      },
    );
  handle(seriesChannels.gate, (input) => controller.gate(input));
  handle(seriesChannels.apply, (input) => controller.apply(input));
}
