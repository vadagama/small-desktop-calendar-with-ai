import { z } from "zod";
import type { CalendarService } from "./calendar.js";
import type { EventCache } from "./event-cache.js";

type Directory = Pick<CalendarService, "calendars" | "searchPeople">;

const account = z.string().min(1).max(200);
// Strict on purpose: anything else is passed on untouched so the service reports it.
const calendarsInput = z.strictObject({
  accountId: account,
  refresh: z.boolean().optional(),
});
const peopleInput = z.strictObject({
  accountId: account,
  query: z.string().trim().min(1).max(200),
  page: z.number().int().min(1),
  refresh: z.boolean().optional(),
});
const calendarsValue = z.array(z.object({ id: z.string(), name: z.string() }));
const peopleValue = z.object({
  people: z.array(
    z.object({
      participantId: z.string(),
      name: z.string(),
      position: z.string(),
    }),
  ),
  page: z.number().int(),
  nextPage: z.number().int().nullable(),
});

/**
 * The calendar list and people search change rarely, so they are served from the
 * cache for a day (the cache's catalog TTL). A write never touches them; sign-in and
 * sign-out clear them with everything else. `refresh: true` always asks Small.
 */
export class CachedCatalog {
  constructor(
    private service: Directory,
    private cache: EventCache,
  ) {}

  async calendars(input: unknown) {
    const parsed = calendarsInput.safeParse(input);
    if (!parsed.success) return this.service.calendars(input);
    const { accountId, refresh } = parsed.data;
    const key = "calendars";
    if (!refresh) {
      const hit = calendarsValue.safeParse(
        (await this.cache.getCatalog(accountId, key))?.value,
      );
      if (hit.success) return hit.data;
    }
    const fresh = await this.service.calendars({ accountId });
    await this.cache.putCatalog(accountId, key, fresh);
    return fresh;
  }

  async searchPeople(input: unknown) {
    const parsed = peopleInput.safeParse(input);
    if (!parsed.success) return this.service.searchPeople(input);
    const { accountId, query, page, refresh } = parsed.data;
    const key = JSON.stringify(["people", query, page]);
    if (!refresh) {
      const hit = peopleValue.safeParse(
        (await this.cache.getCatalog(accountId, key))?.value,
      );
      if (hit.success) return hit.data;
    }
    const fresh = await this.service.searchPeople({ accountId, query, page });
    // Nobody found may only mean nobody hired yet; do not hide a new colleague for a day.
    if (fresh.people.length) await this.cache.putCatalog(accountId, key, fresh);
    return fresh;
  }
}

/**
 * What the assistant reads: colleagues and calendars may come from the cache, but
 * meetings always come from Small, because a free slot must be judged on live data.
 */
export function assistantCalendarSource(
  service: Pick<CalendarService, "events"> &
    Partial<Pick<CalendarService, "detail">>,
  catalog: Pick<CachedCatalog, "searchPeople">,
) {
  return {
    events: (input: unknown) => service.events(input),
    ...(service.detail
      ? { detail: (input: unknown) => service.detail!(input) }
      : {}),
    searchPeople: (input: unknown) => catalog.searchPeople(input),
  };
}
