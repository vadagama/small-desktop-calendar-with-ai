import { eventListInput, type EventListResult } from "../shared/event-list.js";
import { calendarDateAt, calendarRange } from "../shared/calendar-time.js";
import { OccurrenceSet } from "../shared/occurrence-key.js";
import { CalendarError, type CalendarService } from "./calendar.js";

/** Bounded, authenticated reads. An incomplete source can never yield a complete search. */
export async function readEventList(
  accountId: string,
  input: unknown,
  calendar: Pick<CalendarService, "events"> &
    Partial<Pick<CalendarService, "calendars">>,
  signal: AbortSignal,
): Promise<EventListResult> {
  const parsed = eventListInput.safeParse(input);
  if (!parsed.success)
    throw new CalendarError(
      "invalid",
      "Укажите корректный период не длиннее года.",
    );
  const query = parsed.data;
  signal.throwIfAborted();
  const issues: EventListResult["issues"] = [];
  const issue = (message: string) => {
    if (!issues.some((i) => i.message === message))
      issues.push({ source: "search", kind: "invalid", message });
  };
  let sources = ["my"];
  if (query.scope === "all-accessible") {
    if (!calendar.calendars)
      throw new CalendarError("denied", "Каталог календарей недоступен.");
    const catalogs = await calendar.calendars({ accountId });
    signal.throwIfAborted();
    sources.push(...catalogs.map((c) => c.id).filter((id) => id !== "my"));
    sources = [...new Set(sources)];
  }
  const start = Date.parse(calendarRange(query.from, "day").start);
  const end = Date.parse(calendarRange(query.to, "day").end);
  const events = new OccurrenceSet();
  let reads = 0;
  outer: for (
    let date = query.from;
    date <= query.to;
    date = calendarDateAt(calendarRange(date, "week").end)
  ) {
    for (const source of sources) {
      signal.throwIfAborted();
      if (++reads > 96) {
        issue(
          "Достигнут лимит чтения календарей. Уточните период или область поиска.",
        );
        break outer;
      }
      const result = await calendar.events({
        accountId,
        date,
        view: "week",
        myCalendar: source === "my",
        calendarIds: source === "my" ? [] : [source],
      });
      signal.throwIfAborted();
      issues.push(...result.issues);
      for (const event of result.events) {
        if (
          Date.parse(event.startsAt) >= end ||
          Date.parse(event.endsAt) <= start
        )
          continue;
        if (query.organizerId) {
          if (!event.organizerId) {
            issue(
              "У части событий не указан ID организатора; полнота поиска не подтверждена.",
            );
            continue;
          }
          if (event.organizerId !== query.organizerId) continue;
        }
        events.add(event);
      }
      if (events.values().length > 1000) {
        issue(
          "Найдено более 1000 событий. Уточните период; показана часть результатов.",
        );
        break outer;
      }
    }
  }
  return {
    kind: "event-list",
    accountId,
    query,
    events: events
      .values()
      .sort(
        (a, b) =>
          Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
          a.title.localeCompare(b.title, "ru") ||
          a.key.localeCompare(b.key),
      )
      .slice(0, 1000),
    issues,
    complete: issues.length === 0,
    fetchedAt: Date.now(),
  };
}
