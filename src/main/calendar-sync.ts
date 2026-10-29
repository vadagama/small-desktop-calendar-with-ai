import type {
  CalendarChange,
  CalendarQuery,
  CalendarResult,
} from "../shared/calendar.js";
import { diffEvents } from "../shared/calendar-diff.js";
import {
  CalendarError,
  parseCalendarQuery,
  type CalendarService,
} from "./calendar.js";
import { eventRangeKey, type EventCache } from "./event-cache.js";
import type { EventInvalidation } from "../shared/calendar-invalidation.js";

export interface CalendarSyncOptions {
  now?: () => number;
  /** Background poll period for the visible range. */
  intervalMs?: number;
  /** A cached range confirmed this recently is served without revalidation. */
  freshMs?: number;
  maxBackoffMs?: number;
  /** `false` is a strong signal of no connection (Electron net.isOnline). */
  online?: () => boolean;
  /** Polling is skipped while the window is hidden or minimized. */
  visible?: () => boolean;
  schedule?: (run: () => void, ms: number) => () => void;
}

const isAuthError = (error: unknown) =>
  (error instanceof CalendarError && error.kind === "auth") ||
  (typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "auth");

function splitReadQuery(input: unknown) {
  if (!input || typeof input !== "object" || !("allowStale" in input))
    return { allowStale: false, query: parseCalendarQuery(input) };
  const { allowStale, ...rest } = input as Record<string, unknown>;
  if (typeof allowStale !== "boolean")
    throw new CalendarError("invalid", "Некорректный запрос календаря.");
  return { allowStale, query: parseCalendarQuery(rest) };
}

/**
 * Stale-while-revalidate layer between the renderer and `CalendarService.events`.
 * Every confirmed fetch updates the cache and is broadcast through `emit`; polling
 * revalidates only the range the user is looking at. Ordinary reads still go to
 * Small unless the caller opts into `allowStale`. Assistant tools keep calling
 * `CalendarService` directly and never see the cache.
 */
export class CalendarSync {
  private active: { query: CalendarQuery; key: string } | null = null;
  private inflight = new Map<string, Promise<CalendarResult>>();
  private generation = 0;
  private failures = 0;
  private reachable = true;
  private authExpired = false;
  private lastFetchAt = 0;
  private cancelTimer: (() => void) | null = null;
  private now: () => number;
  private intervalMs: number;
  private freshMs: number;
  private maxBackoffMs: number;
  private online: () => boolean;
  private visible: () => boolean;
  private schedule: (run: () => void, ms: number) => () => void;
  constructor(
    private events: Pick<CalendarService, "events">,
    private cache: EventCache,
    private emit: (change: CalendarChange) => void,
    options: CalendarSyncOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.intervalMs = options.intervalMs ?? 60_000;
    this.freshMs = options.freshMs ?? 15_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 10 * 60_000;
    this.online = options.online ?? (() => true);
    this.visible = options.visible ?? (() => true);
    this.schedule =
      options.schedule ??
      ((run, ms) => {
        const timer = setTimeout(run, ms);
        timer.unref?.();
        return () => clearTimeout(timer);
      });
  }

  async read(input: unknown): Promise<CalendarResult> {
    const { allowStale, query } = splitReadQuery(input);
    const key = eventRangeKey(query);
    this.active = { query, key };
    this.arm();
    if (allowStale) {
      const cached = await this.cache.getEvents(query.accountId, key);
      if (cached) {
        const age = this.now() - cached.fetchedAt;
        if (age >= this.freshMs) void this.refresh(query, key);
        return {
          events: cached.events,
          issues: cached.issues,
          fetchedAt: cached.fetchedAt,
          freshness: age < this.freshMs ? "fresh" : "stale",
        };
      }
    }
    try {
      const result = await this.load(query, key);
      this.succeeded();
      return result;
    } catch (error) {
      if (isAuthError(error)) this.authExpired = true;
      throw error;
    }
  }

