import { z } from "zod";
export const eventId = z
  .union([
    z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    z.number().int().nonnegative(),
  ])
  .transform(String);
const ids = z
  .array(eventId)
  .max(100)
  .transform((values) => [...values].sort());
export const eventUpdateBody = z.strictObject({
  title: z.string().min(1).max(200),
  description: z.string().max(20000).nullable(),
  location: z.string().max(20000).nullable(),
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
  timezone: z.string().min(1).max(100),
  is_recurring: z.literal(false),
  is_public: z.boolean(),
  calendar_ids: z
    .array(z.number().int().positive())
    .max(100)
    .transform((values) => [...values].sort((a, b) => a - b)),
  participant_ids: ids,
  notification_recipient_ids: ids,
  attachments: ids,
});
const detail = eventUpdateBody
  .omit({
    participant_ids: true,
    notification_recipient_ids: true,
    attachments: true,
  })
  .extend({
    id: eventId,
    creator_id: eventId,
    original_event_id: eventId.nullish(),
    recurrence_rule: z.unknown().optional(),
    participants: z.array(z.object({ id: eventId })).max(100),
    notification_recipients: z.array(z.object({ id: eventId })).max(100),
    attachments: z.array(z.object({ id: eventId })).max(100),
  })
  .strip()
  .refine(
    (e) =>
      !e.original_event_id &&
      e.recurrence_rule == null &&
      Date.parse(e.starts_at) < Date.parse(e.ends_at),
  );
export function eventSnapshot(input: unknown) {
  const e = detail.parse(input);
  return {
    id: e.id,
    owner: e.creator_id,
    body: eventUpdateBody.parse({
      title: e.title,
      description: e.description,
      location: e.location,
      starts_at: new Date(e.starts_at).toISOString(),
      ends_at: new Date(e.ends_at).toISOString(),
      timezone: e.timezone,
      is_recurring: false,
      is_public: e.is_public,
      calendar_ids: e.calendar_ids,
      participant_ids: e.participants.map((p) => p.id),
      notification_recipient_ids: e.notification_recipients.map((p) => p.id),
      attachments: e.attachments.map((p) => p.id),
    }),
  };
}
export function isEventMutation(path: string, method: string, body?: unknown) {
  if (method === "DELETE")
    return (
      /^\/gate\/team\/api\/calendar\/events\/[A-Za-z0-9_-]{1,128}$/.test(
        path,
      ) && body === undefined
    );
  return (
    method === "PUT" &&
    /^\/gate\/team\/api\/calendar\/events\/[A-Za-z0-9_-]{1,128}\?force=false$/.test(
      path,
    ) &&
    eventUpdateBody.safeParse(body).success
  );
}
