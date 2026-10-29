import { z } from "zod";
import {
  meetingInvalidation,
  type EventInvalidation,
} from "../shared/calendar-invalidation.js";

export type WriteTarget = EventInvalidation & { accountId: string };

const event = z.object({
  accountId: z.string().min(1),
  eventId: z.union([z.string().min(1), z.number()]).transform(String),
});
const reschedule = event.extend({
  beforeStart: z.string(),
  beforeEnd: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
});

/** Targets are read from the same input the write got; unreadable input means "everything". */
export function rescheduleTarget(input: unknown): WriteTarget | null {
  const parsed = reschedule.safeParse(input);
  if (!parsed.success) return null;
  const v = parsed.data;
  return {
    accountId: v.accountId,
    eventIds: [v.eventId],
    windows: [
      { start: v.beforeStart, end: v.beforeEnd },
      { start: v.startsAt, end: v.endsAt },
    ],
  };
}

/** Rename, cancel and RSVP change one event wherever it is cached. */
export function eventTarget(input: unknown): WriteTarget | null {
  const parsed = event.safeParse(input);
  return parsed.success
    ? {
        accountId: parsed.data.accountId,
        eventIds: [parsed.data.eventId],
        windows: [],
      }
    : null;
}

export function meetingTarget(draft: {
  organizer: { id: string };
  startsAt: string;
  endsAt: string;
  recurrence: "none" | "weekly";
}): WriteTarget {
  return { accountId: draft.organizer.id, ...meetingInvalidation(draft) };
}
