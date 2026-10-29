import { z } from "zod";
import { slotsToolInput } from "./calendar-tools.js";

const conferenceUrl = z
  .url()
  .max(2000)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  });
export const meetingDraftInput = z.strictObject({
  title: z.string().trim().min(1).max(200),
  agenda: z.string().trim().max(5000),
  participantIds: slotsToolInput.shape.participantIds,
  startsAt: z.iso.datetime({ offset: true }),
  durationMinutes: slotsToolInput.shape.durationMinutes.default(30),
  location: z.string().trim().max(500),
  conference: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("automatic") }),
    z.strictObject({ mode: z.literal("custom"), url: conferenceUrl }),
    z.strictObject({ mode: z.literal("none") }),
  ]),
});
export const meetingDraftSchema = z.strictObject({
  kind: z.literal("meeting-draft"),
  status: z.literal("preview"),
  id: z.uuid(),
  revision: z.number().int().positive().default(1),
  title: z.string(),
  agenda: z.string(),
  participantIds: z.array(z.string()),
  organizer: z.object({ id: z.string(), name: z.string() }),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  durationMinutes: z.number(),
  timezone: z.literal("Asia/Almaty"),
  location: z.string(),
  conferenceUrl: conferenceUrl.nullable(),
  recurrence: z.literal("none"),
  visibility: z.literal("private"),
  availabilityCheckedAt: z.iso.datetime(),
});
export type MeetingDraft = z.infer<typeof meetingDraftSchema>;
