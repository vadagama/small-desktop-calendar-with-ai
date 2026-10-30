import type { Meeting } from "./types.js";
import { addDays, shiftMonth } from "./calendar.js";
export interface ListFilter {
  from: string;
  to: string;
  organizer?: string;
}
export const monthRange = (date: string): ListFilter => ({
  from: `${date.slice(0, 7)}-01`,
  to: addDays(shiftMonth(date, 1), -1),
});
export function groupListEvents(
  events: Meeting[],
  filter: ListFilter,
  query = "",
) {
  const groups = new Map<string, Meeting[]>();
  const sorted = events
    .filter(
      (e) =>
        e.date >= filter.from &&
        e.date <= filter.to &&
        (!filter.organizer || e.organizer === filter.organizer) &&
        e.title
          .toLocaleLowerCase("ru")
          .includes(query.trim().toLocaleLowerCase("ru")),
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.start - b.start ||
        a.title.localeCompare(b.title, "ru") ||
        a.id.localeCompare(b.id),
    );
  for (const event of sorted)
    groups.set(event.date, [...(groups.get(event.date) ?? []), event]);
  return [...groups].map(([date, events]) => ({ date, events }));
}
