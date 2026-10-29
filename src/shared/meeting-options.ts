import { z } from "zod";
import { validCalendarDate } from "./calendar-time.js";
export const recurrenceRule = z.strictObject({
  FREQ: z.literal("WEEKLY"),
  BYDAY: z
    .array(z.enum(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]))
    .min(1)
    .max(7)
    .refine((a) => new Set(a).size === a.length),
  UNTIL: z.string().refine(validCalendarDate),
});
const ids = z
  .array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/))
  .max(20)
  .refine((a) => new Set(a).size === a.length);
export const meetingOptions = z.strictObject({
  calendarIds: z.array(z.number().int().positive()).max(1),
  notificationRecipientIds: ids,
  attachmentIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).max(5),
  recurrence: recurrenceRule.nullable(),
});
export type MeetingOptions = z.infer<typeof meetingOptions>;
