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
    is_recurring: z.literal(false),
    is_public: z.literal(false),
    participant_ids: participantIds,
    notification_recipient_ids: z.array(z.never()).length(0),
    attachments: z.array(z.never()).length(0),
  })
  .refine((q) => Date.parse(q.starts_at) < Date.parse(q.ends_at));
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
    is_recurring: false,
    is_public: false,
    participant_ids: draft.participantIds,
    notification_recipient_ids: [],
    attachments: [],
  });
}
export function isMeetingCreateRequest(path: string, body: unknown) {
  return (
    path === meetingCreatePath && meetingCreateBody.safeParse(body).success
  );
}
