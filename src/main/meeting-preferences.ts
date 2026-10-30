import type { MemoryPreferences } from "../shared/assistant-memory.js";

export interface TaskPreferences extends MemoryPreferences {
  ignoreTimeWindow?: boolean;
  ignoreBuffer?: boolean;
}
export function resolveMeetingPreferences(
  saved: MemoryPreferences,
  task: TaskPreferences = {},
  preset: MemoryPreferences = {},
  source: MemoryPreferences = {},
) {
  const values: MemoryPreferences = {};
  const sources: Record<string, string> = {};
  for (const key of [
    "durationMinutes",
    "timeFrom",
    "timeTo",
    "bufferMinutes",
  ] as const) {
    const value = task[key] ?? source[key] ?? preset[key] ?? saved[key];
    if (value !== undefined) {
      (values as Record<string, unknown>)[key] = value;
      sources[key] =
        task[key] !== undefined
          ? "request"
          : source[key] !== undefined
            ? "source"
            : preset[key] !== undefined
              ? "preset"
              : "memory";
    }
  }
  if (task.ignoreTimeWindow) {
    delete values.timeFrom;
    delete values.timeTo;
    delete sources.timeFrom;
    delete sources.timeTo;
  }
  if (task.ignoreBuffer) {
    values.bufferMinutes = 0;
    sources.bufferMinutes = "request";
  }
  return { values, sources };
}
