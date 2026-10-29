import type { CalendarDiff } from "./calendar-diff.js";

export type CalendarChangeKind = "added" | "changed" | "moved";

/**
 * Which grid cards to highlight after a diff. `meetingIds` maps an event key to the
 * ids of its cards (an event spanning midnight has several); removed events have no
 * card left, and `skipId` keeps clear of a card that already has its own reveal.
 */
export function calendarChangeMarks(
  diff: CalendarDiff,
  meetingIds: (eventKey: string) => string[],
  skipId?: string,
): Record<string, CalendarChangeKind> {
  const marks: Record<string, CalendarChangeKind> = {};
  const groups: [CalendarChangeKind, string[]][] = [
    ["added", diff.added],
    ["changed", diff.changed],
    ["moved", diff.moved],
  ];
  for (const [kind, keys] of groups)
    for (const key of keys)
      for (const id of meetingIds(key)) if (id !== skipId) marks[id] = kind;
  return marks;
}
