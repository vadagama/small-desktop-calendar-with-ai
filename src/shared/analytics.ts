import type { CalendarIssue } from "./calendar.js";

export interface TopicRule {
  topic: string;
  keywords: string[];
}
export type EventGroup =
  "confirmed" | "unconfirmed" | "declined" | "possible-all-day" | "invalid";
export interface AnalyticsEvent {
  key: string;
  title: string;
  startsAt: string;
  endsAt: string;
  organizer: string;
  group: EventGroup;
  /** Minutes inside the period; 0 for groups that are not counted as time. */
  minutes: number;
  regular: boolean;
  topic: string;
  /** Matching topic rule, or null when the meeting has no category. */
  rule: string | null;
}
export interface AnalyticsBucket {
  name: string;
  count: number;
  minutes: number;
}
export interface AnalyticsResult {
  kind: "analytics";
  from: string;
  to: string;
  timezone: "Asia/Almaty";
  /** False when reading was incomplete or truncated: totals are partial. */
  complete: boolean;
  duplicates: number;
  /** Main total: confirmed meetings only. */
  totals: {
    count: number;
    sumMinutes: number;
    busyMinutes: number;
    overlapMinutes: number;
    regularCount: number;
    regularMinutes: number;
  };
  groups: Record<EventGroup, { count: number; minutes: number }>;
  byTopic: AnalyticsBucket[];
  byOrganizer: AnalyticsBucket[];
  topParticipants: AnalyticsBucket[];
  /** Data the calendar does not provide; never inferred. */
  unavailable: ("cancellations" | "teams" | "tags")[];
  rules: string[];
  events: AnalyticsEvent[];
  issues: CalendarIssue[];
}
