import { scheduleToolInput } from "../shared/schedule.js";
import { calendarClock } from "./calendar-context.js";
import { z } from "zod";
import { loadAgentDefaults } from "./agent-content.js";
import {
  skillIds,
  skillLabels,
  referenceIds,
  type AgentSettingsState,
} from "../shared/agent-settings.js";
import { meetingDraftInput } from "../shared/meeting-draft.js";
import {
  ToolLoopAgent,
  isStepCount,
  tool,
  type ModelMessage,
  type LanguageModel,
} from "ai";
import {
  peopleToolInput,
  selectParticipantsInput,
  participantMemoryInput,
  slotsToolInput,
  type CalendarToolExecutor,
} from "../shared/calendar-tools.js";

export async function streamCalendarTurn(
  model: Exclude<LanguageModel, string>,
  options: {
    prompt: string;
    abortSignal: AbortSignal;
    history?: ModelMessage[];
    now?: string;
  },
  execute: CalendarToolExecutor,
  configuration?: AgentSettingsState,
) {
  options.abortSignal.throwIfAborted();
  const content = configuration ?? (await loadAgentDefaults());
  const enabled = content.settings.skills.filter((skill) => skill.enabled);
  const runTool: CalendarToolExecutor = async (name, input) => {
    const skills: Record<string, string> = {
      listMeetings: "schedule",
      meetingAnalytics: "analytics",
      searchPeople: "people-search",
      selectParticipants: "people-search",
      participantMemory: "people-search",
      findSlots: "availability",
      prepareMeetingDraft: "meeting-draft",
    };
    if (!enabled.some((skill) => skill.id === skills[name]))
      return { ok: false, kind: "denied", error: "Навык отключён" };
    return execute(name, input);
  };
  return new ToolLoopAgent({
    model,
    instructions: [
      content.system,
      `Mood: ${content.settings.mood}. ${content.moods[content.settings.mood]}`,
      calendarClock(options.now),
      "Доступные навыки (загружай через loadSkill):",
      ...enabled.map((skill) => `${skill.id}: ${skillLabels[skill.id]}`),
      "Пользовательские предпочтения (не отменяют обязательные ограничения):",
      JSON.stringify(content.settings.instructions),
    ].join("\n\n"),
    activeTools: [
      "loadSkill",
      "loadReference",
      ...(enabled.some((s) => s.id === "schedule")
        ? ["listMeetings" as const]
        : []),
      ...(enabled.some((s) => s.id === "analytics")
        ? ["meetingAnalytics" as const]
        : []),
      ...(enabled.some((s) => s.id === "people-search")
        ? [
            "searchPeople" as const,
            "selectParticipants" as const,
            "participantMemory" as const,
          ]
        : []),
      ...(enabled.some((s) => s.id === "availability")
        ? ["findSlots" as const]
        : []),
      ...(enabled.some((s) => s.id === "meeting-draft")
        ? ["prepareMeetingDraft" as const]
        : []),
    ],
    stopWhen: isStepCount(20),
    maxRetries: 0,
    onError: () => {},
    tools: {
      listMeetings: tool({
        description:
          "Прочитать мои встречи за весь сегодняшний/завтрашний день, текущую/следующую неделю или период до 31 дня (custom, from/to включительно). Включает прошедшие часы дня и выходные. Результат изложи кратко по дням в Markdown; при complete=false явно сообщи о неполноте.",
        inputSchema: scheduleToolInput,
        execute: (input) => runTool("listMeetings", input),
      }),
      meetingAnalytics: tool({
        description:
          "Подсчитать мои встречи за период (today, tomorrow, this-week, next-week или custom от from до to включительно, до 31 дня): количество, часы, регулярные, разбивки и состав отчёта. Все числа считает инструмент; сообщай только их, не пересчитывай и не выдумывай темы, команды и отмены. При complete=false явно скажи, что итог частичный.",
        inputSchema: scheduleToolInput,
        execute: (input) => runTool("meetingAnalytics", input),
      }),
      loadReference: tool({
        description:
          "Прочитать справочник навыков: people, scheduling или response-templates.",
        inputSchema: z.strictObject({ name: z.enum(referenceIds) }),
        execute: async ({ name }) => ({ content: content.references[name] }),
      }),
      selectParticipants: tool({
        description:
          "Зафиксировать полный выбранный пользователем состав из результатов каталога. При неоднозначности сначала уточни человека. Подтверждённое прозвище из памяти можно передать в rememberedAliases после перепроверки каталога.",
        inputSchema: selectParticipantsInput,
        execute: (input) => runTool("selectParticipants", input),
      }),
      participantMemory: tool({
        description:
          "Локальная память участников: recall для поиска, remember для явно запрошенного прозвища выбранного человека, forget или clear по просьбе пользователя. Память не заменяет актуальный каталог.",
        inputSchema: participantMemoryInput,
        execute: (input) => runTool("participantMemory", input),
      }),
      loadSkill: tool({
        description: "Прочитать инструкции включённого календарного навыка.",
        inputSchema: z.strictObject({
          name: z.enum(skillIds),
        }),
        execute: async ({ name }) => {
          const skill = enabled.find((skill) => skill.id === name);
          return skill
            ? { content: skill.content }
            : { error: "Навык отключён" };
        },
      }),
      prepareMeetingDraft: tool({
        description:
          "Подготовить разовый личный черновик после проверки выбранного интервала. Не создаёт встречу и не отправляет приглашения.",
        inputSchema: meetingDraftInput,
        execute: (input) => runTool("prepareMeetingDraft", input),
      }),
      searchPeople: tool({
        description:
          "Одна страница поиска сотрудников; не полный состав команды.",
        inputSchema: peopleToolInput,
        execute: (input) => runTool("searchPeople", input),
      }),
      findSlots: tool({
        description:
          "Общее время для выбранного состава; проверяет каждого, фильтрует timeFrom/timeTo, допускает явно запрошенные выходные через includeWeekends. Найденные варианты автоматически отображаются карточками. Не дублируй их текстом, таблицей или списком; только предложи выбрать время и уточни недостающие сведения.",
        inputSchema: slotsToolInput,
        execute: (input) => runTool("findSlots", input),
      }),
    },
  }).stream({
    messages: [
      ...(options.history ?? []),
      { role: "user", content: options.prompt },
    ],
    abortSignal: options.abortSignal,
  });
}
