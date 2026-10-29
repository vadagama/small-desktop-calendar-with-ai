import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { TopicRulesReply } from "../shared/analytics.js";
import { topicRuleChannels } from "../shared/topic-rule-channels.js";
import type { TopicRuleStore } from "./topic-rules.js";

export function registerTopicRuleHandlers(
  store: TopicRuleStore,
  trusted: (event: IpcMainInvokeEvent) => boolean,
) {
  const handle = (
    channel: string,
    action: (input: unknown) => Promise<unknown>,
  ) =>
    ipcMain.handle(
      channel,
      async (event, input: unknown): Promise<TopicRulesReply> => {
        if (!trusted(event))
          return { ok: false, error: "Доступ к правилам тем отклонён" };
        try {
          return { ok: true, rules: (await action(input)) as never };
        } catch {
          return {
            ok: false,
            error:
              "Не удалось сохранить правила. Проверьте: до 20 тем, у каждой от 1 до 20 слов длиной до 60 символов, названия не повторяются.",
          };
        }
      },
    );
  handle(topicRuleChannels.read, () => store.read());
  handle(topicRuleChannels.save, (input) => store.save(input));
}
