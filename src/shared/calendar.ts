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
  calendars: "calendar:list",
  events: "calendar:events",
  detail: "calendar:detail",
} as const;
export interface CalendarBridge {
  calendars(input: {
    accountId: string;
  }): Promise<CalendarReply<SmallCalendar[]>>;
  events(input: CalendarQuery): Promise<CalendarReply<CalendarResult>>;
  detail(input: {
    accountId: string;
    lookup: EventLookup;
  }): Promise<CalendarReply<CalendarEvent>>;
}
