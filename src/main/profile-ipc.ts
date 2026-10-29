import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { ProfileError, type ProfileStore } from "./profiles.js";
import {
  profileChannels,
  type ProfileReply,
  type ProfileState,
} from "../shared/profiles.js";

export function registerProfileHandlers(
  store: ProfileStore,
  trusted: (event: IpcMainInvokeEvent) => boolean,
  cancelActive: () => void,
) {
  const handle = (
    channel: string,
    change: boolean,
    action: (input: unknown) => Promise<ProfileState>,
  ) => {
    ipcMain.handle(
      channel,
      async (event, input: unknown): Promise<ProfileReply> => {
        if (!trusted(event))
          return { ok: false, error: "Доступ к настройкам отклонён" };
        if (change) cancelActive();
        try {
          return { ok: true, state: await action(input) };
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof ProfileError
                ? error.message
                : "Не удалось изменить настройки модели или получить доступ к Keychain",
          };
        }
      },
    );
  };
  handle(profileChannels.read, false, () => store.state());
  handle(profileChannels.save, true, (input) => store.save(input));
  handle(profileChannels.activate, true, (input) => store.activate(input));
  handle(profileChannels.remove, true, (input) => store.remove(input));
}