  /** One background revalidation of the visible range; the poll timer calls this. */
  async poll() {
    const target = this.active;
    if (!target || this.authExpired) return;
    if (!this.visible()) return this.arm();
    if (!this.online()) {
      this.markOffline();
      return this.arm();
    }
    await this.refresh(target.query, target.key);
    if (!this.authExpired) this.arm();
  }

  /** The window came back (focus, show, restore): catch up if the data is old. */
  wake() {
    if (!this.active || this.authExpired) return;
    if (this.now() - this.lastFetchAt < this.intervalMs) return;
    this.cancelTimer?.();
    this.cancelTimer = null;
    void this.poll();
  }

  /** Sign-in or sign-out: forget the account, its range and every cached byte. */
  async reset() {
    this.stop();
    this.active = null;
    this.authExpired = false;
    this.failures = 0;
    this.reachable = true;
    await this.cache.clearAll();
  }

  /**
   * After a write attempt Small's state may differ from the cache; polling continues.
   * With a target only the ranges it may have touched are dropped, without one (the
   * write could not be described) everything is.
   */
  async invalidate(target?: EventInvalidation & { accountId: string }) {
    this.generation++;
    this.inflight.clear();
    if (target) await this.cache.invalidateEvents(target.accountId, target);
    else await this.cache.clearAll();
  }

  stop() {
    this.generation++;
    this.inflight.clear();
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  private load(
    query: CalendarQuery,
    key: string,
    background = false,
  ): Promise<CalendarResult> {
    // A background renewal judges its answer differently, so it must not share a request.
    const id =
      query.accountId + "\0" + key + (background ? "\0background" : "");
    const running = this.inflight.get(id);
    if (running) return running;
    const work: Promise<CalendarResult> = this.fetch(
      query,
      key,
      this.generation,
      background,
    ).finally(() => {
      if (this.inflight.get(id) === work) this.inflight.delete(id);
    });
    this.inflight.set(id, work);
    return work;
  }

  private async fetch(
    query: CalendarQuery,
    key: string,
    generation: number,
    background: boolean,
  ): Promise<CalendarResult> {
    const previous = await this.cache.getEvents(query.accountId, key);
    const result = await this.events.events(query);
    // Small answered only in part (one source failed). In the background that must not
    // replace a complete copy or claim a fresh confirmation: it counts as lost contact.
    // The user's own request still shows the partial answer as it is.
    if (background && previous && result.issues.length)
      throw new CalendarError("network", "Small ответил неполно.");
    const confirmed: CalendarResult = {
      ...result,
      fetchedAt: this.now(),
      freshness: "fresh",
    };
    // A reset or write attempt while the request was in flight makes it untrustworthy
    // for the cache and for other windows; its caller still gets the answer.
    if (generation === this.generation) {
      this.lastFetchAt = confirmed.fetchedAt!;
      await this.cache.putEvents(query.accountId, key, result);
      // A partial result must not look like removals.
      const base =
        previous && !result.issues.length ? previous.events : result.events;
      this.emit({
        type: "events",
        query,
        result: confirmed,
        diff: diffEvents(base, result.events),
      });
    }
    return confirmed;
  }

  private async refresh(query: CalendarQuery, key: string) {
    const generation = this.generation;
    try {
      await this.load(query, key, true);
      if (generation === this.generation) this.succeeded();
    } catch (error) {
      if (generation !== this.generation) return;
      if (isAuthError(error)) {
        this.authExpired = true;
        this.emit({ type: "status", status: "auth-expired" });
        return;
      }
      this.failures++;
      this.markOffline();
    }
  }

  private succeeded() {
    this.failures = 0;
    this.authExpired = false;
    if (!this.reachable) {
      this.reachable = true;
      this.emit({ type: "status", status: "online" });
    }
  }

  private markOffline() {
    if (!this.reachable) return;
    this.reachable = false;
    this.emit({ type: "status", status: "offline" });
  }

  private arm() {
    if (this.cancelTimer) return;
    const wait = this.failures
      ? Math.min(this.intervalMs * 2 ** this.failures, this.maxBackoffMs)
      : this.intervalMs;
    this.cancelTimer = this.schedule(() => {
      this.cancelTimer = null;
      void this.poll();
    }, wait);
  }
}
