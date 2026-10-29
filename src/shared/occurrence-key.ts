import type { CalendarEvent } from "./calendar.js";
import { calendarDateAt } from "./calendar-time.js";
import { legacyOccurrenceKey, occurrenceKey } from "./series-scope.js";

/**
 * Extra identities of a series occurrence, so it is recognised after it changes shape
 * (virtual → materialized). Primary keys never change:
 * - virtual: the local date of the slot;
 * - materialized (has its own id): that date plus the old virtual key (`series:{id}:{ms}`),
 *   which also recognises deliveries recorded before aliases existed.
 * Events without `original_event_id` have none.
 */
export function occurrenceAliases(input: {
  seriesId?: string | null | undefined;
  id?: string | null | undefined;
  startsAt: string;
}): string[] {
  if (!input.seriesId) return [];
  const byDate = occurrenceKey({
    seriesId: input.seriesId,
    originalDate: calendarDateAt(input.startsAt),
  });
  return input.id
    ? [byDate, legacyOccurrenceKey(input.seriesId, input.startsAt)]
    : [byDate];
}

const ownId = (event: Pick<CalendarEvent, "lookup">) =>
  "id" in event.lookup ? event.lookup.id : undefined;
export const occurrenceIdentities = (
  event: Pick<CalendarEvent, "key" | "aliases">,
) => [event.key, ...(event.aliases ?? [])];

/**
 * Same key, or a shared identity. Two different events of their own are never the same
 * occurrence, even when they share a series and a day.
 */
export function isSameOccurrence(
  a: Pick<CalendarEvent, "key" | "aliases" | "lookup">,
  b: Pick<CalendarEvent, "key" | "aliases" | "lookup">,
) {
  if (a.key === b.key) return true;
  const x = ownId(a);
  const y = ownId(b);
  if (x && y && x !== y) return false;
  const known = new Set(occurrenceIdentities(a));
  return occurrenceIdentities(b).some((identity) => known.has(identity));
}

/**
 * Events keyed by occurrence. A virtual and a materialized view of one occurrence collapse
 * into the materialized one (it can be changed); everything else keeps the old behaviour:
 * the same key, later wins. Order is the order of first appearance.
 */
export class OccurrenceSet {
  private entries = new Map<string, { event: CalendarEvent; seq: number }>();
  private owner = new Map<string, string>();
  private seq = 0;

  private find(event: CalendarEvent) {
    const seen = new Set<string>();
    for (const identity of occurrenceIdentities(event)) {
      const key = this.owner.get(identity);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const entry = this.entries.get(key);
      if (entry && isSameOccurrence(entry.event, event)) return entry;
    }
    return undefined;
  }
  private register(event: CalendarEvent) {
    for (const identity of occurrenceIdentities(event))
      if (!this.owner.has(identity)) this.owner.set(identity, event.key);
  }

  add(event: CalendarEvent) {
    const existing = this.find(event);
    if (!existing) {
      this.entries.set(event.key, { event, seq: this.seq++ });
      this.register(event);
      return;
    }
    // A virtual view never replaces the materialized one.
    if (ownId(existing.event) && !ownId(event)) return;
    for (const identity of occurrenceIdentities(existing.event))
      if (this.owner.get(identity) === existing.event.key)
        this.owner.delete(identity);
    this.entries.delete(existing.event.key);
    this.entries.set(event.key, { event, seq: existing.seq });
    this.register(event);
  }

  values() {
    return [...this.entries.values()]
      .sort((a, b) => a.seq - b.seq)
      .map((entry) => entry.event);
  }
}
