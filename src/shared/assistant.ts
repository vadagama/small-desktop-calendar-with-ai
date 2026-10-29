import type { MeetingBridge } from "./meeting-operations.js";
import type { CalendarToolReply } from "./calendar-tools.js";
import type { CalendarBridge } from "./calendar.js";
import type { SmallAuthBridge } from "./small-auth.js";
import type { UIMessageChunk } from "ai";
import type { ModelConnection, ProfileBridge } from "./profiles.js";

export const assistantChannels = {
  start: "assistant:start",
  cancel: "assistant:cancel",
  event: "assistant:event",
} as const;
export interface AgentRequest {
  requestId: string;
  prompt: string;
}
export type StartResult = { ok: true } | { ok: false; error: string };
export type AgentEvent =
  | { requestId: string; type: "chunk"; chunk: UIMessageChunk }
  | { requestId: string; type: "end" };
export type AgentControl =
  | {
      type: "start";
      request: AgentRequest;
      profile: ModelConnection | null;
      calendar: boolean;
    }
  | { type: "cancel" }
  | CalendarToolReply;
export interface AssistantBridge {
  start(request: AgentRequest): Promise<StartResult>;
  cancel(requestId: string): Promise<void>;
  subscribe(listener: (event: AgentEvent) => void): () => void;
}
export interface DesktopBridge {
  notifications: import("./reminders.js").NativeNotificationBridge;
  reminders: import("./reminders.js").ReminderBridge;
  platform: string;
  sandboxed: boolean;
  contextIsolated: boolean;
  assistant: AssistantBridge;
  profiles: ProfileBridge;
  smallAuth: SmallAuthBridge;
  calendar: CalendarBridge;
  meetings: MeetingBridge;
}
declare global {
  interface Window {
    smallDesktop: DesktopBridge;
  }
}
