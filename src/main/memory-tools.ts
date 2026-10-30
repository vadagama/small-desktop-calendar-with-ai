import {
  assistantMemoryToolInput,
  memoryChange,
  taskOption,
  type AssistantMemoryState,
  type MemoryGroup,
  type MemoryPreset,
} from "../shared/assistant-memory.js";
import type { CalendarPerson } from "../shared/calendar.js";
import { CalendarError, type CalendarService } from "./calendar.js";
import type { AssistantMemoryStore } from "./assistant-memory.js";
import type { MemoryProposals } from "./memory-proposals.js";
import type { CalendarConversation } from "./calendar-conversation.js";
import { MemoryError } from "./assistant-memory.js";

export interface MemoryToolContext {
  store: AssistantMemoryStore;
  proposals: MemoryProposals;
  ownerId: number;
  epoch: number;
  messageId: string;
  directory?: Pick<CalendarService, "searchPeople">;
}
export async function useMemorySelection(
  value: Pick<MemoryPreset, "participantIds" | "people" | "groupId">,
  state: Pick<AssistantMemoryState, "groups" | "participants">,
  accountId: string,
  calendar: Pick<CalendarService, "searchPeople">,
  signal: AbortSignal,
  organizerId?: string,
) {
  let ids = value.participantIds;
  let savedPeople = value.people;
  if ("groupId" in value && value.groupId) {
    const group = state.groups.find((g) => g.id === value.groupId);
    if (!group)
      throw new CalendarError(
        "invalid",
        "Группа формата удалена. Исправьте формат встречи.",
      );
    ids = group.participantIds;
    savedPeople = group.people;
  }
  if (!ids?.length) return null;
  if (new Set([...ids, ...(organizerId ? [organizerId] : [])]).size > 20)
    throw new CalendarError(
      "invalid",
      "Вместе с организатором допустимо до 20 участников.",
    );
  const people: CalendarPerson[] = [];
  for (const id of ids) {
    const saved =
      savedPeople?.find((p) => p.participantId === id) ??
      state.participants.find((p) => p.participantId === id);
    if (!saved)
      throw new CalendarError(
        "invalid",
        "Не хватает сведений об участнике. Откройте группу в памяти и выберите его заново.",
      );
    let page: number | null = 1,
      found: CalendarPerson | undefined;
    for (let count = 0; page !== null && count < 20; count++) {
      signal.throwIfAborted();
      const result = await calendar.searchPeople({
        accountId,
        query: saved.name,
        page,
      });
      found = result.people.find((p) => p.participantId === id);
      if (found) break;
      page = result.nextPage;
    }
    signal.throwIfAborted();
    if (!found)
      throw new CalendarError(
        "invalid",
        `Участник «${saved.name}» не подтверждён в каталоге. Уточните состав.`,
      );
    people.push(found);
  }
  return people;
}

