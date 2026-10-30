import { addDays, parseDate, weekStart } from "./calendar";
import type { CalendarId, Meeting } from "./types";

export const dashboards = {
  load: "Моя нагрузка",
  organizers: "Организаторы",
  rhythm: "Ритм и фокус",
  calendars: "Обзор календарей",
  report: "AI-обзор",
} as const;
export type Dashboard = keyof typeof dashboards;
export type Panel = "calendar" | "assistant" | Dashboard;
export type Period = "week" | "month";
export interface AnalyticsQuery {
  from: string;
  to: string;
  scope: "mine" | "calendars";
  calendars: CalendarId[];
  workStart: number;
  workEnd: number;
}
const dayMinutes = 1440;
const serial = (date: string) => Date.parse(`${date}T00:00:00Z`) / 60000;
export const hours = (minutes: number) =>
  `${new Intl.NumberFormat("ru", { maximumFractionDigits: 1 }).format(minutes / 60)} ч`;
export function periodFor(date: string, period: Period) {
  const from = period === "week" ? weekStart(date) : `${date.slice(0, 7)}-01`;
  const next = parseDate(from);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const to =
    period === "week"
      ? addDays(from, 6)
      : addDays(next.toISOString().slice(0, 10), -1);
  const length = Math.round((serial(to) - serial(from)) / dayMinutes) + 1;
  return {
    from,
    to,
    previousFrom: addDays(from, -length),
    previousTo: addDays(from, -1),
  };
}
function merge(intervals: [number, number][]) {
  const result: [number, number][] = [];
  for (const [start, end] of [...intervals].sort((a, b) => a[0] - b[0])) {
    const last = result.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}
const duration = (intervals: [number, number][]) =>
  intervals.reduce((sum, [start, end]) => sum + end - start, 0);
export function analyze(input: Meeting[], q: AnalyticsQuery) {
  const from = serial(q.from),
    end = serial(addDays(q.to, 1));
  const source = [
    ...new Map(input.map((event) => [event.id, event])).values(),
  ].filter(
    (event) =>
      q.calendars.includes(event.calendar) &&
      event.duration > 0 &&
      Number.isFinite(event.start) &&
      Number.isFinite(event.duration) &&
      serial(event.date) + event.start < end &&
      serial(event.date) + event.start + event.duration > from,
  );
  const personal = source.filter(
    (e) =>
      e.participation === "organizer" ||
      (e.people.includes("Алексей") && e.accepted === true),
  );
  const events = (q.scope === "mine" ? personal : source).filter(
    (e) => e.kind !== "focus" && e.duration < dayMinutes,
  );
  const intervals = events.map((e): [number, number] => [
    Math.max(from, serial(e.date) + e.start),
    Math.min(end, serial(e.date) + e.start + e.duration),
  ]);
  const minutes = duration(intervals),
    busy = duration(merge(intervals));
  const reservations = source.filter(
    (event) =>
      q.scope === "calendars" ||
      event.participation === "organizer" ||
      event.people.includes("Алексей"),
  );
  const days = [];
  const windows: { date: string; start: number; duration: number }[] = [];
  let workBusy = 0,
    capacity = 0;
  for (let date = q.from; date <= q.to; date = addDays(date, 1)) {
    const base = serial(date);
    const parts = intervals
      .map(([s, e]): [number, number] => [
        Math.max(base, s),
        Math.min(base + dayMinutes, e),
      ])
      .filter(([s, e]) => e > s);
    const dayEvents = events.filter(
      (e) =>
        serial(e.date) + e.start < base + dayMinutes &&
        serial(e.date) + e.start + e.duration > base,
    );
    days.push({
      date,
      minutes: duration(parts),
      busy: duration(merge(parts)),
      count: dayEvents.length,
      events: dayEvents,
      segments: dayEvents.map((event) => ({
        event,
        start: Math.max(0, serial(event.date) + event.start - base),
        end: Math.min(
          dayMinutes,
          serial(event.date) + event.start + event.duration - base,
        ),
      })),
    });
    if ([0, 6].includes(parseDate(date).getUTCDay())) continue;
    capacity += q.workEnd - q.workStart;
    const working = merge(
      parts
        .map(([s, e]): [number, number] => [
          Math.max(base + q.workStart, s),
          Math.min(base + q.workEnd, e),
        ])
        .filter(([s, e]) => e > s),
    );
    workBusy += duration(working);
    const reservedWorking = merge(
      reservations
        .map((event): [number, number] => [
          Math.max(base + q.workStart, serial(event.date) + event.start),
          Math.min(
            base + q.workEnd,
            serial(event.date) + event.start + event.duration,
          ),
        ])
        .filter(([s, e]) => e > s),
    );
    let cursor = base + q.workStart;
    for (const [start, finish] of [
      ...reservedWorking,
      [base + q.workEnd, base + q.workEnd],
    ]) {
      if (start - cursor >= 60)
        windows.push({ date, start: cursor - base, duration: start - cursor });
      cursor = Math.max(cursor, finish);
    }
  }
  const organizers = [...new Set(events.map((e) => e.organizer || "Не указан"))]
    .map((name) => {
      const rows = events.filter((e) => (e.organizer || "Не указан") === name);
      return {
        name,
        count: rows.length,
        minutes: rows.reduce(
          (sum, e) =>
            sum +
            Math.min(end, serial(e.date) + e.start + e.duration) -
            Math.max(from, serial(e.date) + e.start),
          0,
        ),
        events: rows,
      };
    })
    .sort((a, b) => b.minutes - a.minutes);
  return {
    events,
    count: events.length,
    minutes,
    busy,
    overlap: minutes - busy,
    days,
    organizers,
    windows,
    capacity,
    workBusy,
    regularMinutes: events
      .filter((e) => e.recurring)
      .reduce(
        (sum, e) =>
          sum +
          Math.min(end, serial(e.date) + e.start + e.duration) -
          Math.max(from, serial(e.date) + e.start),
        0,
      ),
    unconfirmed:
      q.scope === "mine"
        ? source.filter((e) => e.kind !== "focus" && !personal.includes(e))
            .length
        : 0,
  };
}
const localDate = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
export function refreshDue(last: string | null, now: Date) {
  if (!last || !Number.isFinite(Date.parse(last))) return true;
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Almaty",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  const scheduledDay = hour < 7 ? addDays(localDate(now), -1) : localDate(now);
  return Date.parse(last) < Date.parse(`${scheduledDay}T07:00:00+05:00`);
}
