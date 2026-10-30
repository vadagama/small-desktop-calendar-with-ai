import type { CalendarRecurrenceRule } from "./calendar.js";

const weekdays: Record<string, string> = {
  MO: "пн",
  TU: "вт",
  WE: "ср",
  TH: "чт",
  FR: "пт",
  SA: "сб",
  SU: "вс",
};

export function recurrenceSummary(rule?: CalendarRecurrenceRule): string {
  if (!rule) return "Повторяющееся событие";
  const interval = rule.INTERVAL ?? 1;
  const plural = (one: string, few: string, many: string) => {
    const form = new Intl.PluralRules("ru").select(interval);
    return form === "one" ? one : form === "few" ? few : many;
  };
  if (rule.FREQ === "DAILY")
    return interval === 1
      ? "Каждый день"
      : `Каждые ${interval} ${plural("день", "дня", "дней")}`;
  if (rule.FREQ === "WEEKLY") {
    const days = rule.BYDAY?.map((day) => weekdays[day]);
    if (days?.some((day) => !day)) return "Повторяющееся событие";
    if (interval === 1 && rule.BYDAY?.length === 1) {
      const dayNames: Record<string, string> = {
        MO: "Каждый понедельник",
        TU: "Каждый вторник",
        WE: "Каждую среду",
        TH: "Каждый четверг",
        FR: "Каждую пятницу",
        SA: "Каждую субботу",
        SU: "Каждое воскресенье",
      };
      return dayNames[rule.BYDAY[0]!]!;
    }
    const frequency =
      interval === 1
        ? "Каждую неделю"
        : `Каждые ${interval} ${plural("неделю", "недели", "недель")}`;
    return frequency + (days?.length ? `: ${days.join(", ")}` : "");
  }
  return "Повторяющееся событие";
}
