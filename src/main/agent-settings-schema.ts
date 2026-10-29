import { z } from "zod";
import { skillIds, moodIds } from "../shared/agent-settings.js";
export const agentSettingsSchema = z.strictObject({
  version: z.union([z.literal(1), z.literal(2)]),
  mood: z.enum(moodIds).default("neutral"),
  instructions: z.string().max(8000),
  skills: z
    .array(
      z.strictObject({
        id: z.enum(skillIds),
        enabled: z.boolean(),
        content: z.string().trim().min(1).max(16000),
      }),
    )
    .length(skillIds.length)
    .refine(
      (skills) => new Set(skills.map((s) => s.id)).size === skillIds.length,
    ),
});
