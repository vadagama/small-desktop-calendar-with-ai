import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { SmallAuthError, type SmallAuth } from "./small-auth.js";
import {
  smallAuthChannels,
  type SmallAuthReply,
  type SmallAuthState,
} from "../shared/small-auth.js";

export function registerSmallAuthHandlers(
  auth: SmallAuth,
  trusted: (event: IpcMainInvokeEvent) => boolean,
  cancelActive: () => void,
) {
  const handle = (
    channel: string,
    action: (input: unknown) => Promise<SmallAuthState>,
    change = false,
  ) => {
    ipcMain.handle(
      channel,
      async (event, input: unknown): Promise<SmallAuthReply> => {
        if (!trusted(event))
          return { ok: false, error: "Доступ к Small отклонён" };
        if (change) cancelActive();
        try {
          return { ok: true, state: await action(input) };
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof SmallAuthError
                ? error.message
                : "Не удалось выполнить вход в Small",
          };
        }
      },
    );
  };
  handle(smallAuthChannels.read, () => auth.read());
  handle(smallAuthChannels.login, (input) => auth.login(input), true);
  handle(smallAuthChannels.logout, () => auth.logout(), true);
}
