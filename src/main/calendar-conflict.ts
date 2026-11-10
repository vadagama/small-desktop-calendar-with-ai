import { z } from "zod";
import { CalendarError, calendarJson } from "./calendar.js";

export class CalendarConflictError extends CalendarError {
  constructor(
    public readonly participantIds: string[] = [],
    message = "У участников есть пересечения с выбранным временем.",
  ) {
    super("invalid", message);
  }
}

/** Small returns participant GUIDs as validation errors; other errors must not be forced. */
export async function participantConflicts(
  response: Response,
  requestedIds: string[],
) {
  if (![409, 422].includes(response.status)) return undefined;
  try {
    const parsed = z
      .object({
        errors: z.strictObject({
          participant_ids: z.array(z.string().min(1).max(128)).min(1).max(100),
        }),
      })
      .safeParse(await calendarJson(new Response(response.clone().body)));
    if (
      !parsed.success ||
      parsed.data.errors.participant_ids.some(
        (id) => !requestedIds.includes(id),
      )
    )
      return undefined;
    return [...new Set(parsed.data.errors.participant_ids)];
  } catch {
    return undefined;
  }
}
