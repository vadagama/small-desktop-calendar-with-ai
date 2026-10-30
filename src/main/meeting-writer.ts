import { MeetingCreateRejected } from "./meeting-create-error.js";
import { meetingOccurrences } from "./meeting-occurrences.js";
import { recurrenceRule } from "../shared/meeting-options.js";
import { z } from "zod";
import type { MeetingDraft } from "../shared/meeting-draft.js";
import { calendarDateAt } from "../shared/calendar-time.js";
import {
  calendarJson,
  CalendarError,
  type CalendarService,
} from "./calendar.js";
import type { SmallAuth } from "./small-auth.js";
import type { AvailabilityService } from "./availability.js";
import type { MeetingWriter } from "./meeting-operations.js";
import { meetingPayload } from "./meeting-request.js";
const id = z
  .union([
    z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    z.number().int().nonnegative(),
  ])
  .transform(String);
const detail = z.object({
  data: z.object({
    id,
    title: z.string(),
    description: z
      .string()
      .nullable()
      .transform((value) => value ?? ""),
    location: z
      .string()
      .nullable()
      .transform((value) => value ?? ""),
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }),
    is_public: z.boolean(),
    is_recurring: z.boolean(),
    calendar_ids: z.array(id).optional(),
    notification_recipients: z.array(z.object({ id })).optional(),
    attachments: z.array(z.object({ id })).optional(),
    recurrence_rule: recurrenceRule.nullish(),
    participants: z.array(z.object({ id })).max(100),
  }),
});
export class SmallMeetingWriter implements MeetingWriter {
  constructor(
    private auth: Pick<SmallAuth, "createCalendarEvent" | "readCalendar">,
    private calendar: Pick<CalendarService, "events">,
    private availability: Pick<AvailabilityService, "find">,
    private memory?: { read(account: string): Promise<{ revision: number }> },
  ) {}
  private events(d: MeetingDraft) {
    return this.calendar.events({
      accountId: d.organizer.id,
      date: calendarDateAt(d.startsAt),
      view: "day",
      myCalendar: true,
      calendarIds: [],
    });
  }
  private async checkMemory(d: MeetingDraft) {
    if (
      d.memoryPolicy &&
      this.memory &&
      (await this.memory.read(d.organizer.id)).revision !==
        d.memoryPolicy.revision
    )
      throw new CalendarError(
        "invalid",
        "Память изменилась. Подготовьте и подтвердите новый черновик.",
      );
  }
  async preflight(d: MeetingDraft) {
    await this.checkMemory(d);
    for (const occurrence of meetingOccurrences(d))
      await this.checkOccurrence(occurrence);
  }
  private async checkOccurrence(d: MeetingDraft) {
    const available = await this.availability.find({
      accountId: d.organizer.id,
      participantIds: d.participantIds,
      date: calendarDateAt(d.startsAt),
      durationMinutes: d.durationMinutes,
      includeWeekends: true,
      exactInterval: { start: d.startsAt, end: d.endsAt },
      ...(d.memoryPolicy
        ? {
            bufferMinutes: d.memoryPolicy.bufferMinutes,
            organizerParticipantId: d.memoryPolicy.organizerParticipantId,
            timeFrom: d.memoryPolicy.timeFrom,
            timeTo: d.memoryPolicy.timeTo,
          }
        : {}),
    });
    if (
      !available.slots.some(
        (s) =>
          Date.parse(s.start) === Date.parse(d.startsAt) &&
          Date.parse(s.end) === Date.parse(d.endsAt),
      )
    )
      throw new CalendarError(
        "invalid",
        "Время больше не свободно. Подготовьте новый черновик.",
      );
    if (d.options?.calendarIds.length) {
      const rooms = await this.calendar.events({
        accountId: d.organizer.id,
        date: calendarDateAt(d.startsAt),
        view: "day",
        myCalendar: false,
        calendarIds: d.options.calendarIds.map(String),
      });
      if (
        rooms.issues.length ||
        rooms.events.some(
          (e) =>
            Date.parse(e.startsAt) < Date.parse(d.endsAt) &&
            Date.parse(e.endsAt) > Date.parse(d.startsAt),
        )
      )
        throw new CalendarError(
          "invalid",
          "Переговорная занята или её доступность не подтверждена.",
        );
    }
    const events = await this.events(d);
    if (events.issues.length)
      throw new CalendarError(
        "invalid",
        "Неполный календарь: нельзя проверить дубликаты.",
      );
    if (
      events.events.some(
        (e) =>
          e.title === d.title &&
          Date.parse(e.startsAt) === Date.parse(d.startsAt) &&
          Date.parse(e.endsAt) === Date.parse(d.endsAt),
      )
    )
      throw new CalendarError(
        "invalid",
        "Похожая встреча уже существует. Проверьте календарь.",
      );
  }
  async create(d: MeetingDraft) {
    await this.checkMemory(d);
    const response = await this.auth.createCalendarEvent(
      d.organizer.id,
      meetingPayload(d),
    );
    if ([400, 401, 403, 404, 409, 422].includes(response.status))
      throw new MeetingCreateRejected(response.status);
    const body = await calendarJson(response);
    return z.object({ data: z.object({ id }) }).parse(body).data.id;
  }
  async wasDeleted(d: MeetingDraft, eventId: string): Promise<boolean> {
    return this.auth.readCalendar(d.organizer.id, async (get) => {
      const response = await get(
        `/gate/team/api/calendar/events/${id.parse(eventId)}`,
      );
      // A bare 404 may be a stale replica or lost access; require Small's explicit cancellation.
      if (response.status === 404) return false;
      const parsed = z
        .object({
          data: z.object({ id, status: z.literal("cancelled") }),
        })
        .safeParse(await calendarJson(response));
      return parsed.success && parsed.data.data.id === eventId;
    });
  }
  async verify(d: MeetingDraft, eventId?: string) {
    if (!eventId) {
      // A list match cannot prove which write created an event. Read, but never retry or claim success.
      await this.events(d);
      return false;
    }
    const expected = meetingPayload(d);
    const result = await this.auth.readCalendar(d.organizer.id, async (get) =>
      detail.parse(
        await calendarJson(
          await get(`/gate/team/api/calendar/events/${id.parse(eventId)}`),
        ),
      ),
    );
    const e = result.data;
    return (
      e.id === eventId &&
      e.title === expected.title &&
      e.description === expected.description &&
      e.location === expected.location &&
      Date.parse(e.starts_at) === Date.parse(d.startsAt) &&
      Date.parse(e.ends_at) === Date.parse(d.endsAt) &&
      !e.is_public &&
      e.is_recurring === expected.is_recurring &&
      (!expected.is_recurring ||
        JSON.stringify(e.recurrence_rule) ===
          JSON.stringify(expected.recurrence_rule)) &&
      (!d.options ||
        (d.options.calendarIds.every((id) =>
          (e.calendar_ids ?? []).includes(String(id)),
        ) &&
          JSON.stringify(
            (e.notification_recipients ?? []).map((p) => p.id).sort(),
          ) ===
            JSON.stringify([...d.options.notificationRecipientIds].sort()) &&
          JSON.stringify((e.attachments ?? []).map((p) => p.id).sort()) ===
            JSON.stringify([...d.options.attachmentIds].sort()))) &&
      JSON.stringify(e.participants.map((p) => p.id).sort()) ===
        JSON.stringify([...d.participantIds].sort())
    );
  }
}
