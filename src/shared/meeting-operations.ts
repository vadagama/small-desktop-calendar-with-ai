import type { z } from "zod";
import type { meetingReference, meetingEdit } from "./meeting-validation.js";
import type { MeetingDraft } from "./meeting-draft.js";
export interface MeetingView {
  draft: MeetingDraft;
  phase: "preview" | "submitting" | "succeeded" | "unknown" | "blocked";
  message: string;
  eventId?: string;
}
export type MeetingReply =
  { ok: true; data: MeetingView } | { ok: false; error: string };
export const meetingChannels = {
  read: "meeting:read",
  edit: "meeting:edit",
  confirm: "meeting:confirm",
  reconcile: "meeting:reconcile",
} as const;
export interface MeetingBridge {
  read(input: z.infer<typeof meetingReference>): Promise<MeetingReply>;
  edit(input: z.infer<typeof meetingEdit>): Promise<MeetingReply>;
  confirm(input: z.infer<typeof meetingReference>): Promise<MeetingReply>;
  reconcile(input: z.infer<typeof meetingReference>): Promise<MeetingReply>;
}
