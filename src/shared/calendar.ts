import type {
  EventMutationReference,
  EventMutationResult,
} from "./event-mutation.js";
import type { EventChangeQuery, EventChangePreview } from "./event-change.js";
export type CalendarView = "day" | "week" | "month";
export type EventLookup =
  { id: string } | { originalEventId: string; date: string };
export interface CalendarEvent {
  key: string;
  lookup: EventLookup;
  title: string;
  startsAt: string;
  endsAt: string;
  calendarIds: string[];
  participation?: "organizer" | "invited" | "informed" | "unknown";
  accepted?: boolean;
  organizer: string;
  description: string;
  location: string;
}
export interface SmallCalendar {
  id: string;
  name: string;
}
export type CalendarIssueKind =
  "auth" | "denied" | "network" | "invalid" | "not-found";
export interface CalendarIssue {
  source: string;
  kind: CalendarIssueKind;
  message: string;
}
export interface CalendarQuery {
  accountId: string;
  date: string;
  view: CalendarView;
  myCalendar: boolean;
  calendarIds: string[];
}
export interface CalendarResult {
  events: CalendarEvent[];
  issues: CalendarIssue[];
}
export type CalendarReply<T> =
  { ok: true; data: T } | { ok: false; kind: CalendarIssueKind; error: string };
export const calendarChannels = {
  people: "calendar:people",
  slots: "calendar:slots",
  calendars: "calendar:list",
  events: "calendar:events",
  detail: "calendar:detail",
  previewChange: "calendar:preview-change",
  confirmChange: "calendar:confirm-change",
  reconcileChange: "calendar:reconcile-change",
} as const;
export interface CalendarPerson {
  participantId: string;
  name: string;
  position: string;
}
export interface PeoplePage {
  people: CalendarPerson[];
  page: number;
  nextPage: number | null;
}
export interface SlotsQuery {
  includeWeekends?: boolean;
  accountId: string;
  participantIds: string[];
  date: string;
  durationMinutes: number;
}
export interface SlotsResult {
  slots: { start: string; end: string }[];
  participantIds: string[];
  date: string;
  durationMinutes: number;
  timezone: "Asia/Almaty";
}
export interface CalendarBridge {
  confirmChange(
    input: EventMutationReference,
  ): Promise<CalendarReply<EventMutationResult>>;
  reconcileChange(
    input: EventMutationReference,
  ): Promise<CalendarReply<EventMutationResult>>;
  previewChange(
    input: EventChangeQuery,
  ): Promise<CalendarReply<EventChangePreview>>;
  people(input: {
    accountId: string;
    query: string;
    page: number;
  }): Promise<CalendarReply<PeoplePage>>;
  slots(input: SlotsQuery): Promise<CalendarReply<SlotsResult>>;
  calendars(input: {
    accountId: string;
  }): Promise<CalendarReply<SmallCalendar[]>>;
  events(input: CalendarQuery): Promise<CalendarReply<CalendarResult>>;
  detail(input: {
    accountId: string;
    lookup: EventLookup;
  }): Promise<CalendarReply<CalendarEvent>>;
}
