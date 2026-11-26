import { z } from "zod";

const participant = z.strictObject({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  organizer: z.boolean(),
});
const calendarEvent = z.strictObject({
  attachments: z
    .array(
      z.strictObject({
        id: z.string(),
        name: z.string(),
        size: z.number().optional(),
        url: z.string().optional(),
      }),
    )
    .optional(),
  notificationRecipients: z
    .array(
      z.strictObject({
        id: z.string(),
        name: z.string(),
      }),
    )
    .optional(),
  recurrenceRule: z
    .strictObject({
      FREQ: z.string(),
      INTERVAL: z.number().int().positive().optional(),
      BYDAY: z.array(z.string()).optional(),
      UNTIL: z.string().optional(),
    })
    .optional(),
  participants: z.array(participant).optional(),
  recurring: z.boolean().optional(),
  originalEventId: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  key: z.string(),
  lookup: z.union([
    z.strictObject({ id: z.string() }),
    z.strictObject({ originalEventId: z.string(), date: z.string() }),
  ]),
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  calendarIds: z.array(z.string()),
  participation: z
    .enum(["organizer", "invited", "informed", "unknown"])
    .optional(),
  accepted: z.boolean().optional(),
  participationStatus: z.string().optional(),
  organizer: z.string(),
  organizerId: z.string().optional(),
  description: z.string(),
  location: z.string(),
});
export const cachedEventsSchema = z.strictObject({
  events: z.array(calendarEvent),
  issues: z.array(
    z.strictObject({
      source: z.string(),
      kind: z.enum(["auth", "denied", "network", "invalid", "not-found"]),
      message: z.string(),
    }),
  ),
});

export const cachedPeopleSchema = z.object({
  people: z.array(
    z.object({
      participantId: z.string(),
      name: z.string(),
      position: z.string(),
    }),
  ),
  page: z.number().int(),
  nextPage: z.number().int().nullable(),
});
