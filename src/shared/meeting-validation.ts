import { z } from "zod";
import { meetingDraftInput } from "./meeting-draft.js";
export const meetingReference = z.strictObject({
  id: z.uuid(),
  revision: z.number().int().positive(),
});
export const meetingEdit = meetingReference.extend({
  title: meetingDraftInput.shape.title,
  agenda: meetingDraftInput.shape.agenda,
});
export const meetingConfirmation = meetingReference.extend({
  allowUnconfirmed: z.boolean().optional(),
});
