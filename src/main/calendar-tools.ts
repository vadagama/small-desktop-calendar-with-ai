import { readSchedule } from "./schedule.js";
import { readAnalytics } from "./analytics.js";
import { z } from "zod";
import { CalendarConversation } from "./calendar-conversation.js";
import type { CalendarPerson } from "../shared/calendar.js";
import type { ParticipantMemory } from "./participant-memory.js";
import type { MeetingDraft } from "../shared/meeting-draft.js";
import { meetingDraftInput } from "../shared/meeting-draft.js";
import { prepareMeetingDraft } from "./meeting-draft.js";
import {
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
  calendar: Pick<CalendarService, "searchPeople" | "events">,
  availability: Pick<AvailabilityService, "find">,
  organizerName: string = accountId,
  registerDraft: (draft: MeetingDraft) => MeetingDraft = (draft) => draft,
  conversation = new CalendarConversation(),
  memory?: ParticipantMemory,
  organizerParticipantId?: string,
): CalendarToolExecutor {
  conversation.bindAccount(accountId);
  const turn = ++conversation.turn;
  const counted = new Set<string>();
  let calls = 0;
  return async (name, input) => {
    signal.throwIfAborted();
    try {
      if (++calls > 24)
        throw new CalendarError(
          "invalid",
          "Лимит поиска исчерпан. Уточните запрос.",
        );
      let data;
      let checkedPeople: CalendarPerson[] = [];
      if (name === "listMeetings") {
        data = await readSchedule(accountId, input, calendar, signal);
      } else if (name === "meetingAnalytics") {
        if (!organizerParticipantId)
          throw new CalendarError(
            "denied",
            "Не удалось определить ваш профиль участника Small.",
          );
        data = await readAnalytics(
          accountId,
          organizerParticipantId,
          input,
          calendar,
          signal,
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
        const { participantIds, rememberedAliases = [] } =
          selectParticipantsInput.parse(input);
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
        const people = participantIds.map((id) => conversation.people.get(id)!);
        const fresh = people.filter((p) => !counted.has(p.participantId));
        for (const p of fresh) counted.add(p.participantId);
        if (memory && fresh.length) await memory.used(accountId, fresh);
        data = { kind: "participants" as const, people };
      } else if (name === "participantMemory") {
        if (!memory)
          throw new CalendarError("denied", "Память участников недоступна.");
        const q = participantMemoryInput.parse(input);
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
          !conversation.selected.length ||
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
            ? await availability.find({ ...parsed.data, accountId })
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
              );
      } else throw new CalendarError("denied", "Инструмент недоступен.");
      signal.throwIfAborted();
      if ("kind" in data && data.kind === "meeting-draft")
        data = registerDraft({ ...data, participants: checkedPeople });
      else if ("slots" in data) data = { ...data, people: checkedPeople };
      return { ok: true, data };
    } catch (error) {
      signal.throwIfAborted();
      return {
        ok: false,
        kind:
          error instanceof CalendarError
            ? error.kind
            : error instanceof SmallAuthError
              ? error.code
              : "network",
        error:
          error instanceof z.ZodError
            ? "Проверьте параметры инструмента."
            : error instanceof CalendarError || error instanceof SmallAuthError
              ? error.message
              : "Не удалось прочитать календарь Small.",
      };
    }
  };
}
