import { readEventList } from "./event-list.js";
import { eventListInput } from "../shared/event-list.js";
import { seriesTarget } from "../shared/series-scope.js";
import { calendarDateAt } from "../shared/calendar-time.js";
import type { EventChangeService } from "./event-change.js";
import { collectEvents } from "./schedule.js";
import { readSchedule } from "./schedule.js";
import { readAnalytics } from "./analytics.js";
import type { TopicRule } from "../shared/analytics.js";
import { z } from "zod";
import {
  runMemoryTool,
  useMemorySelection,
  type MemoryToolContext,
} from "./memory-tools.js";
import { MemoryError } from "./assistant-memory.js";
import type { MemoryChange } from "../shared/assistant-memory.js";
import { resolveMeetingPreferences } from "./meeting-preferences.js";
import { CalendarConversation } from "./calendar-conversation.js";
import type { CalendarPerson } from "../shared/calendar.js";
import type { ParticipantMemory } from "./participant-memory.js";
import type { MeetingDraft } from "../shared/meeting-draft.js";
import { meetingDraftInput } from "../shared/meeting-draft.js";
import { prepareMeetingDraft } from "./meeting-draft.js";
import {
  meetingDeletionInput,
  peopleToolInput,
  selectParticipantsInput,
  participantMemoryInput,
  slotsToolInput,
  type CalendarToolExecutor,
} from "../shared/calendar-tools.js";
import { CalendarError, type CalendarService } from "./calendar.js";
import { SmallAuthError } from "./small-auth.js";
import type { AvailabilityService } from "./availability.js";

