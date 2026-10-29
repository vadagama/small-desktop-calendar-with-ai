import {
  addDateDays,
  calendarDateAt,
  calendarRange,
} from "../shared/calendar-time.js";
import { scheduleToolInput, type ScheduleResult } from "../shared/schedule.js";
import type { CalendarService } from "./calendar.js";

export function schedulePeriod(input: unknown, now = new Date().toISOString()) {
  const q = scheduleToolInput.parse(input);
  if (q.period === "custom") return { from: q.from, to: q.to };
  const today = calendarDateAt(now);
  const date = addDateDays(
    today,
    q.period === "tomorrow" ? 1 : q.period === "next-week" ? 7 : 0,
  );
  if (q.period === "this-week" || q.period === "next-week") {
    const from = calendarDateAt(calendarRange(date, "week").start);
    return { from, to: addDateDays(from, 6) };
  }
  return { from: date, to: date };
}

export async function readSchedule(
  accountId: string,
  input: unknown,
  calendar: Pick<CalendarService, "events">,
  signal: AbortSignal,
  now?: string,
): Promise<ScheduleResult> {
  const period = schedulePeriod(input, now);
  const start = Date.parse(calendarRange(period.from, "day").start);
  const end = Date.parse(calendarRange(period.to, "day").end);
  const events = new Map<string, ScheduleResult["events"][number]>();
  const issues: ScheduleResult["issues"] = [];
  for (let date = period.from; date <= period.to;) {
    signal.throwIfAborted();
    const result = await calendar.events({
      accountId,
      date,
      view: "week",
      myCalendar: true,
      calendarIds: [],
    });
    signal.throwIfAborted();
    issues.push(...result.issues);
    for (const event of result.events) {
      if (
        Date.parse(event.startsAt) < end &&
        Date.parse(event.endsAt) > start
      ) {
        const { key, title, startsAt, endsAt, location, organizer } = event;
        events.set(key, { key, title, startsAt, endsAt, location, organizer });
      }
    }
    date = calendarDateAt(calendarRange(date, "week").end);
  }
  const sorted = [...events.values()].sort(
    (a, b) =>
      Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
      a.key.localeCompare(b.key),
  );
  if (sorted.length > 200)
    issues.push({
      source: "my",
      kind: "invalid",
      message: "Показаны первые 200 встреч. Уточните более короткий период.",
    });
  return {
    kind: "schedule",
    ...period,
    timezone: "Asia/Almaty",
    complete: issues.length === 0,
    events: sorted.slice(0, 200),
    issues,
  };
}
