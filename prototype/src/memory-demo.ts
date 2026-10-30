import type { PreferenceKey, Preferences } from "./MemoryPreferences";
import type { MemoryEntry } from "./MemoryEntries";

export interface DemoMemory {
  preferences: Preferences;
  sources: Record<PreferenceKey, string>;
  entries: MemoryEntry[];
}
export function createDemoMemory(): DemoMemory {
  return {
    preferences: { duration: "", from: "", to: "", buffer: "" },
    sources: { duration: "", from: "", to: "", buffer: "" },
    entries: [],
  };
}
