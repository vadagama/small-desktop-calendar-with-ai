import { z } from "zod";
import { validCalendarDate } from "./calendar-time.js";
import type {
  CalendarEvent,
  CalendarIssue,
  CalendarPerson,
} from "./calendar.js";

export const eventListInput = z
  .strictObject({
    from: z.string().refine(validCalendarDate),
    to: z.string().refine(validCalendarDate),
    scope: z.enum(["my", "all-accessible"]),
    organizerId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,128}$/)
      .optional(),
  })
  .refine(
    (q) =>
      q.from <= q.to && Date.parse(q.to) - Date.parse(q.from) < 366 * 86400000,
  );
export type EventListQuery = z.infer<typeof eventListInput>;
export interface EventListResult {
  kind: "event-list";
  accountId: string;
  query: EventListQuery;
  organizer?: CalendarPerson;
  events: CalendarEvent[];
  complete: boolean;
  issues: CalendarIssue[];
  fetchedAt: number;
}
