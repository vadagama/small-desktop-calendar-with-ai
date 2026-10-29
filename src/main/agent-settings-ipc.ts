import { ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  agentSettingsChannels,
  type AgentSettingsReply,
  type AgentSettingsState,
} from "../shared/agent-settings.js";
import type { AgentSettingsStore } from "./agent-settings.js";

export function registerAgentSettingsHandlers(
  store: AgentSettingsStore,
  trusted: (event: IpcMainInvokeEvent) => boolean,
) {
  const handle = (
    channel: string,
    action: (input: unknown) => Promise<AgentSettingsState>,
  ) => {
    ipcMain.handle(
      channel,
      async (event, input: unknown): Promise<AgentSettingsReply> => {
        if (!trusted(event))
          return { ok: false, error: "Доступ к настройкам отклонён" };
        try {
          return { ok: true, state: await action(input) };
        } catch {
          return {
            ok: false,
            error:
              "Не удалось прочитать или сохранить настройки. Проверьте текст либо восстановите стандартные.",
          };
        }
      },
    );
  };
  handle(agentSettingsChannels.read, () => store.read());
  handle(agentSettingsChannels.save, (input) => store.save(input));
  handle(agentSettingsChannels.reset, () => store.reset());
}
