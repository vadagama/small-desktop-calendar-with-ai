import type { MeetingDraft } from "./meeting-draft.js";
import { z } from "zod";
import { validCalendarDate } from "./calendar-time.js";
import type {
  CalendarReply,
  PeoplePage,
  SlotsResult,
  CalendarPerson,
} from "./calendar.js";

export const meetingDeletionInput = z.strictObject({
  key: z.string().min(1).max(300),
  date: z.string().refine(validCalendarDate),
  scope: z.enum(["occurrence", "following"]).optional(),
});
export const meetingDeletionSchema = z.strictObject({
  kind: z.literal("meeting-delete"),
  series: z
    .strictObject({
      scope: z.enum(["occurrence", "following"]),
      seriesId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
      originalDate: z.string().refine(validCalendarDate),
      eventId: z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,128}$/)
        .optional(),
    })
    .optional(),
  accountId: z.string().min(1),
  eventId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  title: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
});
export type MeetingDeletion = z.infer<typeof meetingDeletionSchema>;

export const peopleToolInput = z.strictObject({
  query: z.string().trim().min(1).max(100),
  page: z.number().int().min(1).max(10000),
});
export const slotsToolInput = z.strictObject({
  participantIds: z
    .array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/))
    .min(0)
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length),
  includeWeekends: z.boolean().optional(),
  timeFrom: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  timeTo: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  date: z.string().refine(validCalendarDate),
  durationMinutes: z.number().int().min(1).max(480),
});
export type CalendarToolResult = CalendarReply<
  | {
      kind: "task-options";
      message: string;
      options: import("./assistant-memory.js").TaskOption[];
    }
  | {
      kind: "memory-review";
      ready: boolean;
      questions: string[];
      message: string;
    }
  | import("./assistant-memory.js").MemoryProposal
  | {
      kind: "assistant-memory";
      state: import("./assistant-memory.js").AssistantMemoryState;
    }
  | { kind: "memory-selection"; message: string; people?: CalendarPerson[] }
  | import("./schedule.js").ScheduleResult
  | import("./analytics.js").AnalyticsResult
  | PeoplePage
  | SlotsResult
  | MeetingDraft
  | MeetingDeletion
  | { kind: "participants"; people: CalendarPerson[] }
  | {
      kind: "memory";
      people: {
        participantId: string;
        name: string;
        position: string;
        aliases: string[];
        uses: number;
      }[];
    }
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

export const selectParticipantsInput = z.strictObject({
  participantIds: slotsToolInput.shape.participantIds,
  sourceEventKey: z.string().min(1).max(300).optional(),
  rememberedAliases: z
    .array(
      z.strictObject({
        participantId: z.string().min(1).max(128),
        alias: z.string().trim().min(1).max(100),
      }),
    )
    .max(20)
    .optional(),
});
export const participantMemoryInput = z.strictObject({
  action: z.enum(["recall", "remember", "forget", "clear"]),
  participantId: z.string().min(1).max(128).optional(),
  alias: z.string().trim().min(1).max(100).optional(),
});
