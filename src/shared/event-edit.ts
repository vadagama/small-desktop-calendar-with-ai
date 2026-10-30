import { z } from "zod";
import type { CalendarEvent } from "./calendar.js";
const ids = z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).max(100);
export const eventEditFields = z.strictObject({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20000),
  location: z.string().max(20000),
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
  calendar_ids: z.array(z.number().int().positive()).max(100),
  participant_ids: ids,
  notification_recipient_ids: ids,
  attachments: ids,
});
export const eventEditQuery = z.strictObject({
  accountId: z.string().min(1),
  eventId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  before: eventEditFields,
  after: eventEditFields.extend({ participant_ids: ids.min(1) }),
});
export type EventEditQuery = z.infer<typeof eventEditQuery>;
export function editableEvent(event: CalendarEvent): EventEditQuery["before"] {
  return {
    title: event.title,
    description: event.description,
    location: event.location,
    starts_at: event.startsAt,
    ends_at: event.endsAt,
    calendar_ids: event.calendarIds.map(Number),
    participant_ids: (event.participants ?? []).map((p) => p.id),
    notification_recipient_ids: (event.notificationRecipients ?? []).map(
      (p) => p.id,
    ),
    attachments: (event.attachments ?? []).map((p) => p.id),
  };
}
