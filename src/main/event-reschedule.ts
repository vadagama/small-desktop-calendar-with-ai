import { eventEditQuery, eventEditFields } from "../shared/event-edit.js";
import {
  EventMutationJournal,
  mutationHash,
  type EventMutationRecord,
} from "./event-mutation-journal.js";
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
/** What Small returns for an event after it was deleted: still readable, but cancelled. */
const cancelledEvent = z.object({
  data: z.object({ id, status: z.literal("cancelled") }),
});
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
function updateBody(e: z.infer<typeof detail>["data"]): EventUpdateBody {
  return eventUpdateBody.parse({
    title: e.title,
    description: e.description ?? "",
    location: e.location ?? "",
    starts_at: e.starts_at,
    ends_at: e.ends_at,
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
    notification_recipient_ids: e.notification_recipients.map((p) => p.id),
    attachments: e.attachments.map((p) => p.id),
  });
}
function fingerprint(body: EventUpdateBody) {
  return mutationHash({
    ...body,
    starts_at: Date.parse(body.starts_at),
    ends_at: Date.parse(body.ends_at),
    calendar_ids: [...body.calendar_ids].sort((a, b) => a - b),
    participant_ids: [...body.participant_ids].sort(),
    notification_recipient_ids: [...body.notification_recipient_ids].sort(),
    attachments: [...body.attachments].sort(),
  });
}
const unknownOutcome = () =>
  new CalendarError(
    "network",
    "Результат изменения неизвестен: не удалось подтвердить сохранение. Повторная запись заблокирована. Повторное действие только проверит состояние встречи.",
    true,
  );
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
    private journal: EventMutationJournal,
    private ownsAttachments: (ids: string[]) => boolean = (ids) => !ids.length,
  ) {}
  private async verified(
    accountId: string,
    eventId: string,
    entry: EventMutationRecord,
  ) {
    try {
      return await this.session.readCalendar(
        accountId,
        async (get, participantId) => {
          const response = await get(
            `/gate/team/api/calendar/events/${eventId}`,
          );
          if (entry.kind === "delete") {
            // Without an acknowledged DELETE nothing proves this delete was ours.
            if (!entry.acknowledged) return false;
            if (response.status === 404) return true;
            // Small deletes softly: the event stays readable with status "cancelled".
            const parsed = cancelledEvent.safeParse(
              await calendarJson(response).catch(() => null),
            );
            return parsed.success && parsed.data.data.id === eventId;
          }
          const parsed = detail.safeParse(await calendarJson(response));
          if (
            !parsed.success ||
            parsed.data.data.id !== eventId ||
            parsed.data.data.creator_id !== (participantId ?? accountId)
          )
            return false;
          return fingerprint(updateBody(parsed.data.data)) === entry.resultHash;
        },
      );
    } catch {
      return false;
    }
  }
  private async reconcile(
    accountId: string,
    eventId: string,
    request: unknown,
  ) {
    const entry = await this.journal.read(accountId, eventId);
    if (!entry) return false;
    if (!(await this.verified(accountId, eventId, entry)))
      throw unknownOutcome();
    await this.journal.clear(accountId, eventId);
    if (entry.requestHash !== mutationHash(request))
      throw new CalendarError(
        "invalid",
        "Предыдущее изменение подтверждено. Обновите календарь и повторите новое действие.",
      );
    return true;
  }
  private async writeMutation(
    accountId: string,
    eventId: string,
    request: unknown,
    body: EventUpdateBody | null,
    write: () => Promise<Response>,
  ) {
    const entry: EventMutationRecord = {
      requestHash: mutationHash(request),
      resultHash: mutationHash(null),
      kind: body ? "update" : "delete",
      acknowledged: false,
    };
    if (body) entry.resultHash = fingerprint(body);
    // Claim and fsync precede the network request. A crash leaves retries blocked.
    await this.journal.claim(accountId, eventId, entry);
    let response: Response;
    try {
      response = await write();
    } catch {
      if (await this.verified(accountId, eventId, entry)) {
        await this.journal.clear(accountId, eventId);
        return;
      }
      throw unknownOutcome();
    }
    if (!response.ok) {
      if ([400, 401, 403, 404, 409, 422].includes(response.status)) {
        await this.journal.clear(accountId, eventId);
        await calendarJson(response);
      }
      if (await this.verified(accountId, eventId, entry)) {
        await this.journal.clear(accountId, eventId);
        return;
      }
      throw unknownOutcome();
    }
    await this.journal.acknowledge(accountId, eventId);
    entry.acknowledged = true;
    if (!(await this.verified(accountId, eventId, entry)))
      throw unknownOutcome();
    await this.journal.clear(accountId, eventId);
  }
  async update(input: unknown): Promise<void> {
    const q = eventEditQuery.parse(input);
    await this.applyChange({
      accountId: q.accountId,
      eventId: q.eventId,
      change: { kind: "edit", before: q.before, after: q.after },
    });
  }
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
          z.strictObject({
            kind: z.literal("edit"),
            before: eventEditFields,
            after: eventEditQuery.shape.after,
          }),
        ]),
      })
      .parse(input);
    const key = `${v.accountId}:${v.eventId}`;
    if (this.pending.has(key))
      throw new CalendarError("invalid", "Изменение уже сохраняется.");
    this.pending.add(key);
    try {
      if (await this.reconcile(v.accountId, v.eventId, v)) return;
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
        await this.writeMutation(v.accountId, v.eventId, v, null, () =>
          this.session.deleteCalendarEvent!(v.accountId, v.eventId),
        );
        return;
      }
      const current = updateBody(e);
      let body: EventUpdateBody;
      if (v.change.kind === "edit") {
        const { before, after } = v.change;
        const normalize = (value: unknown, key: string) =>
          Array.isArray(value)
            ? [...value].sort()
            : key.endsWith("_at")
              ? Date.parse(String(value))
              : value;
        const equal = (a: unknown, b: unknown, key: string) =>
          JSON.stringify(normalize(a, key)) ===
          JSON.stringify(normalize(b, key));
        const patch: Record<string, unknown> = {};
        for (const key of Object.keys(after) as (keyof typeof after)[]) {
          if (equal(before[key], after[key], key)) continue;
          if (!equal(before[key], current[key], key))
            throw new CalendarError(
              "invalid",
              "Событие изменено другим пользователем. Закройте форму и откройте редактирование заново.",
            );
          patch[key] = after[key];
        }
        if (!Object.keys(patch).length) return;
        body = eventUpdateBody.parse({ ...current, ...patch });
        if (
          !this.ownsAttachments(
            body.attachments.filter((id) => !current.attachments.includes(id)),
          )
        )
          throw new CalendarError("denied", "Прикрепите новые файлы заново.");
        if (calendarDateAt(body.starts_at) < calendarToday())
          throw new CalendarError(
            "denied",
            "Нельзя переносить события в прошедшие дни.",
          );
      } else {
        if (v.change.title === e.title) return;
        body = eventUpdateBody.parse({ ...current, title: v.change.title });
      }
      await this.writeMutation(v.accountId, v.eventId, v, body, () =>
        this.session.updateCalendarEvent(v.accountId, v.eventId, body),
      );
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
      if (await this.reconcile(v.accountId, v.eventId, v)) return;
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
      await this.writeMutation(v.accountId, v.eventId, v, body, () =>
        this.session.updateCalendarEvent(v.accountId, v.eventId, body),
      );
    } finally {
      this.pending.delete(key);
    }
  }
}
