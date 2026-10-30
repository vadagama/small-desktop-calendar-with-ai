import { z } from "zod";

const id = z.string().min(1).max(128);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const memoryPreferences = z
  .strictObject({
    durationMinutes: z.number().int().min(1).max(480).optional(),
    timeFrom: time.optional(),
    timeTo: time.optional(),
    bufferMinutes: z.number().int().min(0).max(120).optional(),
  })
  .refine(
    (p) => !p.timeFrom || !p.timeTo || p.timeFrom < p.timeTo,
    "Начало диапазона должно быть раньше окончания.",
  );
export type MemoryPreferences = z.infer<typeof memoryPreferences>;
export const memoryPreferencePatch = z.strictObject({
  durationMinutes: z.number().int().min(1).max(480).nullable().optional(),
  timeFrom: time.nullable().optional(),
  timeTo: time.nullable().optional(),
  bufferMinutes: z.number().int().min(0).max(120).nullable().optional(),
});
export const memorySource = z.strictObject({
  kind: z.enum(["settings", "chat", "legacy-import"]),
  at: z.iso.datetime(),
  messageId: z.string().max(128).optional(),
});
const metadata = {
  id,
  revision: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  source: memorySource,
  lastSource: memorySource,
};
export const memoryEntry = z.strictObject({
  ...metadata,
  text: z.string().trim().min(1).max(2000),
  participantId: id.optional(),
  alias: z.string().max(100).optional(),
});
const members = z
  .array(id)
  .min(1)
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length);
const person = z.strictObject({
  participantId: id,
  name: z.string().min(1).max(500),
  position: z.string().max(500),
});
export const memoryGroupValue = z.strictObject({
  name: z.string().trim().min(1).max(100),
  participantIds: members,
  people: z.array(person).max(20).optional(),
});
export const memoryPresetValue = z
  .strictObject({
    name: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(500).optional(),
    agenda: z.string().max(8000).optional(),
    durationMinutes: z.number().int().min(1).max(480).optional(),
    participantIds: members.optional(),
    groupId: id.optional(),
    people: z.array(person).max(20).optional(),
  })
  .refine(
    (p) => !(p.groupId && p.participantIds),
    "Выберите группу либо отдельных участников.",
  );
export const memoryGroup = memoryGroupValue.extend(metadata);
export const memoryPreset = z.strictObject({
  ...memoryPresetValue.shape,
  ...metadata,
});
export const rememberedParticipant = z.object({
  participantId: id,
  name: z.string().max(500),
  position: z.string().max(500),
  aliases: z.array(z.string().max(100)).max(20),
  uses: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export const assistantMemoryState = z.strictObject({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  preferences: memoryPreferences,
  preferenceSources: z.record(z.string(), memorySource),
  entries: z.array(memoryEntry).max(100),
  groups: z.array(memoryGroup).max(100),
  presets: z.array(memoryPreset).max(100),
  participants: z.array(rememberedParticipant).max(100),
});
export type AssistantMemoryState = z.infer<typeof assistantMemoryState>;
export type MemoryGroup = z.infer<typeof memoryGroup>;
export type MemoryPreset = z.infer<typeof memoryPreset>;
export type MemorySource = z.infer<typeof memorySource>;
export const memoryChange = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("preferences"),
    value: memoryPreferencePatch,
  }),
  z.strictObject({
    action: z.literal("entry"),
    id: id.optional(),
    text: memoryEntry.shape.text,
  }),
  z.strictObject({
    action: z.literal("group"),
    id: id.optional(),
    value: memoryGroupValue,
  }),
  z.strictObject({
    action: z.literal("preset"),
    id: id.optional(),
    value: memoryPresetValue,
  }),
  z.strictObject({
    action: z.literal("delete"),
    category: z.enum(["entries", "groups", "presets"]),
    id,
  }),
  z.strictObject({
    action: z.literal("clear"),
    category: z.enum(["preferences", "entries", "groups", "presets", "all"]),
  }),
]);
export type MemoryChange = z.infer<typeof memoryChange>;
export const memoryWrite = z.strictObject({
  revision: z.number().int().nonnegative(),
  requestId: z.uuid(),
  change: memoryChange,
});
export type MemoryReply =
  | { ok: true; accountId: string; state: AssistantMemoryState }
  | {
      ok: false;
      error: string;
      kind: "denied" | "conflict" | "unavailable" | "invalid";
    };
export interface MemoryProposal {
  label?: string | undefined;
  groupName?: string | undefined;
  kind: "memory-proposal";
  id: string;
  accountId: string;
  revision: number;
  change: MemoryChange;
  source: MemorySource;
}

export interface AssistantMemoryBridge {
  read(): Promise<MemoryReply>;
  write(input: z.infer<typeof memoryWrite>): Promise<MemoryReply>;
  confirm(input: { id: string }): Promise<MemoryReply>;
  reset(): Promise<MemoryReply>;
}
export const taskOption = z.strictObject({
  label: z.string().trim().min(1).max(300),
  preferences: memoryPreferences,
});
export type TaskOption = z.infer<typeof taskOption>;

export const assistantMemoryToolInput = z.strictObject({
  action: z.enum([
    "recall",
    "review",
    "cancel",
    "propose",
    "useGroup",
    "usePreset",
    "task",
    "offerTask",
  ]),
  questions: z.array(z.string().trim().min(1).max(500)).max(5).optional(),
  query: z.string().max(100).optional(),
  id: id.optional(),
  change: memoryChange.optional(),
  preferences: memoryPreferences.optional(),
  ignoreTimeWindow: z.boolean().optional(),
  ignoreBuffer: z.boolean().optional(),
  resetTask: z.boolean().optional(),
  options: z.array(taskOption).min(1).max(5).optional(),
  evidence: z.string().trim().min(1).max(2000).optional(),
});
