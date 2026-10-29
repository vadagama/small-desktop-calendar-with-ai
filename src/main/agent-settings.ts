import { agentSettingsSchema } from "./agent-settings-schema.js";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  loadAgentDefaults,
  migrateBundledSkills,
} from "../agent/agent-content.js";
import { type AgentSettingsState } from "../shared/agent-settings.js";

export class AgentSettingsStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}
  async read(): Promise<AgentSettingsState> {
    await this.pending;
    const defaults = await loadAgentDefaults(this.directory);
    try {
      const saved = agentSettingsSchema.parse(
        JSON.parse(
          await readFile(join(this.directory, "agent-settings.json"), "utf8"),
        ),
      );
      const originalTemplates = [
        "Найди 30 минут завтра после обеда",
        "Подготовь встречу по развитию календаря",
        "Помоги выбрать участников встречи",
      ];
      const unchanged =
        JSON.stringify(saved.promptTemplates) ===
        JSON.stringify(originalTemplates);
      return migrateBundledSkills({
        ...defaults,
        settings: {
          ...defaults.settings,
          ...saved,
          ...(unchanged
            ? { promptTemplates: defaults.settings.promptTemplates }
            : {}),
        },
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return defaults;
      throw new Error("Не удалось прочитать настройки ассистента");
    }
  }
  save(input: unknown): Promise<AgentSettingsState> {
    const operation = this.pending.then(async () => {
      const settings = agentSettingsSchema.parse(input);
      const defaults = await loadAgentDefaults(this.directory);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = join(
        this.directory,
        `agent-settings.${crypto.randomUUID()}.tmp`,
      );
      try {
        await writeFile(temporary, JSON.stringify(settings, null, 2), {
          mode: 0o600,
        });
        await rename(temporary, join(this.directory, "agent-settings.json"));
      } finally {
        await rm(temporary, { force: true });
      }
      return { ...defaults, settings };
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
  async reset() {
    return this.save((await loadAgentDefaults(this.directory)).settings);
  }
}
