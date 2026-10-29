import { calendarDateAt, calendarToday } from "../shared/calendar-time.js";
import { z } from "zod";
import {
  CalendarError,
  calendarJson,
  type CalendarSession,
} from "./calendar.js";
export const eventUpdateBody = z
  .strictObject({
    title: z.string().min(1).max(200),
    description: z.string().max(20000),
    location: z.string().max(20000),
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }),
    timezone: z.string().min(1).max(100),
    is_recurring: z.boolean(),
    recurrence_rule: z.record(z.string(), z.unknown()).optional(),
    recurrence_type: z.literal("custom").optional(),
    recurring_edit_type: z.literal("single").optional(),
    is_public: z.boolean(),
    calendar_ids: z.array(z.number().int().positive()).max(100),
    participant_ids: z
      .array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/))
      .max(100),
    notification_recipient_ids: z
      .array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/))
      .max(100),
    attachments: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).max(100),
  })
  .refine((e) => Date.parse(e.starts_at) < Date.parse(e.ends_at))
  .refine((e) =>
    e.is_recurring
      ? !!e.recurrence_rule &&
        e.recurrence_type === "custom" &&
        e.recurring_edit_type === "single"
      : !e.recurrence_rule && !e.recurrence_type && !e.recurring_edit_type,
  );
export type EventUpdateBody = z.infer<typeof eventUpdateBody>;
export function isEventUpdateRequest(path: string, body: unknown) {
  return (
    /^\/gate\/team\/api\/calendar\/events\/[A-Za-z0-9_-]{1,128}\?force=false$/.test(
      path,
    ) && eventUpdateBody.safeParse(body).success
  );
}
const id = z
  .union([
    z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    z.number().int().nonnegative(),
  ])
  .transform(String);
const stamp = z.iso.datetime({ offset: true });
const query = z
  .strictObject({
    accountId: z.string().min(1),
    eventId: id,
    beforeStart: stamp,
    beforeEnd: stamp,
    startsAt: stamp,
    endsAt: stamp,
  })
  .refine((e) => Date.parse(e.startsAt) < Date.parse(e.endsAt));
