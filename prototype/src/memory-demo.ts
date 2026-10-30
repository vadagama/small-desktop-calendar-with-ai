import type { PreferenceKey, Preferences } from "./MemoryPreferences";
import type { MemoryEntry } from "./MemoryEntries";

export interface DemoMemory {
  preferences: Preferences;
  sources: Record<PreferenceKey, string>;
  entries: MemoryEntry[];
}
export function createDemoMemory(): DemoMemory {
  return {
    preferences: { duration: "30", from: "10:00", to: "", buffer: "15" },
    sources: {
      duration: "По вашей просьбе · 30 октября 2026",
      from: "По вашей просьбе · 30 октября 2026",
      to: "",
      buffer: "Из настроек · 30 октября 2026",
    },
    entries: [
      {
        id: "demo-victor",
        text: "Когда я говорю «Витя», я имею в виду Виктора из команды разработки.",
        source: "По вашей просьбе · 30 октября 2026",
      },
      {
        id: "demo-anna",
        text: "Повестки встреч оформляй коротким списком: цель, вопросы и ожидаемый результат.",
        source: "По вашей просьбе · 30 октября 2026",
      },
      {
        id: "demo-daniyar",
        text: "Проект «Календарь» — внутреннее desktop-приложение для нашей команды.",
        source: "По вашей просьбе · 29 октября 2026",
      },
    ],
  };
}
