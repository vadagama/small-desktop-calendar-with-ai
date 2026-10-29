import { z } from "zod";
import { skillIds, moodIds } from "../shared/agent-settings.js";
/** First settings version that must contain the skill; older files gain it on read. */
const requiredFrom: Record<(typeof skillIds)[number], number> = {
  "people-search": 1,
  availability: 1,
  "meeting-draft": 1,
  schedule: 3,
  analytics: 4,
};
export const agentSettingsSchema = z
  .strictObject({
    version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    mood: z.enum(moodIds).default("neutral"),
    instructions: z.string().max(8000),
    promptTemplates: z
      .array(z.string().trim().min(1).max(2000))
      .max(5)
      .optional(),
    skills: z
      .array(
        z.strictObject({
          id: z.enum(skillIds),
          enabled: z.boolean(),
          content: z.string().trim().min(1).max(16000),
        }),
      )
      .min(skillIds.length - 2)
      .max(skillIds.length)
      .refine(
        (skills) => new Set(skills.map((s) => s.id)).size === skills.length,
      ),
  })
  .refine((settings) =>
    skillIds.every(
      (id) =>
        settings.skills.some((s) => s.id === id) ||
        settings.version < requiredFrom[id],
    ),
  );