/** Each executor belongs to one authenticated turn; the model cannot choose an account. */
export function createCalendarToolExecutor(
  accountId: string,
  prompt: string,
  signal: AbortSignal,
  calendar: Pick<CalendarService, "searchPeople" | "events"> &
    Partial<Pick<CalendarService, "detail" | "calendars">>,
  availability: Pick<AvailabilityService, "find">,
  organizerName: string = accountId,
  registerDraft: (draft: MeetingDraft) => MeetingDraft = (draft) => draft,
  conversation = new CalendarConversation(),
  memory?: ParticipantMemory,
  organizerParticipantId?: string,
  topicRules?: () => Promise<TopicRule[]>,
  changes?: Pick<EventChangeService, "preview">,
  assistantMemory?: MemoryToolContext,
): CalendarToolExecutor {
  signal.throwIfAborted();
  conversation.bindAccount(accountId);
  const turn = ++conversation.turn;
  conversation.acceptTaskChoice(prompt);
  const counted = new Set<string>();
  let calls = 0;
  return async (name, input) => {
    let suppliedPreferences: Partial<
      import("./meeting-preferences.js").TaskPreferences
    > = {};
    signal.throwIfAborted();
    try {
      if (++calls > 24)
        throw new CalendarError(
          "invalid",
          "Лимит поиска исчерпан. Уточните запрос.",
        );
      let data;
      let checkedPeople: CalendarPerson[] = [];
      if (name === "assistantMemory" && !assistantMemory) {
        throw new CalendarError(
          "network",
          "Память недоступна. Откройте раздел «Память» для проверки.",
        );
      } else if (name === "assistantMemory" && assistantMemory) {
        data = await runMemoryTool(
          input,
          assistantMemory,
          accountId,
          prompt,
          conversation,
          calendar,
          signal,
          organizerParticipantId,
        );
        if (data.kind === "memory-selection" && data.people?.length && memory)
          await memory.used(accountId, data.people);
      } else if (name === "showEventList") {
        const q = eventListInput.parse(input);
        const person = q.organizerId
          ? conversation.people.get(q.organizerId)
          : undefined;
        if (q.organizerId && !person)
          throw new CalendarError(
            "invalid",
            "Сначала найдите организатора через searchPeople.",
          );
        if (q.organizerId && conversation.ambiguous.get(q.organizerId) === turn)
          throw new CalendarError(
            "invalid",
            "Уточните организатора у пользователя и продолжите следующим сообщением.",
          );
        data = await readEventList(accountId, q, calendar, signal);
        if (person) data.organizer = person;
      } else if (name === "listMeetings") {
        data = await readSchedule(accountId, input, calendar, signal);
        conversation.observedMeetings.clear();
        if (data.complete)
          for (const event of data.events)
            conversation.observedMeetings.set(event.key, event);
      } else if (name === "prepareMeetingDeletion") {
        const q = meetingDeletionInput.parse(input);
        const result = await collectEvents(
          accountId,
          { from: q.date, to: q.date },
          calendar,
          signal,
        );
        const event = result.events.find((e) => e.key === q.key);
        if (result.issues.length || !event)
          throw new CalendarError(
            "invalid",
            "Не удалось однозначно найти встречу. Обновите расписание и уточните выбор.",
          );
        if (
          event.recurring ||
          event.originalEventId ||
          !("id" in event.lookup)
        ) {
          if (!calendar.detail)
            throw new CalendarError("denied", "Не удалось проверить серию.");
          const fresh = await calendar.detail({
            accountId,
            lookup: event.lookup,
          });
          const target = seriesTarget(fresh);
          if (!target || fresh.participation !== "organizer")
            throw new CalendarError(
              "denied",
              "Удалять встречи серии может только её организатор.",
            );
          data = {
            kind: "meeting-delete" as const,
            accountId,
            eventId: target.eventId ?? target.seriesId,
            title: fresh.title,
            startsAt: fresh.startsAt,
            endsAt: fresh.endsAt,
            series: { ...target, scope: q.scope ?? ("occurrence" as const) },
          };
        } else {
          if (!changes)
            throw new CalendarError("denied", "Удаление недоступно.");
          if (q.scope === "following")
            throw new CalendarError(
              "invalid",
              "Выбранная встреча не является серией.",
            );
          const preview = await changes.preview({
            accountId,
            eventId: event.lookup.id,
            change: { kind: "cancel" },
          });
          data = {
            kind: "meeting-delete" as const,
            accountId,
            eventId: preview.eventId,
            title: preview.before.title,
            startsAt: preview.before.startsAt,
            endsAt: preview.before.endsAt,
          };
        }
      } else if (name === "meetingAnalytics") {
        if (!organizerParticipantId)
          throw new CalendarError(
            "denied",
            "Не удалось определить ваш профиль участника Small.",
          );
        let rules: TopicRule[] = [];
        try {
          rules = topicRules ? await topicRules() : [];
        } catch {
          throw new CalendarError(
            "invalid",
            "Не удалось прочитать правила тем. Исправьте их в настройках аналитики.",
          );
        }
        data = await readAnalytics(
          accountId,
          organizerParticipantId,
          input,
          calendar,
          signal,
          rules,
        );
      } else if (name === "searchPeople") {
        const parsed = peopleToolInput.safeParse(input);
        if (!parsed.success)
          throw new CalendarError(
            "invalid",
            "Проверьте имя и страницу поиска.",
          );
        data = await calendar.searchPeople({ ...parsed.data, accountId });
        signal.throwIfAborted();
        for (const person of data.people) {
          conversation.people.set(person.participantId, person);
          if (data.people.length > 1 || data.nextPage !== null) {
            if (!conversation.ambiguous.has(person.participantId))
              conversation.ambiguous.set(person.participantId, turn);
          }
        }
      } else if (name === "selectParticipants") {
        let {
          participantIds,
          sourceEventKey,
          rememberedAliases = [],
        } = selectParticipantsInput.parse(input);
        if (sourceEventKey) {
          const observed = conversation.observedMeetings.get(sourceEventKey);
          if (!observed)
            throw new CalendarError(
              "invalid",
              "Сначала найдите исходную встречу через listMeetings с полными данными.",
            );
          const day = calendarDateAt(observed.startsAt);
          const fresh = await collectEvents(
            accountId,
            { from: day, to: day },
            calendar,
            signal,
          );
          let source = fresh.events.find(
            (event) => event.key === sourceEventKey,
          );
          if (source && !fresh.issues.length && calendar.detail)
            source = await calendar.detail({
              accountId,
              lookup: source.lookup,
            });
          if (fresh.issues.length || !source?.participants?.length)
            throw new CalendarError(
              "invalid",
              "Состав исходной встречи недоступен. Уточните участников; не заменяйте их сохранённой группой.",
            );
          const members = source.participants.filter(
            (person) => person.id !== organizerParticipantId,
          );
          const ids = [...new Set(members.map((person) => person.id))];
          if (
            participantIds.length &&
            (participantIds.length !== ids.length ||
              participantIds.some((id) => !ids.includes(id)))
          )
            throw new CalendarError(
              "invalid",
              "Для копии нужен полный состав исходной встречи.",
            );
          const people =
            (await useMemorySelection(
              {
                participantIds: ids,
                people: members.map((person) => ({
                  participantId: person.id,
                  name: person.name,
                  position: "",
                })),
              },
              { groups: [], participants: [] },
              accountId,
              assistantMemory?.directory ?? calendar,
              signal,
              organizerParticipantId,
            )) ?? [];
          const durationMinutes = slotsToolInput.shape.durationMinutes.parse(
            (Date.parse(source.endsAt) - Date.parse(source.startsAt)) / 60000,
          );
          if (conversation.meetingSource?.key !== sourceEventKey) {
            conversation.taskPreferences = {};
            conversation.taskOptions = undefined;
            conversation.preset = undefined;
          }
          conversation.meetingSource = {
            key: sourceEventKey,
            title: source.title,
            agenda: source.description,
            location: source.location,
            durationMinutes,
          };
          for (const person of people)
            conversation.people.set(person.participantId, person);
          participantIds = ids;
          // This exact set comes from the selected source, not an ambiguous name search.
          for (const id of ids) conversation.ambiguous.delete(id);
        }
        const saved =
          rememberedAliases.length && memory
            ? await memory.read(accountId)
            : [];
        signal.throwIfAborted();
        const matchedAliases = new Set(
          rememberedAliases
            .filter((reference) =>
              saved.some(
                (person) =>
                  person.participantId === reference.participantId &&
                  person.aliases.some(
                    (alias) =>
                      alias.toLocaleLowerCase() ===
                      reference.alias.toLocaleLowerCase(),
                  ),
              ),
            )
            .map((reference) => reference.participantId),
        );
        if (participantIds.some((id) => !conversation.people.has(id)))
          throw new CalendarError(
            "invalid",
            "Сначала найдите каждого участника в каталоге.",
          );
        if (
          participantIds.some(
            (id) =>
              conversation.ambiguous.get(id) === turn &&
              !conversation.selected.includes(id) &&
              !matchedAliases.has(id),
          )
        )
          throw new CalendarError(
            "invalid",
            "Найдено несколько кандидатов. Уточните выбор у пользователя и продолжите следующим сообщением.",
          );
        conversation.selected = participantIds;
        conversation.selectionConfirmed = true;
        const people = participantIds.map((id) => conversation.people.get(id)!);
        const fresh = people.filter((p) => !counted.has(p.participantId));
        for (const p of fresh) counted.add(p.participantId);
        if (memory && fresh.length) await memory.used(accountId, fresh);
        data = {
          kind: "participants" as const,
          people,
          ...(sourceEventKey ? { source: conversation.meetingSource } : {}),
        };
      } else if (name === "participantMemory") {
        if (!memory)
          throw new CalendarError("denied", "Память участников недоступна.");
        const q = participantMemoryInput.parse(input);
        if (assistantMemory && q.action !== "recall") {
          const person = q.participantId
            ? conversation.people.get(q.participantId)
            : undefined;
          if (
            q.action === "remember" &&
            (!person ||
              !conversation.selected.includes(person.participantId) ||
              !q.alias)
          )
            throw new CalendarError("invalid", "Сначала выберите участника.");
          const state = await assistantMemory.store.read(accountId);
          const record = state.entries.find(
            (e) => e.participantId === q.participantId,
          );
          if (q.action === "forget" && !record)
            throw new CalendarError(
              "invalid",
              "Запись участника не найдена в памяти. Откройте память и удалите нужную запись.",
            );
          const change: MemoryChange =
            q.action === "remember"
              ? { action: "entry", text: `${q.alias} — ${person!.name}.` }
              : q.action === "clear"
                ? { action: "clear", category: "entries" }
                : { action: "delete", category: "entries", id: record!.id };
          const originalPrompt = conversation.memoryReview.authorize(
            {
              owner: assistantMemory.ownerId,
              epoch: assistantMemory.epoch,
              revision: state.revision,
              turn: conversation.turn,
            },
            change,
          );
          const proposal = await assistantMemory.proposals.propose(
            accountId,
            assistantMemory.ownerId,
            assistantMemory.epoch,
            originalPrompt,
            change,
            assistantMemory.messageId,
            q.action === "remember"
              ? { participantId: person!.participantId, alias: q.alias! }
              : undefined,
          );
          conversation.memoryReview.clear();
          return {
            ok: true,
            data: proposal,
          };
        }
        if (q.action === "remember") {
          const person =
            q.participantId && conversation.people.get(q.participantId);
          if (
            !person ||
            !conversation.selected.includes(person.participantId) ||
            !q.alias
          )
            throw new CalendarError(
              "invalid",
              "Сначала уточните и выберите участника, затем укажите, как его запомнить.",
            );
          await memory.remember(accountId, person, q.alias);
        } else if (q.action === "forget") {
          if (!q.participantId)
            throw new CalendarError("invalid", "Уточните, кого забыть.");
          await memory.forget(accountId, q.participantId);
        } else if (q.action === "clear") await memory.forget(accountId);
        data = {
          kind: "memory" as const,
          people: await memory.read(accountId),
        };
      } else if (name === "findSlots" || name === "prepareMeetingDraft") {
        const stored = assistantMemory
          ? await assistantMemory.store.read(accountId)
          : undefined;
        let policy: MeetingDraft["memoryPolicy"];
        if (stored) {
          if (conversation.memoryRevision !== stored.revision)
            throw new CalendarError(
              "invalid",
              "Память изменилась во время запроса. Повторите подбор.",
            );
          const baseInput =
            typeof input === "object" && input !== null
              ? (input as Record<string, unknown>)
              : {};
          const supplied = z
            .object({
              durationMinutes: slotsToolInput.shape.durationMinutes.optional(),
              timeFrom: slotsToolInput.shape.timeFrom,
              timeTo: slotsToolInput.shape.timeTo,
            })
            .parse(baseInput);
          suppliedPreferences = Object.fromEntries(
            Object.entries(supplied).filter(([, value]) => value !== undefined),
          );
          const resolution = resolveMeetingPreferences(
            stored.preferences,
            { ...conversation.taskPreferences, ...suppliedPreferences },
            conversation.preset?.durationMinutes !== undefined
              ? { durationMinutes: conversation.preset.durationMinutes }
              : {},
            conversation.meetingSource
              ? { durationMinutes: conversation.meetingSource.durationMinutes }
              : {},
          );
          const resolved = resolution.values;
          const origin = (field: string) =>
            ({
              request: "из запроса",
              preset: "из формата",
              memory: "из памяти",
              source: "из исходной встречи",
            })[
              resolution.sources[field] as
                "request" | "preset" | "memory" | "source"
            ] ?? "по умолчанию";
          const base =
            typeof input === "object" && input !== null
              ? (input as Record<string, unknown>)
              : {};
          if (conversation.taskPreferences.ignoreTimeWindow) {
            delete base.timeFrom;
            delete base.timeTo;
          }
          if ((resolved.bufferMinutes ?? 0) > 0 && !organizerParticipantId)
            throw new CalendarError(
              "invalid",
              "Не удалось определить организатора для проверки перерыва.",
            );
          input = {
            ...base,
            ...resolved,
            ...(name === "prepareMeetingDraft"
              ? {
                  title:
                    base.title ??
                    conversation.meetingSource?.title ??
                    conversation.preset?.title,
                  agenda:
                    base.agenda ??
                    conversation.meetingSource?.agenda ??
                    conversation.preset?.agenda ??
                    "",
                  location:
                    base.location ?? conversation.meetingSource?.location ?? "",
                }
              : {}),
            durationMinutes:
              resolved.durationMinutes ?? base.durationMinutes ?? 30,
          };
          // Buffer is privileged availability policy, not a public event field.
          const cleaned = { ...(input as Record<string, unknown>) };
          delete cleaned.bufferMinutes;
          if (name === "prepareMeetingDraft") {
            delete cleaned.timeFrom;
            delete cleaned.timeTo;
          }
          input = cleaned;
          if (organizerParticipantId)
            policy = {
              revision: stored.revision,
              bufferMinutes: resolved.bufferMinutes ?? 0,
              organizerParticipantId,
              ...(resolved.timeFrom ? { timeFrom: resolved.timeFrom } : {}),
              ...(resolved.timeTo ? { timeTo: resolved.timeTo } : {}),
              summary: [
                `${resolved.durationMinutes ?? base.durationMinutes ?? 30} мин (${resolved.durationMinutes !== undefined ? origin("durationMinutes") : base.durationMinutes !== undefined ? "из запроса" : "по умолчанию"})`,
                resolved.timeFrom
                  ? `с ${resolved.timeFrom} (${origin("timeFrom")})`
                  : "",
                resolved.timeTo
                  ? `до ${resolved.timeTo} (${origin("timeTo")})`
                  : "",
                `перерыв ${resolved.bufferMinutes ?? 0} мин (${origin("bufferMinutes")})`,
                conversation.preset
                  ? `формат «${conversation.preset.name}»`
                  : "",
              ]
                .filter(Boolean)
                .join(" · "),
            };
        }
        const parsed = (
          name === "findSlots" ? slotsToolInput : meetingDraftInput
        ).safeParse(input);
        if (!parsed.success)
          throw new CalendarError(
            "invalid",
            "Проверьте участников, дату и длительность.",
          );
        const requestedParticipants = parsed.data.participantIds.filter(
          (id) =>
            id !== organizerParticipantId || conversation.selected.includes(id),
        );
        if (
          (!conversation.selected.length && !conversation.selectionConfirmed) ||
          (!requestedParticipants.length && !organizerParticipantId) ||
          conversation.selected.length !== requestedParticipants.length ||
          new Set(conversation.selected).size !==
            conversation.selected.length ||
          requestedParticipants.some(
            (id) => !conversation.selected.includes(id),
          )
        )
          throw new CalendarError(
            "invalid",
            "Сначала уточните и выберите полный состав участников.",
          );
        checkedPeople = requestedParticipants.map((id) => ({
          ...conversation.people.get(id)!,
        }));
        if (
          organizerParticipantId &&
          !parsed.data.participantIds.includes(organizerParticipantId)
        ) {
          parsed.data.participantIds = [
            ...parsed.data.participantIds,
            organizerParticipantId,
          ];
        }
        if (
          organizerParticipantId &&
          !checkedPeople.some(
            (person) => person.participantId === organizerParticipantId,
          )
        )
          checkedPeople.push({
            participantId: organizerParticipantId,
            name: organizerName,
            position: "",
          });
        data =
          name === "findSlots"
            ? await availability.find({
                ...parsed.data,
                accountId,
                ...(policy
                  ? {
                      bufferMinutes: policy.bufferMinutes,
                      organizerParticipantId: policy.organizerParticipantId,
                    }
                  : {}),
              })
            : await prepareMeetingDraft(
                {
                  id: accountId,
                  name: organizerName,
                  ...(organizerParticipantId
                    ? { participantId: organizerParticipantId }
                    : {}),
                },
                parsed.data,
                availability,
                signal,
                true,
                policy,
              );
      } else throw new CalendarError("denied", "Инструмент недоступен.");
      signal.throwIfAborted();
      if (name === "findSlots" || name === "prepareMeetingDraft") {
        conversation.taskPreferences = {
          ...conversation.taskPreferences,
          ...suppliedPreferences,
        };
      }
      if ("kind" in data && data.kind === "meeting-draft")
        data = registerDraft({ ...data, participants: checkedPeople });
      else if ("slots" in data) data = { ...data, people: checkedPeople };
      return { ok: true, data };
    } catch (error) {
      signal.throwIfAborted();
      return {
        ok: false,
        kind:
          error instanceof MemoryError
            ? error.kind === "unavailable"
              ? "network"
              : "invalid"
            : error instanceof CalendarError
              ? error.kind
              : error instanceof SmallAuthError
                ? error.code
                : "network",
        error:
          error instanceof z.ZodError
            ? "Проверьте параметры инструмента."
            : error instanceof CalendarError ||
                error instanceof SmallAuthError ||
                error instanceof MemoryError
              ? error.message
              : "Не удалось прочитать календарь Small.",
      };
    }
  };
}
