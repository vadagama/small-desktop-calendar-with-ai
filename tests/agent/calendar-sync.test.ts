import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type {
  CalendarChange,
  CalendarEvent,
  CalendarQuery,
  CalendarResult,
} from "../../src/shared/calendar.js";
import { CalendarError } from "../../src/main/calendar.js";
import {
  CalendarSync,
  type CalendarSyncOptions,
} from "../../src/main/calendar-sync.js";
import { EventCache, eventRangeKey } from "../../src/main/event-cache.js";

const query: CalendarQuery = {
  accountId: "a",
  date: "2026-10-29",
  view: "week",
  myCalendar: true,
  calendarIds: [],
};
const event = (key: string, title = "Synthetic meeting"): CalendarEvent => ({
  key,
  lookup: { id: key.slice(6) },
  title,
  startsAt: "2026-10-29T04:00:00Z",
  endsAt: "2026-10-29T05:00:00Z",
  calendarIds: ["7"],
  organizer: "Synthetic organizer",
  description: "",
  location: "",
});
const result = (...events: CalendarEvent[]): CalendarResult => ({
  events,
  issues: [],
});

async function waitFor(condition: () => boolean) {
  for (let index = 0; index < 100; index++) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("Condition was not reached");
}

function setup(options: CalendarSyncOptions = {}) {
  const clock = { time: 1_800_000_000_000 };
  const changes: CalendarChange[] = [];
  const queries: CalendarQuery[] = [];
  const timers: {
    ms: number;
    fired: boolean;
    cancelled: boolean;
    fire: () => void;
  }[] = [];
  const state = {
    handler: async (_query: CalendarQuery): Promise<CalendarResult> =>
      result(event("event:1")),
  };
  const service = {
    events: async (input: unknown) => {
      queries.push(input as CalendarQuery);
      return state.handler(input as CalendarQuery);
    },
  };
  // Memory-only cache: the cipher is unavailable, so nothing touches the disk.
  const cache = new EventCache(
    join(tmpdir(), "calendar-sync-test-" + crypto.randomUUID()),
    {
      isAvailable: async () => false,
      encrypt: async () => Buffer.alloc(0),
      decrypt: async () => ({ result: "", shouldReEncrypt: false }),
    },
    { now: () => clock.time },
  );
  const sync = new CalendarSync(
    service,
    cache,
    (change) => changes.push(change),
    {
      now: () => clock.time,
      schedule: (run, ms) => {
        const timer = {
          ms,
          fired: false,
          cancelled: false,
          fire: () => {
            timer.fired = true;
            run();
          },
        };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
      ...options,
    },
  );
  const pending = () => timers.filter((t) => !t.fired && !t.cancelled);
  const statuses = () =>
    changes.flatMap((c) => (c.type === "status" ? [c.status] : []));
  const pushes = () => changes.filter((c) => c.type === "events");
  return {
    sync,
    cache,
    clock,
    changes,
    queries,
    state,
    pending,
    statuses,
    pushes,
    timers,
  };
}
/** Lets background work that nothing awaits run before asserting that it did not. */
async function settle() {
  for (let index = 0; index < 20; index++)
    await new Promise((resolve) => setImmediate(resolve));
}
const gate = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
};

test("a read goes to Small, fills the cache and is broadcast; allowStale then needs no request", async () => {
  const { sync, clock, queries, pushes } = setup();
  const first = await sync.read(query);
  assert.equal(first.freshness, "fresh");
  assert.equal(first.fetchedAt, clock.time);
  assert.equal(pushes().length, 1);
  clock.time += 5_000;
  const again = await sync.read({ ...query, allowStale: true });
  await settle();
  assert.equal(queries.length, 1);
  assert.equal(again.freshness, "fresh");
  assert.equal(again.fetchedAt, first.fetchedAt);
});

test("an old cache is served at once as stale and revalidated in the background", async () => {
  const { sync, clock, state, pushes, queries } = setup();
  await sync.read(query);
  clock.time += 20_000;
  state.handler = async () => result(event("event:1"), event("event:2"));
  const stale = await sync.read({ ...query, allowStale: true });
  assert.equal(stale.freshness, "stale");
  assert.equal(stale.events.length, 1);
  await waitFor(() => pushes().length === 2);
  const last = pushes().at(-1);
  assert.deepEqual(last?.type === "events" && last.diff.added, ["event:2"]);
  const next = await sync.read({ ...query, allowStale: true });
  assert.equal(next.events.length, 2);
  assert.equal(next.freshness, "fresh");
  assert.equal(queries.length, 2);
});

test("a plain read never answers from the cache and its failure is not hidden", async () => {
  const { sync, cache, state, queries } = setup();
  state.handler = async () => {
    throw new CalendarError("network", "down");
  };
  await assert.rejects(sync.read(query), /down/);
  assert.equal(await cache.getEvents("a", eventRangeKey(query)), null);
  state.handler = async () => result(event("event:1"));
  await sync.read(query);
  state.handler = async () => {
    throw new CalendarError("network", "down");
  };
  await assert.rejects(sync.read(query), /down/);
  assert.equal(queries.length, 3);
});

