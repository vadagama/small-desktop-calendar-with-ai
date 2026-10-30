import type { EventEditQuery } from "./event-edit.js";
import type { CalendarDiff } from "./calendar-diff.js";
import type { EventChangeQuery, EventChangePreview } from "./event-change.js";
export type CalendarView = "day" | "week" | "month";
export type EventLookup =
  { id: string } | { originalEventId: string; date: string };
export interface CalendarRecurrenceRule {
  FREQ: string;
  INTERVAL?: number | undefined;
  BYDAY?: string[] | undefined;
  UNTIL?: string | undefined;
}
export interface CalendarAttachment {
  id: string;
  name: string;
  size?: number;
  url?: string;
}
export interface CalendarEvent {
  attachments?: CalendarAttachment[];
  notificationRecipients?: { id: string; name: string }[];
  recurrenceRule?: CalendarRecurrenceRule;
  participants?: {
    id: string;
    name: string;
    status: string;
    organizer: boolean;
  }[];
  recurring?: boolean;
  /** Series the occurrence belongs to, when the calendar reports it. */
  originalEventId?: string;
  /** Other identities of the same occurrence (see occurrence-key.ts); the key itself never changes. */
  aliases?: string[];
  key: string;
  lookup: EventLookup;
  title: string;
  startsAt: string;
  endsAt: string;
  calendarIds: string[];
  participation?: "organizer" | "invited" | "informed" | "unknown";
  accepted?: boolean;
  organizerId?: string;
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
/** `allowStale` lets main answer from the local cache and revalidate in the background. */
export interface CalendarReadQuery extends CalendarQuery {
  allowStale?: boolean;
}
export type CalendarFreshness = "fresh" | "stale";
export interface CalendarResult {
  events: CalendarEvent[];
  issues: CalendarIssue[];
  /** Set by the sync layer: when Small last confirmed these events. */
  fetchedAt?: number;
  freshness?: CalendarFreshness;
}
/** Pushed by main on `calendarChannels.changed`; "offline" means Small is unreachable. */
export type CalendarChange =
  | {
      type: "events";
      query: CalendarQuery;
      result: CalendarResult;
      diff: CalendarDiff;
    }
  | { type: "status"; status: "online" | "offline" | "auth-expired" };
export type CalendarReply<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      kind: CalendarIssueKind;
      error: string;
      /** Set only for writes: they may have been applied, so do not treat this as a refusal. */
      unknownOutcome?: true;
    };
export const calendarChannels = {
  people: "calendar:people",
  slots: "calendar:slots",
  calendars: "calendar:list",
  events: "calendar:events",
  detail: "calendar:detail",
  applyChange: "calendar:apply-change",
  updateEvent: "calendar:update-event",
  previewChange: "calendar:preview-change",
  reschedule: "calendar:reschedule",
  respond: "calendar:respond",
  openLink: "calendar:open-link",
  copyLink: "calendar:copy-link",
  changed: "calendar:changed",
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
  subscribeEventList(
    listener: (result: import("./event-list.js").EventListResult) => void,
  ): () => void;
  respond(input: {
    accountId: string;
    eventId: string;
    status: "accepted" | "declined";
  }): Promise<CalendarReply<void>>;
  openLink(url: string): Promise<CalendarReply<void>>;
  copyLink(url: string): Promise<CalendarReply<void>>;
  reschedule(input: {
    accountId: string;
    eventId: string;
    beforeStart: string;
    beforeEnd: string;
    startsAt: string;
    endsAt: string;
  }): Promise<CalendarReply<void>>;
  updateEvent(input: EventEditQuery): Promise<CalendarReply<void>>;
  applyChange(input: EventChangeQuery): Promise<CalendarReply<void>>;
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
    /** Skips the cached list and asks Small. */
    refresh?: boolean;
  }): Promise<CalendarReply<SmallCalendar[]>>;
  events(input: CalendarReadQuery): Promise<CalendarReply<CalendarResult>>;
  subscribe(listener: (change: CalendarChange) => void): () => void;
  detail(input: {
    accountId: string;
    lookup: EventLookup;
  }): Promise<CalendarReply<CalendarEvent>>;
}
