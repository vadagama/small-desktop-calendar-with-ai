import type { z } from "zod";
import type { meetingReference, meetingEdit } from "./meeting-validation.js";
import type { manualMeetingInput, MeetingDraft } from "./meeting-draft.js";
export interface MeetingView {
  draft: MeetingDraft;
  phase: "preview" | "submitting" | "succeeded" | "unknown" | "blocked";
  message: string;
  eventId?: string;
}
export type MeetingReply =
  { ok: true; data: MeetingView } | { ok: false; error: string };
export const meetingChannels = {
  prepare: "meeting:prepare",
  attach: "meeting:attach",
  read: "meeting:read",
  edit: "meeting:edit",
  confirm: "meeting:confirm",
  reconcile: "meeting:reconcile",
} as const;
export interface MeetingBridge {
  attach(
    remaining: number,
  ): Promise<
    | { ok: true; files: { id: string; name: string }[] }
    | { ok: false; error: string }
  >;
  prepare(
    input: z.input<typeof manualMeetingInput>,
  ): Promise<{ ok: true; data: MeetingDraft } | { ok: false; error: string }>;
  read(input: z.infer<typeof meetingReference>): Promise<MeetingReply>;
  edit(input: z.infer<typeof meetingEdit>): Promise<MeetingReply>;
  confirm(input: z.infer<typeof meetingReference>): Promise<MeetingReply>;
  reconcile(input: z.infer<typeof meetingReference>): Promise<MeetingReply>;
}
