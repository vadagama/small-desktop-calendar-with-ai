import { z } from "zod";
import { validCalendarDate } from "../shared/calendar-time.js";

export const participantIds = z
  .array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/))
  .min(1)
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length);
export const availabilityDate = z.string().refine(validCalendarDate);
export const durationMinutes = z.number().int().min(1).max(480);
const common = {
  participant_ids: participantIds,
  timezone: z.literal("Asia/Almaty"),
};
const busy = z.strictObject({ ...common, date: availabilityDate });
const slots = z.strictObject({
  ...common,
  start_date: availabilityDate,
  duration_minutes: durationMinutes,
  include_weekends: z.boolean(),
});

/** These POSTs only query availability; no event writes or force flag. */
export function isAvailabilityRequest(path: string, body: unknown): boolean {
  if (path === "/gate/team/api/calendar/events/busy-intervals")
    return busy.safeParse(body).success;
  if (path === "/gate/team/api/calendar/events/find-slots")
    return slots.safeParse(body).success;
  return false;
}
