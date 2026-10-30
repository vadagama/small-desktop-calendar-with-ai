import { z } from "zod";
import { validCalendarDate } from "../shared/calendar-time.js";

/** Only the two POST shapes used by Small's delete dialog. */
export function isSeriesDeletionRequest(path: string, body: unknown): boolean {
  if (path === "/gate/team/api/calendar/events/from-template")
    return z
      .strictObject({
        original_event_id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
        date: z.string().refine(validCalendarDate),
      })
      .safeParse(body).success;
  return (
    /^\/gate\/team\/api\/calendar\/events\/[A-Za-z0-9_-]{1,128}\/cancel$/.test(
      path,
    ) &&
    z.strictObject({ reason: z.string().min(1).max(500) }).safeParse(body)
      .success
  );
}