test("stale data stays visible when Small is unreachable and recovery is announced", async () => {
  const { sync, clock, state, statuses } = setup();
  await sync.read(query);
  clock.time += 20_000;
  state.handler = async () => {
    throw new CalendarError("network", "down");
  };
  const stale = await sync.read({ ...query, allowStale: true });
  assert.equal(stale.events.length, 1);
  await waitFor(() => statuses().includes("offline"));
  state.handler = async () => result(event("event:1"));
  await sync.poll();
  assert.deepEqual(statuses(), ["offline", "online"]);
});

test("the poll timer revalidates the visible range every minute", async () => {
  const { sync, pending, queries } = setup();
  await sync.read(query);
  assert.equal(pending().length, 1);
  assert.equal(pending()[0]?.ms, 60_000);
  pending()[0]!.fire();
  await waitFor(() => queries.length === 2);
  await waitFor(() => pending().length === 1);
  assert.equal(pending()[0]?.ms, 60_000);
});

test("polling follows the latest range only", async () => {
  const { sync, queries } = setup();
  await sync.read(query);
  await sync.read({ ...query, date: "2026-11-05" });
  await sync.poll();
  assert.equal(queries.at(-1)?.date, "2026-11-05");
  assert.equal(queries.length, 3);
});

test("a hidden window is not polled and an offline machine is reported once", async () => {
  let visible = false;
  let online = true;
  const { sync, queries, statuses, pending } = setup({
    visible: () => visible,
    online: () => online,
  });
  await sync.read(query);
  await sync.poll();
  assert.equal(queries.length, 1);
  assert.equal(pending().length, 1);
  visible = true;
  online = false;
  await sync.poll();
  await sync.poll();
  assert.equal(queries.length, 1);
  assert.deepEqual(statuses(), ["offline"]);
  online = true;
  await sync.poll();
  assert.equal(queries.length, 2);
  assert.deepEqual(statuses(), ["offline", "online"]);
});

test("failures back off exponentially up to ten minutes and success resets the delay", async () => {
  const { sync, state, pending } = setup();
  await sync.read(query);
  state.handler = async () => {
    throw new CalendarError("network", "down");
  };
  const delays: number[] = [];
  for (let index = 0; index < 5; index++) {
    const timer = pending()[0]!;
    timer.fire();
    await waitFor(() => pending().length === 1 && pending()[0] !== timer);
    delays.push(pending()[0]!.ms);
  }
  assert.deepEqual(delays, [120_000, 240_000, 480_000, 600_000, 600_000]);
  state.handler = async () => result(event("event:1"));
  const timer = pending()[0]!;
  timer.fire();
  await waitFor(() => pending().length === 1 && pending()[0] !== timer);
  assert.equal(pending()[0]?.ms, 60_000);
});

test("an expired session stops polling until the next successful read", async () => {
  const { sync, state, queries, statuses, pending } = setup();
  await sync.read(query);
  state.handler = async () => {
    throw new CalendarError("auth", "expired");
  };
  await sync.poll();
  assert.deepEqual(statuses(), ["auth-expired"]);
  const calls = queries.length;
  await sync.poll();
  sync.wake();
  assert.equal(queries.length, calls);
  state.handler = async () => result(event("event:1"));
  await sync.read(query);
  assert.equal(pending().length >= 1, true);
  await sync.poll();
  assert.equal(queries.length, calls + 2);
});

test("concurrent reads of one range share a single request", async () => {
  const { sync, state, queries } = setup();
  const held = gate<CalendarResult>();
  state.handler = () => held.promise;
  const reads = [sync.read(query), sync.read(query)];
  await waitFor(() => queries.length === 1);
  held.resolve(result(event("event:1")));
  const [a, b] = await Promise.all(reads);
  assert.equal(queries.length, 1);
  assert.deepEqual(a, b);
});

test("reset forgets the account: cache, timer, range and a request still in flight", async () => {
  const { sync, cache, state, pending, queries, pushes } = setup();
  await sync.read(query);
  assert.equal(pushes().length, 1);
  const held = gate<CalendarResult>();
  state.handler = () => held.promise;
  const key = eventRangeKey(query);
  const inFlight = sync.read(query);
  await waitFor(() => queries.length === 2);
  await sync.reset();
  held.resolve(result(event("event:9")));
  assert.equal((await inFlight).events[0]?.key, "event:9");
  assert.equal(await cache.getEvents("a", key), null);
  assert.equal(pushes().length, 1);
  assert.equal(pending().length, 0);
  await sync.poll();
  assert.equal(queries.length, 2);
});