export async function runMemoryTool(
  input: unknown,
  ctx: MemoryToolContext,
  accountId: string,
  prompt: string,
  conversation: CalendarConversation,
  calendar: Pick<CalendarService, "searchPeople">,
  signal: AbortSignal,
  organizerId?: string,
) {
  calendar = ctx.directory ?? calendar;
  const q = assistantMemoryToolInput.parse(input);
  const state = await ctx.store.read(accountId);
  signal.throwIfAborted();
  if (q.action === "recall") {
    conversation.memoryReview.recall(state.revision);
    const query = q.query?.toLocaleLowerCase();
    let budget = 12000;
    let truncated = false;
    const fit = <T>(items: T[]) =>
      items.filter((item) => {
        const length = JSON.stringify(item).length;
        if (length > budget) {
          truncated = true;
          return false;
        }
        budget -= length;
        return true;
      });
    const result = {
      kind: "assistant-memory" as const,
      state: {
        ...state,
        entries: fit(
          state.entries.filter(
            (e) => !query || e.text.toLocaleLowerCase().includes(query),
          ),
        ),
        groups: fit(
          state.groups.filter(
            (e) => !query || e.name.toLocaleLowerCase().includes(query),
          ),
        ),
        presets: fit(
          state.presets.filter(
            (e) => !query || e.name.toLocaleLowerCase().includes(query),
          ),
        ),
        participants: [],
      },
    };
    return {
      ...result,
      task: {
        participantIds: conversation.selected,
        selectionConfirmed: conversation.selectionConfirmed,
        source: conversation.meetingSource,
        preferences: conversation.taskPreferences,
        options: conversation.taskOptions?.options ?? [],
      },
      truncated,
      hint: truncated
        ? "Показана часть памяти. Уточните query для релевантного контекста."
        : "",
    };
  }
  const reviewContext = {
    owner: ctx.ownerId,
    epoch: ctx.epoch,
    revision: state.revision,
    turn: conversation.turn,
  };
  if (q.action === "cancel") {
    conversation.memoryReview.clear();
    return {
      kind: "memory-selection" as const,
      message: "Уточнение памяти отменено. Память не изменена.",
    };
  }
  if (q.action === "review") {
    if (!q.questions)
      throw new MemoryError(
        "Передайте questions: [] если неоднозначностей нет, иначе список вопросов.",
      );
    return conversation.memoryReview.review(
      reviewContext,
      prompt,
      memoryChange.parse(q.change),
      q.questions,
      q.evidence,
    );
  }
  if (q.action === "propose") {
    const change = memoryChange.parse(q.change);
    const originalPrompt = conversation.memoryReview.authorize(
      reviewContext,
      change,
    );
    if (
      change.action === "group" ||
      (change.action === "preset" && change.value.participantIds)
    ) {
      const ids = change.value.participantIds!;
      if (ids.some((id) => !conversation.selected.includes(id)))
        throw new CalendarError(
          "invalid",
          "Сначала выполните searchPeople для каждого участника, затем selectParticipants с полным составом и повторите assistantMemory propose. При неоднозначности уточните выбор у пользователя.",
        );
      change.value.people = ids.map((id) => conversation.people.get(id)!);
    }
    const proposal = await ctx.proposals.propose(
      accountId,
      ctx.ownerId,
      ctx.epoch,
      originalPrompt,
      change,
      ctx.messageId,
    );
    conversation.memoryReview.clear();
    return proposal;
  }
  if (q.action === "offerTask") {
    const options = taskOption.array().min(1).max(5).parse(q.options);
    conversation.taskOptions = {
      options,
      turn: conversation.turn,
      expires: Date.now() + 10 * 60_000,
    };
    return {
      kind: "task-options" as const,
      message:
        "Предложите эти варианты пользователю и дождитесь ответа. Значения ещё не применены.",
      options,
    };
  }
  if (q.action === "task") {
    if (
      !q.evidence ||
      !conversation.hasTaskEvidence(q.evidence, prompt) ||
      (q.resetTask && !prompt.includes(q.evidence))
    )
      throw new CalendarError(
        "invalid",
        "Укажите точную цитату текущей или предыдущей просьбы пользователя. Для ответа «да» или номера сначала предложите параметры через offerTask.",
      );
    if (q.resetTask) {
      conversation.taskOptions = undefined;
      conversation.meetingSource = undefined;
      conversation.observedMeetings.clear();
      conversation.taskPreferences = {};
      conversation.preset = undefined;
      conversation.selected = [];
      conversation.selectionConfirmed = false;
    }
    conversation.taskPreferences = {
      ...conversation.taskPreferences,
      ...q.preferences,
      ...(q.ignoreBuffer !== undefined ? { ignoreBuffer: q.ignoreBuffer } : {}),
      ...(q.ignoreTimeWindow !== undefined
        ? { ignoreTimeWindow: q.ignoreTimeWindow }
        : {}),
    };
    return {
      kind: "memory-selection" as const,
      message:
        "Разовые параметры текущей задачи обновлены. Постоянная память не менялась.",
    };
  }
  const items = q.action === "useGroup" ? state.groups : state.presets;
  const matches = items.filter((e) =>
    q.id
      ? e.id === q.id
      : q.query &&
        e.name.toLocaleLowerCase() === q.query.trim().toLocaleLowerCase(),
  );
  if (matches.length !== 1)
    throw new CalendarError("invalid", "Уточните название группы или формата.");
  const value = matches[0]!;
  if (!q.id && !/групп|команд|формат|group|preset/iu.test(prompt)) {
    const result = await calendar.searchPeople({
      accountId,
      query: value.name,
      page: 1,
    });
    signal.throwIfAborted();
    if (
      result.people.some(
        (p) =>
          p.name.trim().toLocaleLowerCase() ===
          value.name.trim().toLocaleLowerCase(),
      )
    )
      throw new CalendarError(
        "invalid",
        "Это имя есть и в каталоге людей, и в памяти. Уточните: человек или сохранённая группа/формат?",
      );
  }
  const people = await useMemorySelection(
    value,
    state,
    accountId,
    calendar,
    signal,
    organizerId,
  );
  if (people) {
    for (const person of people)
      conversation.people.set(person.participantId, person);
    conversation.selected = people.map((p) => p.participantId);
    conversation.selectionConfirmed = true;
  }
  if (q.action === "usePreset") conversation.preset = value as MemoryPreset;
  return {
    kind: "memory-selection" as const,
    message: `Используется «${value.name}». Состав заново проверен в каталоге; перед созданием покажите его пользователю.`,
    ...(people ? { people } : {}),
  };
}
