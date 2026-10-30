import { addDays } from "./calendar";
import { DEMO_EVENTS } from "./data";
import type { Meeting } from "./types";

// These flags are fixture facts, not classifications inferred from meeting titles.
const focus = new Set(["m2", "t3", "th2"]);
const regular = new Set(["m1", "t1", "w1", "th1", "f1", "f2"]);
export const ANALYTICS_DEMO_EVENTS: Meeting[] = DEMO_EVENTS.map((event) => ({
  ...event,
  accepted: ["m1", "t1", "w1", "w4", "th3"].includes(event.id),
  recurring: regular.has(event.id),
  kind: focus.has(event.id) ? "focus" : "meeting",
  organizer:
    event.id === "w3"
      ? "Данияр"
      : event.id === "f2"
        ? "Мария"
        : event.organizer,
}));
for (let week = -8; week <= 2; week++) {
  if (week === 0) continue;
  for (const [index, event] of DEMO_EVENTS.entries()) {
    if (index % 5 === Math.abs(week) % 5 && !focus.has(event.id)) continue;
    ANALYTICS_DEMO_EVENTS.push({
      ...event,
      id: `history:${week}:${event.id}`,
      date: addDays(event.date, week * 7),
      duration: focus.has(event.id)
        ? event.duration
        : Math.max(15, event.duration + (week % 3) * 15),
      organizer: ["Анна", "Алексей", "Данияр", "Мария"][
        (index + Math.abs(week)) % 4
      ],
      participation: index % 3 === 0 ? "organizer" : "invited",
      accepted: index % 4 !== 0,
      recurring: regular.has(event.id),
      kind: focus.has(event.id) ? "focus" : "meeting",
    });
  }
}

// Synthetic organizer-search fixtures; no real meeting payloads.
for (const [index, date] of [
  "2026-10-02",
  "2026-10-07",
  "2026-10-14",
  "2026-10-21",
  "2026-10-23",
].entries()) {
  ANALYTICS_DEMO_EVENTS.push({
    id: `list-demo:${index}`,
    date,
    start: 600 + (index % 2) * 120,
    duration: 45,
    title: [
      "Обзор задач команды",
      "Планирование запуска",
      "Обсуждение обратной связи",
      "Синхронизация проекта",
      "Итоги месяца",
    ][index],
    organizer: "Жанна",
    people: ["Алексей", "Жанна"],
    calendar: "team",
    color: "blue",
    location: "Онлайн",
    agenda: "Демонстрационное событие для проверки поиска.",
    participation: "invited",
  });
}
