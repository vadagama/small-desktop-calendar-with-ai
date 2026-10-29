import type { CalendarEvent } from "./calendar.js";
export interface ReminderSettings {
  enabled: boolean;
  minutes: number;
}
export interface ReminderItem {
  id: string;
  event: CalendarEvent;
  canJoin: boolean;
}
export interface ReminderState {
  settings: ReminderSettings;
  items: ReminderItem[];
  warning: string;
}
export type ReminderReply =
  { ok: true; state: ReminderState } | { ok: false; error: string };
export interface ReminderBridge {
  read(): Promise<ReminderReply>;
  save(settings: ReminderSettings): Promise<ReminderReply>;
  join(id: string): Promise<ReminderReply>;
}
export const reminderChannels = {
  read: "reminders:read",
  save: "reminders:save",
  join: "reminders:join",
} as const;

export interface NativeNotificationState {
  status: "untested" | "waiting" | "delivered" | "opened" | "failed";
  message: string;
}
export interface NativeNotificationBridge {
  read(): Promise<NativeNotificationState>;
  test(): Promise<NativeNotificationState>;
  settings(): Promise<NativeNotificationState>;
}
export const nativeNotificationChannels = {
  read: "notifications:read",
  test: "notifications:test",
  settings: "notifications:settings",
} as const;
