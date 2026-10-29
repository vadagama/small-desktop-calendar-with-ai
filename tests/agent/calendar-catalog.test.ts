import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CalendarError } from "../../src/main/calendar.js";
import {
  CachedCatalog,
  assistantCalendarSource,
} from "../../src/main/calendar-catalog.js";
import { EventCache } from "../../src/main/event-cache.js";

const DAY = 24 * 60 * 60 * 1000;
const person = (id: string) => ({
  participantId: id,
  name: "Тестовый " + id,
  position: "Тест",
});

function setup() {
  const clock = { time: 1_800_000_000_000 };
  const calls: { calendars: unknown[]; people: unknown[] } = {
    calendars: [],
    people: [],
  };
  const state = {
    calendars: [{ id: "1", name: "Переговорная" }],
    people: [person("a")],
    fail: false,
  };
  const service = {
    calendars: async (input: unknown) => {
      calls.calendars.push(input);
      if (state.fail) throw new CalendarError("network", "down");
      if (JSON.stringify(Object.keys(input as object)) !== '["accountId"]')
        throw new CalendarError("invalid", "unexpected input");
      return structuredClone(state.calendars);
    },
    searchPeople: async (input: unknown) => {
      calls.people.push(input);
      if (state.fail) throw new CalendarError("network", "down");
      return { people: structuredClone(state.people), page: 1, nextPage: null };
    },
  };
  // Memory-only cache: the cipher is unavailable, so nothing touches the disk.
  const cache = new EventCache(
    join(tmpdir(), "catalog-test-" + crypto.randomUUID()),
    {
      isAvailable: async () => false,
      encrypt: async () => Buffer.alloc(0),
      decrypt: async () => ({ result: "", shouldReEncrypt: false }),
    },
    { now: () => clock.time },
  );
  return {
    catalog: new CachedCatalog(service, cache),
    cache,
    clock,
    calls,
    state,
  };
}

test("the calendar list is read once a day and per account; refresh always asks Small", async () => {
  const { catalog, clock, calls, state } = setup();
  const first = await catalog.calendars({ accountId: "a" });
  assert.deepEqual(first, state.calendars);
  await catalog.calendars({ accountId: "a" });
  assert.equal(calls.calendars.length, 1);
  await catalog.calendars({ accountId: "b" });
  assert.equal(calls.calendars.length, 2);
  // refresh reaches Small, without the flag it would have been rejected as unexpected.
  state.calendars = [{ id: "2", name: "Новая" }];
  assert.deepEqual(await catalog.calendars({ accountId: "a", refresh: true }), [
    { id: "2", name: "Новая" },
  ]);
  assert.equal(calls.calendars.length, 3);
  assert.deepEqual(await catalog.calendars({ accountId: "a" }), [
    { id: "2", name: "Новая" },
  ]);
  assert.equal(calls.calendars.length, 3);
  clock.time += DAY + 1000;
  await catalog.calendars({ accountId: "a" });
  assert.equal(calls.calendars.length, 4);
});

test("people search is cached per trimmed query and page, never when nobody is found", async () => {
  const { catalog, calls, state } = setup();
  await catalog.searchPeople({ accountId: "a", query: "Тест", page: 1 });
  await catalog.searchPeople({ accountId: "a", query: "  Тест  ", page: 1 });
  assert.equal(calls.people.length, 1);
  await catalog.searchPeople({ accountId: "a", query: "Тест", page: 2 });
  await catalog.searchPeople({ accountId: "a", query: "Другой", page: 1 });
  await catalog.searchPeople({ accountId: "b", query: "Тест", page: 1 });
  assert.equal(calls.people.length, 4);
  state.people = [];
  await catalog.searchPeople({ accountId: "a", query: "Никого", page: 1 });
  await catalog.searchPeople({ accountId: "a", query: "Никого", page: 1 });
  assert.equal(calls.people.length, 6);
  // The service gets the query as the user typed it, without the cache's own flag.
  assert.deepEqual(calls.people[0], { accountId: "a", query: "Тест", page: 1 });
});

test("people refresh bypasses the cache and replaces the entry", async () => {
  const { catalog, calls, state } = setup();
  const ask = (refresh?: boolean) =>
    catalog.searchPeople({
      accountId: "a",
      query: "Тест",
      page: 1,
      ...(refresh ? { refresh } : {}),
    });
  await ask();
  state.people = [person("b")];
  assert.equal((await ask(true)).people[0]?.participantId, "b");
  assert.equal((await ask()).people[0]?.participantId, "b");
  assert.equal(calls.people.length, 2);
});

test("invalid input goes to the service untouched and nothing is cached", async () => {
  const { catalog, cache, calls } = setup();
  for (const bad of [
    null,
    {},
    { accountId: "a", extra: true },
    { accountId: "a", query: "", page: 1 },
  ])
    await catalog.searchPeople(bad);
  assert.equal(calls.people.length, 4);
  await catalog.calendars({ accountId: "a", extra: 1 }).catch(() => {});
  assert.equal(await cache.getCatalog("a", "calendars"), null);
});

test("a failure is not cached and a damaged cache entry is only a miss", async () => {
  const { catalog, cache, calls, state } = setup();
  state.fail = true;
  await assert.rejects(catalog.calendars({ accountId: "a" }), /down/);
  state.fail = false;
  await catalog.calendars({ accountId: "a" });
  assert.equal(calls.calendars.length, 2);
  await cache.putCatalog("a", "calendars", { not: "a list" });
  assert.deepEqual(
    await catalog.calendars({ accountId: "a" }),
    state.calendars,
  );
  assert.equal(calls.calendars.length, 3);
  await cache.putCatalog("a", JSON.stringify(["people", "Тест", 1]), [1, 2]);
  await catalog.searchPeople({ accountId: "a", query: "Тест", page: 1 });
  assert.equal(calls.people.length, 1);
});

test("clearing the cache (sign-in or sign-out) forgets both catalogs", async () => {
  const { catalog, cache, calls } = setup();
  await catalog.calendars({ accountId: "a" });
  await catalog.searchPeople({ accountId: "a", query: "Тест", page: 1 });
  await cache.clearAll();
  await catalog.calendars({ accountId: "a" });
  await catalog.searchPeople({ accountId: "a", query: "Тест", page: 1 });
  assert.deepEqual([calls.calendars.length, calls.people.length], [2, 2]);
});

test("the assistant reads colleagues from the cache but meetings always from Small", async () => {
  const { catalog, cache, calls } = setup();
  let eventCalls = 0;
  const source = assistantCalendarSource(
    {
      events: async () => {
        eventCalls++;
        return { events: [], issues: [] };
      },
    },
    catalog,
  );
  await source.searchPeople({ accountId: "a", query: "Тест", page: 1 });
  await source.searchPeople({ accountId: "a", query: "Тест", page: 1 });
  assert.equal(calls.people.length, 1);
  // Even with a fresh cached copy of the same range, the assistant still asks Small.
  await cache.putEvents("a", "range", { events: [], issues: [] });
  await source.events({ accountId: "a" });
  await source.events({ accountId: "a" });
  assert.equal(eventCalls, 2);
});
