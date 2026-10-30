import type { CalendarEvent, SmallCalendar } from "../shared/calendar.js";
import { calendarDateAt, calendarRange } from "../shared/calendar-time.js";
import type { Meeting } from "./ui/types.js";
const clock = new Intl.DateTimeFormat("ru", {
  timeZone: "Asia/Almaty",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const full = new Intl.DateTimeFormat("ru", {
  timeZone: "Asia/Almaty",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
/** One row per occurrence, even for an event that spans midnight or the range boundary. */
export function eventListMeetings(
  events: CalendarEvent[],
  from: string,
  to: string,
  calendars: SmallCalendar[],
): Meeting[] {
  const start = Date.parse(calendarRange(from, "day").start),
    end = Date.parse(calendarRange(to, "day").end);
  return events
    .filter((e) => Date.parse(e.startsAt) < end && Date.parse(e.endsAt) > start)
    .map((e) => {
      const date = calendarDateAt(e.startsAt);
      const timeLabel =
        date !== calendarDateAt(e.endsAt) || date < from
          ? `${full.format(new Date(e.startsAt))} – ${full.format(new Date(e.endsAt))}`
          : `${clock.format(new Date(e.startsAt))}–${clock.format(new Date(e.endsAt))}`;
      return {
        id: e.key,
        date: date < from ? from : date,
        start:
          date < from
            ? 0
            : Number(clock.format(new Date(e.startsAt)).slice(0, 2)) * 60 +
              Number(clock.format(new Date(e.startsAt)).slice(3)),
        duration: (Date.parse(e.endsAt) - Date.parse(e.startsAt)) / 60000,
        title: e.title,
        organizer: e.organizer,
        recurring: e.recurring === true,
        participation: e.participation ?? "unknown",
        accepted: e.accepted === true,
        agenda: e.description,
        calendar: e.calendarIds.length ? "team" : "personal",
        color: "green",
        people: e.participants?.map((p) => p.name) ?? [],
        location: e.location,
        timeLabel,
        calendarLabel:
          e.calendarIds
            .map((id) => calendars.find((c) => c.id === id)?.name)
            .filter(Boolean)
            .join(", ") || "Календарь Small",
      };
    });
}
