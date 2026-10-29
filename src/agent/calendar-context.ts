import { addDateDays, calendarDateAt } from "../shared/calendar-time.js";
export function calendarClock(now = new Date().toISOString()) {
  const today = calendarDateAt(now);
  const days = Array.from({ length: 8 }, (_, index) => {
    const date = addDateDays(today, index);
    const weekday = new Intl.DateTimeFormat("ru-RU", {
      weekday: "long",
      timeZone: "Asia/Almaty",
    }).format(new Date(date + "T12:00:00+05:00"));
    return `${date} — ${weekday}`;
  });
  return `Текущее время: ${now}. Часовой пояс календаря Asia/Almaty (UTC+05:00). Сегодня: ${today}. Завтра: ${addDateDays(today, 1)}.\nБлижайшие дни:\n${days.join("\n")}`;
}