const detail = z.object({
  data: z.object({
    id,
    creator_id: id,
    title: z.string(),
    description: z.string().nullable(),
    location: z.string().nullable(),
    starts_at: stamp,
    ends_at: stamp,
    timezone: z.string(),
    is_recurring: z.boolean(),
    original_event_id: id.nullish(),
    recurrence_rule: z.unknown().optional(),
    is_public: z.boolean(),
    calendar_ids: z.array(z.coerce.number().int().positive()),
    participants: z.array(z.object({ id })),
    notification_recipients: z.array(z.object({ id })),
    attachments: z.array(z.object({ id })),
  }),
});
export function isParticipantStatusRequest(path: string, body: unknown) {
  return (
    /^\/gate\/team\/api\/calendar\/events\/[A-Za-z0-9_-]{1,128}\/participant-status$/.test(
      path,
    ) &&
    z.strictObject({ status: z.enum(["accepted", "declined"]) }).safeParse(body)
      .success
  );
}
export class EventRescheduleService {
  private pending = new Set<string>();
  constructor(
    private session: CalendarSession & {
      deleteCalendarEvent?(
        accountId: string,
        eventId: string,
      ): Promise<Response>;
      respondCalendarEvent?(
        accountId: string,
        eventId: string,
        status: "accepted" | "declined",
      ): Promise<Response>;
      updateCalendarEvent(
        accountId: string,
        eventId: string,
        body: EventUpdateBody,
      ): Promise<Response>;
    },
  ) {}
  async applyChange(input: unknown): Promise<void> {
    const v = z
      .strictObject({
        accountId: z.string().min(1),
        eventId: id,
        change: z.discriminatedUnion("kind", [
          z.strictObject({
            kind: z.literal("rename"),
            title: z.string().trim().min(1).max(200),
          }),
          z.strictObject({ kind: z.literal("cancel") }),
        ]),
      })
      .parse(input);
    const key = `${v.accountId}:${v.eventId}`;
    if (this.pending.has(key))
      throw new CalendarError("invalid", "Изменение уже сохраняется.");
    this.pending.add(key);
    try {
      const e = await this.session.readCalendar(
        v.accountId,
        async (get, participantId) => {
          const parsed = detail.safeParse(
            await calendarJson(
              await get(`/gate/team/api/calendar/events/${v.eventId}`),
            ),
          );
          if (!parsed.success)
            throw new CalendarError(
              "invalid",
              "Не удалось получить полную карточку встречи.",
            );
          const event = parsed.data.data;
          if (calendarDateAt(event.starts_at) < calendarToday())
            throw new CalendarError(
              "denied",
              "События за прошедшие дни нельзя изменять.",
            );
          if (
            event.id !== v.eventId ||
            event.creator_id !== (participantId ?? v.accountId)
          )
            throw new CalendarError(
              "denied",
              "Изменить встречу может только организатор.",
            );
          if (
            event.is_recurring ||
            event.original_event_id ||
            event.recurrence_rule != null
          )
            throw new CalendarError(
              "denied",
              "Изменение серий и их вхождений пока недоступно.",
            );
          return event;
        },
      );
      if (v.change.kind === "cancel") {
        if (!this.session.deleteCalendarEvent)
          throw new CalendarError("invalid", "Удаление недоступно.");
        const response = await this.session.deleteCalendarEvent(
          v.accountId,
          v.eventId,
        );
        if (!response.ok) await calendarJson(response);
        return;
      }
      const title = v.change.title;
      const body = eventUpdateBody.parse({
        title,
        description: e.description ?? "",
        location: e.location ?? "",
        starts_at: e.starts_at,
        ends_at: e.ends_at,
        timezone: e.timezone,
        is_recurring: false,
        is_public: e.is_public,
        calendar_ids: e.calendar_ids,
        participant_ids: e.participants.map((p) => p.id),
        notification_recipient_ids: e.notification_recipients.map((p) => p.id),
        attachments: e.attachments.map((p) => p.id),
      });
      await calendarJson(
        await this.session.updateCalendarEvent(v.accountId, v.eventId, body),
      );
      await this.session.readCalendar(v.accountId, async (get) => {
        const parsed = detail.safeParse(
          await calendarJson(
            await get(`/gate/team/api/calendar/events/${v.eventId}`),
          ),
        );
        if (
          !parsed.success ||
          parsed.data.data.id !== v.eventId ||
          parsed.data.data.title !== title
        )
          throw new CalendarError(
            "network",
            "Не удалось подтвердить сохранение. Обновите календарь перед повтором.",
          );
      });
    } finally {
      this.pending.delete(key);
    }
  }
  async respond(input: unknown): Promise<void> {
    const q = z
      .strictObject({
        accountId: z.string().min(1),
        eventId: id,
        status: z.enum(["accepted", "declined"]),
      })
      .parse(input);
    if (!this.session.respondCalendarEvent)
      throw new CalendarError("invalid", "Ответ на приглашение недоступен.");
    await this.session.readCalendar(q.accountId, async (get, participantId) => {
      const parsed = detail.safeParse(
        await calendarJson(
          await get(`/gate/team/api/calendar/events/${q.eventId}`),
        ),
      );
      if (
        !parsed.success ||
        parsed.data.data.id !== q.eventId ||
        !participantId ||
        !parsed.data.data.participants.some((p) => p.id === participantId)
      )
        throw new CalendarError(
          "denied",
          "Приглашение для этого аккаунта не найдено.",
        );
    });
    await calendarJson(
      await this.session.respondCalendarEvent(q.accountId, q.eventId, q.status),
    );
  }
  async reschedule(input: unknown): Promise<void> {
    const q = query.safeParse(input);
    if (!q.success)
      throw new CalendarError("invalid", "Некорректное время встречи.");
    const v = q.data,
      key = `${v.accountId}:${v.eventId}`;
    if (this.pending.has(key))
      throw new CalendarError("invalid", "Время встречи уже сохраняется.");
    this.pending.add(key);
    try {
      const body = await this.session.readCalendar(
        v.accountId,
        async (get, participantId) => {
          const parsed = detail.safeParse(
            await calendarJson(
              await get(`/gate/team/api/calendar/events/${v.eventId}`),
            ),
          );
          if (!parsed.success)
            throw new CalendarError(
              "invalid",
              "Недостаточно данных для безопасного переноса встречи.",
            );
          const e = parsed.data.data;
          if (
            calendarDateAt(e.starts_at) < calendarToday() ||
            calendarDateAt(v.startsAt) < calendarToday()
          )
            throw new CalendarError(
              "denied",
              "Нельзя изменять события за прошедшие дни или переносить встречу в прошлый день.",
            );
          if (
            e.id !== v.eventId ||
            e.creator_id !== (participantId ?? v.accountId)
          )
            throw new CalendarError(
              "denied",
              "Перенести встречу может только её организатор.",
            );
          if (
            e.original_event_id ||
            (e.is_recurring &&
              (!e.recurrence_rule ||
                typeof e.recurrence_rule !== "object" ||
                Array.isArray(e.recurrence_rule))) ||
            (!e.is_recurring && e.recurrence_rule != null)
          )
            throw new CalendarError(
              "denied",
              "Перенос повторяющихся встреч пока недоступен.",
            );
          if (
            Date.parse(e.starts_at) !== Date.parse(v.beforeStart) ||
            Date.parse(e.ends_at) !== Date.parse(v.beforeEnd)
          )
            throw new CalendarError(
              "invalid",
              "Время встречи уже изменилось. Календарь будет обновлён.",
            );
          return eventUpdateBody.parse({
            title: e.title,
            description: e.description ?? "",
            location: e.location ?? "",
            starts_at: v.startsAt,
            ends_at: v.endsAt,
            timezone: e.timezone,
            is_recurring: e.is_recurring,
            ...(e.is_recurring
              ? {
                  recurrence_rule: e.recurrence_rule,
                  recurrence_type: "custom",
                  recurring_edit_type: "single",
                }
              : {}),
            is_public: e.is_public,
            calendar_ids: e.calendar_ids,
            participant_ids: e.participants.map((p) => p.id),
            notification_recipient_ids: e.notification_recipients.map(
              (p) => p.id,
            ),
            attachments: e.attachments.map((p) => p.id),
          });
        },
      );
      // One write attempt; force=false preserves the server's conflict checks.
      const response = await this.session.updateCalendarEvent(
        v.accountId,
        v.eventId,
        body,
      );
      if (response.status === 409 || response.status === 422)
        throw new CalendarError(
          "invalid",
          "Это время недоступно. Встреча не перенесена.",
        );
      await calendarJson(response);
      await this.session.readCalendar(v.accountId, async (get) => {
        const parsed = detail.safeParse(
          await calendarJson(
            await get(`/gate/team/api/calendar/events/${v.eventId}`),
          ),
        );
        if (
          !parsed.success ||
          parsed.data.data.id !== v.eventId ||
          Date.parse(parsed.data.data.starts_at) !== Date.parse(v.startsAt) ||
          Date.parse(parsed.data.data.ends_at) !== Date.parse(v.endsAt)
        )
          throw new CalendarError(
            "network",
            "Не удалось подтвердить новое время. Проверьте обновлённый календарь перед повтором.",
          );
      });
    } finally {
      this.pending.delete(key);
    }
  }
}
