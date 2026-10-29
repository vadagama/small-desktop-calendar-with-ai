import type { CalendarView } from "./calendar.js";

export const calendarTimeZone = "Asia/Almaty";
const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: calendarTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
function parts(instant: Date) {
  const entries = formatter.formatToParts(instant);
  const get = (name: string) => entries.find((p) => p.type === name)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: +get("hour"),
    minute: +get("minute"),
    second: +get("second"),
  };
}
export function calendarDateAt(instant: string) {
  return parts(new Date(instant)).date;
}
export function calendarToday() {
  return parts(new Date()).date;
}
export function addDateDays(date: string, days: number) {
  const instant = new Date(date + "T00:00:00Z");
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}
export function validCalendarDate(date: string) {
  return (
    /^20\d{2}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(date + "T00:00:00Z")) &&
    new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date
  );
}
function monday(date: string) {
  return addDateDays(
    date,
    -((new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7),
  );
}
function midnight(date: string) {
  const target = Date.parse(date + "T00:00:00Z");
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(guess));
    guess +=
      target -
      Date.parse(
        `${p.date}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}:${String(p.second).padStart(2, "0")}Z`,
      );
  }
  return new Date(guess).toISOString();
}
export function calendarRange(date: string, view: CalendarView) {
  if (!validCalendarDate(date)) throw Error("Invalid calendar date");
  let first = date,
    end = addDateDays(date, 1);
  if (view === "week") {
    first = monday(date);
    end = addDateDays(first, 7);
  }
  if (view === "month") {
    first = monday(date.slice(0, 7) + "-01");
    const nextMonth = new Date(date.slice(0, 7) + "-01T00:00:00Z");
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    end = nextMonth.toISOString().slice(0, 10);
    while (new Date(end + "T00:00:00Z").getUTCDay() !== 1)
      end = addDateDays(end, 1);
  }
  return { start: midnight(first), end: midnight(end) };
}
export function splitEventDays(
  startsAt: string,
  endsAt: string,
  range: { start: string; end: string },
) {
  let start = Math.max(Date.parse(startsAt), Date.parse(range.start));
  const end = Math.min(Date.parse(endsAt), Date.parse(range.end));
  const result: { date: string; start: number; duration: number }[] = [];
  while (start < end && result.length < 42) {
    const p = parts(new Date(start));
    const next = Math.min(end, Date.parse(midnight(addDateDays(p.date, 1))));
    const minutes = p.hour * 60 + p.minute;
    const duration = Math.max(1, Math.ceil((next - start) / 60000));
    result.push({ date: p.date, start: minutes, duration });
    start = next;
  }
  return result;
}

/** Next quarter-hour in the calendar timezone, with a 30-minute default. */
export function defaultMeetingSchedule(date: string, now = new Date()) {
  const current = parts(now);
  let start = 9 * 60;
  if (date === current.date)
    start = Math.ceil((current.hour * 60 + current.minute + 1) / 15) * 15;
  if (start + 30 >= 1440) {
    date = addDateDays(date, 1);
    start = 9 * 60;
  }
  const time = (value: number) =>
    `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  return { date, start: time(start), end: time(start + 30) };
}
