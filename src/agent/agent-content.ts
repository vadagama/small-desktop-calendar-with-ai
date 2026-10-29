import { join } from "node:path";
import { readFile } from "node:fs/promises";
import {
  skillIds,
  moodIds,
  templateIds,
  referenceIds,
  type AgentSettingsState,
} from "../shared/agent-settings.js";

export async function loadAgentDefaults(
  directory?: string,
): Promise<AgentSettingsState> {
  const root = new URL("./content/", import.meta.url);
  const read = async (path: string) =>
    (await readFile(new URL(path, root), "utf8")).trim();
  const templates = Object.fromEntries(
    await Promise.all(
      templateIds.map(async (id) => {
        let text = await read(`templates/${id}.md`);
        if (directory) {
          try {
            const custom = await readFile(
              join(directory, "assistant-templates", `${id}.md`),
              "utf8",
            );
            if (custom.length > 16000 || !custom.trim())
              throw new Error("Некорректный шаблон");
            text = custom.trim();
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
        return [id, text];
      }),
    ),
  ) as AgentSettingsState["templates"];
  return {
    templates,
    references: Object.fromEntries(
      await Promise.all(
        referenceIds.map(async (id) => [id, await read(`references/${id}.md`)]),
      ),
    ) as AgentSettingsState["references"],
    moods: Object.fromEntries(
      await Promise.all(
        moodIds.map(async (id) => [id, await read(`moods/${id}.md`)]),
      ),
    ) as AgentSettingsState["moods"],
    system: await readFile(new URL("system.md", root), "utf8"),
    settings: {
      version: 2,
      mood: "neutral",
      instructions: "",
      skills: await Promise.all(
        skillIds.map(async (id) => ({
          id,
          enabled: true,
          content: (
            await readFile(new URL(`skills/${id}/SKILL.md`, root), "utf8")
          ).trim(),
        })),
      ),
    },
  };
}

export async function migrateBundledSkills(
  state: AgentSettingsState,
): Promise<AgentSettingsState> {
  if (state.settings.version !== 1) return state;
  const defaults = await loadAgentDefaults();
  for (const skill of state.settings.skills) {
    const old = await readFile(
      new URL(`./content/legacy/${skill.id}.md`, import.meta.url),
      "utf8",
    );
    if (skill.content.trim() === old.trim())
      skill.content = defaults.settings.skills.find(
        (s) => s.id === skill.id,
      )!.content;
  }
  state.settings.version = 2;
  return state;
}
