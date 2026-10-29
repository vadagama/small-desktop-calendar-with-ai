import { randomUUID } from "node:crypto";
import {
  meetingDraftInput,
  type MeetingDraft,
} from "../shared/meeting-draft.js";
import { calendarDateAt } from "../shared/calendar-time.js";
import { CalendarError } from "./calendar.js";
import type { AvailabilityService } from "./availability.js";

/** Preview only. This module has no event-write capability or confirmation state. */
export async function prepareMeetingDraft(
  organizer: { id: string; name: string },
  input: unknown,
  availability: Pick<AvailabilityService, "find">,
  signal: AbortSignal,
): Promise<MeetingDraft> {
  signal.throwIfAborted();
  const parsed = meetingDraftInput.safeParse(input);
  if (!parsed.success)
    throw new CalendarError(
      "invalid",
      "Проверьте название, состав, время и ссылку черновика.",
    );
  const q = parsed.data;
  const start = Date.parse(q.startsAt);
  const end = start + q.durationMinutes * 60000;
  const result = await availability.find({
    accountId: organizer.id,
    participantIds: q.participantIds,
    date: calendarDateAt(q.startsAt),
    durationMinutes: q.durationMinutes,
  });
  signal.throwIfAborted();
  if (
    !result.slots.some(
      (slot) =>
        Date.parse(slot.start) === start && Date.parse(slot.end) === end,
    )
  )
    throw new CalendarError(
      "invalid",
      "Выбранный интервал не подтверждён для всех участников. Подберите другое время.",
    );
  return {
    kind: "meeting-draft",
    status: "preview",
    id: randomUUID(),
    title: q.title,
    agenda: q.agenda,
    participantIds: q.participantIds,
    organizer: { ...organizer },
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(),
    durationMinutes: q.durationMinutes,
    timezone: "Asia/Almaty",
    location: q.location,
    conferenceUrl:
      q.conference.mode === "none"
        ? null
        : q.conference.mode === "custom"
          ? q.conference.url
          : `https://meet.small.kz/${randomUUID()}`,
    recurrence: "none",
    visibility: "private",
    availabilityCheckedAt: new Date().toISOString(),
  };
}
