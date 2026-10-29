export const moodIds = [
  "neutral",
  "strict",
  "youthful",
  "alpha",
  "technical",
] as const;
export type Mood = (typeof moodIds)[number];
export const moodLabels: Record<Mood, string> = {
  neutral: "Нейтральный",
  strict: "Строгий",
  youthful: "Молодёжный",
  alpha: "Альфа",
  technical: "Технарь",
};
export const templateIds = [
  "welcome",
  "people",
  "slots",
  "draft",
  "suggestions",
] as const;
export type AssistantTemplates = Record<(typeof templateIds)[number], string>;
export const referenceIds = [
  "people",
  "scheduling",
  "response-templates",
] as const;
export const skillIds = [
  "people-search",
  "availability",
  "meeting-draft",
  "schedule",
] as const;
export type SkillId = (typeof skillIds)[number];
export interface AgentSettings {
  version: 1 | 2 | 3;
  mood: Mood;
  instructions: string;
  promptTemplates?: string[] | undefined;
  skills: { id: SkillId; enabled: boolean; content: string }[];
}
export interface AgentSettingsState {
  system: string;
  templates: AssistantTemplates;
  references: Record<(typeof referenceIds)[number], string>;
  moods: Record<Mood, string>;
  settings: AgentSettings;
}
export type AgentSettingsReply =
  { ok: true; state: AgentSettingsState } | { ok: false; error: string };
export interface AgentSettingsBridge {
  read(): Promise<AgentSettingsReply>;
  save(settings: AgentSettings): Promise<AgentSettingsReply>;
  reset(): Promise<AgentSettingsReply>;
}
export const agentSettingsChannels = {
  read: "agent-settings:read",
  save: "agent-settings:save",
  reset: "agent-settings:reset",
} as const;
export const skillLabels: Record<SkillId, string> = {
  "people-search": "Поиск сотрудников",
  availability: "Подбор времени",
  "meeting-draft": "Черновик встречи",
  schedule: "Просмотр расписания",
};
