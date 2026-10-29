import type { MeetingDraft } from "./meeting-draft.js";
import { z } from "zod";
import { validCalendarDate } from "./calendar-time.js";
import type { CalendarReply, PeoplePage, SlotsResult } from "./calendar.js";

export const peopleToolInput = z.strictObject({
  query: z.string().trim().min(1).max(100),
  page: z.number().int().min(1).max(10000),
});
export const slotsToolInput = z.strictObject({
  participantIds: z
    .array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/))
    .min(1)
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length),
  date: z.string().refine(validCalendarDate),
  durationMinutes: z.number().int().min(1).max(480),
});
export type CalendarToolResult = CalendarReply<
  PeoplePage | SlotsResult | MeetingDraft
>;
export type CalendarToolExecutor = (
  name: string,
  input: unknown,
) => Promise<CalendarToolResult>;
export interface CalendarToolCall {
  type: "calendar-tool";
  requestId: string;
  callId: string;
  name: string;
  input: unknown;
}
export interface CalendarToolReply {
  type: "calendar-result";
  callId: string;
  result: CalendarToolResult;
}
