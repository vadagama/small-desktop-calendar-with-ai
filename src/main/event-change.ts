import { z } from "zod";
import {
  CalendarError,
  calendarJson,
  type CalendarSession,
} from "./calendar.js";
import type { EventChangePreview } from "../shared/event-change.js";
const id = z
  .union([
    z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    z.number().int().nonnegative(),
  ])
  .transform(String);
const query = z.strictObject({
  accountId: z.string().min(1).max(200),
  eventId: id,
  change: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("rename"),
      title: z.string().trim().min(1).max(200),
    }),
    z.strictObject({ kind: z.literal("cancel") }),
  ]),
});
const detail = z.object({
  data: z
    .object({
      id,
      creator_id: id,
      is_recurring: z.boolean(),
      original_event_id: id.nullish(),
      recurrence_rule: z.unknown().optional(),
      title: z.string().min(1).max(20000),
      description: z.string().max(20000).nullable(),
      location: z.string().max(20000).nullable(),
      starts_at: z.iso.datetime({ offset: true }),
      ends_at: z.iso.datetime({ offset: true }),
      participants: z.array(z.object({ id })).max(100),
    })
    .refine((e) => Date.parse(e.starts_at) < Date.parse(e.ends_at)),
});
/** Read-only preparation. A preview is never authorization for a later write. */
export class EventChangeService {
  constructor(private session: CalendarSession) {}
  async preview(input: unknown): Promise<EventChangePreview> {
    const parsed = query.safeParse(input);
    if (!parsed.success)
      throw new CalendarError(
        "invalid",
        "Некорректные параметры изменения встречи.",
      );
    const q = parsed.data;
    return this.session.readCalendar(
      q.accountId,
      async (get, participantId) => {
        const result = detail.safeParse(
          await calendarJson(
            await get(`/gate/team/api/calendar/events/${q.eventId}`),
          ),
        );
        if (!result.success)
          throw new CalendarError(
            "invalid",
            "Small не вернул полные данные для проверки организатора и типа встречи.",
          );
        const e = result.data.data;
        if (e.id !== q.eventId)
          throw new CalendarError(
            "invalid",
            "Карточка не совпадает с выбранной встречей.",
          );
        if (e.is_recurring || e.original_event_id || e.recurrence_rule != null)
          throw new CalendarError(
            "denied",
            "Изменение серий и их вхождений пока недоступно.",
          );
        if (e.creator_id !== (participantId ?? q.accountId))
          throw new CalendarError(
            "denied",
            "Подготовить изменение может только организатор встречи.",
          );
        if (q.change.kind === "rename" && q.change.title === e.title)
          throw new CalendarError(
            "invalid",
            "Новое название совпадает с текущим.",
          );
        return {
          eventId: e.id,
          kind: q.change.kind,
          before: {
            title: e.title,
            description: e.description ?? "",
            location: e.location ?? "",
            startsAt: e.starts_at,
            endsAt: e.ends_at,
            participantIds: e.participants.map((p) => p.id),
          },
          afterTitle: q.change.kind === "rename" ? q.change.title : null,
          checkedAt: new Date().toISOString(),
        };
      },
    );
  }
}
