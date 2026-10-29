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
    description: z.string(),
    location: z.string(),
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }),
    is_public: z.boolean(),
    is_recurring: z.boolean(),
    participants: z.array(z.object({ id })).max(100),
  }),
});
export class SmallMeetingWriter implements MeetingWriter {
  constructor(
    private auth: Pick<SmallAuth, "createCalendarEvent" | "readCalendar">,
    private calendar: Pick<CalendarService, "events">,
    private availability: Pick<AvailabilityService, "find">,
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
  async preflight(d: MeetingDraft) {
    const available = await this.availability.find({
      accountId: d.organizer.id,
      participantIds: d.participantIds,
      date: calendarDateAt(d.startsAt),
      durationMinutes: d.durationMinutes,
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
    const body = await calendarJson(
      await this.auth.createCalendarEvent(d.organizer.id, meetingPayload(d)),
    );
    return z.object({ data: z.object({ id }) }).parse(body).data.id;
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
      !e.is_recurring &&
      JSON.stringify(e.participants.map((p) => p.id).sort()) ===
        JSON.stringify([...d.participantIds].sort())
    );
  }
}
