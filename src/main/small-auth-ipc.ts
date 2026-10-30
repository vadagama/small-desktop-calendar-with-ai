import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
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
  accountChanged: () => Promise<void>,
) {
  auth.subscribeRequired(() => {
    for (const window of BrowserWindow.getAllWindows())
      if (!window.isDestroyed())
        window.webContents.send(smallAuthChannels.required);
  });
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
        if (change) {
          cancelActive();
          // Sign-in and sign-out both drop the previous account's cached calendar.
          await accountChanged();
        }
        try {
          return { ok: true, state: await action(input) };
        } catch (error) {
          return {
            ok: false,
            kind: error instanceof SmallAuthError ? error.code : "network",
            error:
              error instanceof SmallAuthError
                ? error.message
                : "Не удалось выполнить вход в Small",
          };
        } finally {
          // The old session was still valid while the change ran, so a read could have
          // refilled the cache meanwhile: clear once more now that the change is over.
          if (change) await accountChanged();
        }
      },
    );
  };
  handle(smallAuthChannels.read, async () => {
    const state = await auth.read();
    // Nobody is signed in, so no cached calendar may remain (e.g. after a failed clean-up).
    if (state.status === "signed-out") await accountChanged();
    return state;
  });
  handle(smallAuthChannels.login, (input) => auth.login(input), true);
  handle(smallAuthChannels.logout, () => auth.logout(), true);
}