test("invalidate drops the cache and late answers but keeps polling", async () => {
  const { sync, cache, state, pending, queries, pushes } = setup();
  await sync.read(query);
  await sync.invalidate();
  assert.equal(await cache.getEvents("a", eventRangeKey(query)), null);
  assert.equal(pending().length, 1);
  const held = gate<CalendarResult>();
  state.handler = () => held.promise;
  const inFlight = sync.read(query);
  await waitFor(() => queries.length === 2);
  await sync.invalidate();
  held.resolve(result(event("event:1")));
  await inFlight;
  assert.equal(await cache.getEvents("a", eventRangeKey(query)), null);
  assert.equal(pushes().length, 1);
});

test("a partial answer is returned but neither cached nor reported as removals", async () => {
  const { sync, cache, state, pushes } = setup();
  state.handler = async () => result(event("event:1"), event("event:2"));
  await sync.read(query);
  state.handler = async () => ({
    events: [event("event:1")],
    issues: [{ source: "7", kind: "network", message: "partial" }],
  });
  const partial = await sync.read(query);
  assert.equal(partial.issues.length, 1);
  assert.equal(
    (await cache.getEvents("a", eventRangeKey(query)))?.events.length,
    2,
  );
  const last = pushes().at(-1);
  assert.deepEqual(last?.type === "events" && last.diff.removed, []);
});

test("the push carries added, removed, changed and moved events", async () => {
  const { sync, state, pushes } = setup();
  state.handler = async () =>
    result(event("event:1"), event("event:2"), event("event:3"));
  await sync.read(query);
  state.handler = async () =>
    result(
      { ...event("event:1"), startsAt: "2026-10-29T06:00:00Z" },
      event("event:2", "Renamed"),
      event("event:4"),
    );
  await sync.read(query);
  const last = pushes().at(-1);
  assert.deepEqual(last?.type === "events" && last.diff, {
    added: ["event:4"],
    removed: ["event:3"],
    changed: ["event:2"],
    moved: ["event:1"],
  });
});

test("wake catches up only when the data is older than the poll period", async () => {
  const { sync, clock, queries } = setup();
  await sync.read(query);
  sync.wake();
  await settle();
  assert.equal(queries.length, 1);
  clock.time += 61_000;
  sync.wake();
  await waitFor(() => queries.length === 2);
});

test("malformed requests are rejected before any network call", async () => {
  const { sync, queries } = setup();
  for (const bad of [
    { ...query, allowStale: "yes" },
    { ...query, extra: true },
    { date: "2026-10-29" },
    null,
  ])
    await assert.rejects(sync.read(bad), CalendarError);
  assert.equal(queries.length, 0);
});

test("a targeted invalidation keeps the ranges the write cannot have touched", async () => {
  const { sync, cache, state } = setup();
  const next = { ...query, date: "2026-11-05" };
  state.handler = async (asked) =>
    result(event(asked.date === query.date ? "event:1" : "event:2"));
  await sync.read(query);
  await sync.read(next);
  await sync.invalidate({
    accountId: "a",
    eventIds: ["1"],
    windows: [{ start: "2026-10-29T04:00:00Z", end: "2026-10-29T04:30:00Z" }],
  });
  assert.equal(await cache.getEvents("a", eventRangeKey(query)), null);
  assert.ok(await cache.getEvents("a", eventRangeKey(next)));
  // Without a description of the write nothing can be assumed.
  await sync.invalidate();
  assert.equal(await cache.getEvents("a", eventRangeKey(next)), null);
});

test("a background renewal that comes back partial keeps the complete data and reports lost contact", async () => {
  const { sync, cache, state, statuses, pushes } = setup();
  state.handler = async () => result(event("event:1"), event("event:2"));
  await sync.read(query);
  const before = pushes().length;
  state.handler = async () => ({
    events: [],
    issues: [{ source: "my", kind: "network", message: "down" }],
  });
  await sync.poll();
  // Nothing partial reaches the screen, and the cached complete copy stays.
  assert.equal(pushes().length, before);
  assert.deepEqual(statuses(), ["offline"]);
  assert.equal(
    (await cache.getEvents("a", eventRangeKey(query)))?.events.length,
    2,
  );
  // Recovery: a complete answer again is announced.
  state.handler = async () => result(event("event:1"), event("event:2"));
  await sync.poll();
  assert.deepEqual(statuses(), ["offline", "online"]);
  assert.equal(pushes().length, before + 1);
});

test("the user's own request still shows a partial answer, background or not cached", async () => {
  const { sync, state, pushes } = setup();
  state.handler = async () => result(event("event:1"), event("event:2"));
  await sync.read(query);
  const partial = {
    events: [event("event:1")],
    issues: [{ source: "7", kind: "denied" as const, message: "no access" }],
  };
  state.handler = async () => partial;
  const answered = await sync.read(query);
  assert.equal(answered.issues.length, 1);
  assert.equal(answered.events.length, 1);
  const last = pushes().at(-1);
  assert.equal(last?.type === "events" && last.result.issues.length, 1);
});
