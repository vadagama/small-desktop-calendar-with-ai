import type { MeetingDraft } from "../shared/meeting-draft.js";
import {
  addDateDays,
  calendarDateAt,
  calendarRange,
} from "../shared/calendar-time.js";
import { CalendarError } from "./calendar.js";
export function meetingOccurrences(d: MeetingDraft): MeetingDraft[] {
  const rule = d.options?.recurrence;
  if (!rule) return [d];
  const first = calendarDateAt(d.startsAt);
  const days = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const chosen = (date: string) =>
    rule.BYDAY.includes(
      days[
        new Date(date + "T12:00:00Z").getUTCDay()
      ] as (typeof rule.BYDAY)[number],
    );
  if (
    !chosen(first) ||
    rule.UNTIL < first ||
    rule.UNTIL > addDateDays(first, 90)
  )
    throw new CalendarError(
      "invalid",
      "Проверьте дни повторения и дату окончания: до 90 дней от первой встречи.",
    );
  const offset =
    Date.parse(d.startsAt) - Date.parse(calendarRange(first, "day").start);
  const result: MeetingDraft[] = [];
  for (let date = first; date <= rule.UNTIL; date = addDateDays(date, 1)) {
    if (!chosen(date)) continue;
    const start = Date.parse(calendarRange(date, "day").start) + offset;
    result.push({
      ...d,
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + d.durationMinutes * 60000).toISOString(),
    });
    if (result.length > 32)
      throw new CalendarError("invalid", "Выберите не более 32 повторений.");
  }
  return result;
}
