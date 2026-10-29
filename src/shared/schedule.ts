import { z } from "zod";
import { validCalendarDate } from "./calendar-time.js";
import type { CalendarEvent, CalendarIssue } from "./calendar.js";
const date = z.string().refine(validCalendarDate);
export const scheduleToolInput = z.discriminatedUnion("period", [
  z.strictObject({
    period: z.enum(["today", "tomorrow", "this-week", "next-week"]),
  }),
  z
    .strictObject({ period: z.literal("custom"), from: date, to: date })
    .refine(
      (q) =>
        q.to >= q.from && Date.parse(q.to) - Date.parse(q.from) < 31 * 86400000,
    ),
]);
export interface ScheduleResult {
  kind: "schedule";
  from: string;
  to: string;
  timezone: "Asia/Almaty";
  complete: boolean;
  events: Pick<
    CalendarEvent,
    "key" | "title" | "startsAt" | "endsAt" | "location" | "organizer"
  >[];
  issues: CalendarIssue[];
}
