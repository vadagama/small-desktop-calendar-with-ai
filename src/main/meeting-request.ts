import { recurrenceRule } from "../shared/meeting-options.js";
import { z } from "zod";
import { participantIds } from "./availability-request.js";
import type { MeetingDraft } from "../shared/meeting-draft.js";
export const meetingCreatePath = "/gate/team/api/calendar/events?force=false";
export const meetingCreateBody = z
  .strictObject({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(7500),
    location: z.string().max(500),
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }),
    timezone: z.literal("Asia/Almaty"),
    is_recurring: z.boolean(),
    recurrence_type: z.literal("custom").optional(),
    recurrence_rule: recurrenceRule.optional(),
    calendar_ids: z.array(z.number().int().positive()).max(1).optional(),
    is_public: z.literal(false),
    participant_ids: participantIds,
    notification_recipient_ids: z
      .array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/))
      .max(20),
    attachments: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).max(5),
  })
  .refine((q) => Date.parse(q.starts_at) < Date.parse(q.ends_at))
  .refine((q) =>
    q.is_recurring
      ? q.recurrence_type === "custom" && !!q.recurrence_rule
      : !q.recurrence_rule && !q.recurrence_type,
  );
export function meetingPayload(draft: MeetingDraft) {
  return meetingCreateBody.parse({
    title: draft.title,
    description: [draft.agenda, draft.conferenceUrl]
      .filter(Boolean)
      .join("\n\n"),
    location: draft.location,
    starts_at: draft.startsAt,
    ends_at: draft.endsAt,
    timezone: draft.timezone,
    is_recurring: !!draft.options?.recurrence,
    ...(draft.options?.recurrence
      ? { recurrence_type: "custom", recurrence_rule: draft.options.recurrence }
      : {}),
    ...(draft.options?.calendarIds.length
      ? { calendar_ids: draft.options.calendarIds }
      : {}),
    is_public: false,
    participant_ids: draft.participantIds,
    notification_recipient_ids: draft.options?.notificationRecipientIds ?? [],
    attachments: draft.options?.attachmentIds ?? [],
  });
}
export function isMeetingCreateRequest(path: string, body: unknown) {
  return (
    path === meetingCreatePath && meetingCreateBody.safeParse(body).success
  );
}
