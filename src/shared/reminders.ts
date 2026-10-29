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
