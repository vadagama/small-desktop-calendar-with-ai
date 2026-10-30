import assert from "node:assert/strict";
import { test } from "node:test";
import { readEventList } from "../../src/main/event-list.js";
import type { CalendarEvent } from "../../src/shared/calendar.js";
const event: CalendarEvent = {
  key: "event:a",
  lookup: { id: "a" },
  title: "Демо",
  startsAt: "2026-10-05T09:00:00+05:00",
  endsAt: "2026-10-05T10:00:00+05:00",
  organizer: "Жанна",
  organizerId: "zhanna",
  calendarIds: [],
  description: "",
  location: "",
};
const query = {
  from: "2026-10-01",
  to: "2026-10-31",
  scope: "all-accessible",
  organizerId: "zhanna",
};
test("event search filters by creator ID, deduplicates sources and keeps completeness", async () => {
  const result = await readEventList(
    "account",
    query,
    {
      calendars: async () => [{ id: "team", name: "Team" }],
      events: async () => ({
        events: [
          event,
          {
            ...event,
            key: "event:b",
            lookup: { id: "b" },
            organizerId: "other",
            participants: [
              {
                id: "zhanna",
                name: "Жанна",
                status: "accepted",
                organizer: false,
              },
            ],
          },
        ],
        issues: [],
      }),
    },
    new AbortController().signal,
  );
  assert.deepEqual(
    result.events.map((e) => e.key),
    ["event:a"],
  );
  assert.equal(result.complete, true);
});
test("unknown organizer metadata and failed sources never mean a complete empty result", async () => {
  const { organizerId: _, ...unknown } = event;
  const result = await readEventList(
    "account",
    { ...query, scope: "my" },
    {
      events: async () => ({
        events: [unknown],
        issues: [{ source: "my", kind: "denied", message: "No access" }],
      }),
    },
    new AbortController().signal,
  );
  assert.equal(result.complete, false);
  assert.equal(result.events.length, 0);
  assert.ok(result.issues.length);
});
test("invalid ranges are rejected before I/O and cancellation stops reads", async () => {
  let calls = 0;
  const source = {
    events: async () => {
      calls++;
      return { events: [], issues: [] };
    },
  };
  await assert.rejects(() =>
    readEventList(
      "account",
      { ...query, to: "2028-01-01" },
      source,
      new AbortController().signal,
    ),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() =>
    readEventList(
      "account",
      { ...query, scope: "my" },
      source,
      controller.signal,
    ),
  );
  assert.equal(calls, 0);
});

test("search tool requires observed organizer and waits a turn for ambiguity", async () => {
  const { createCalendarToolExecutor } =
    await import("../../src/main/calendar-tools.js");
  const { CalendarConversation } =
    await import("../../src/main/calendar-conversation.js");
  const conversation = new CalendarConversation();
  const calendar = {
    events: async () => ({ events: [event], issues: [] }),
    searchPeople: async () => ({
      people: [
        { participantId: "zhanna", name: "Жанна", position: "A" },
        { participantId: "other", name: "Жанна", position: "B" },
      ],
      page: 1,
      nextPage: null,
    }),
  };
  const execute = () =>
    createCalendarToolExecutor(
      "account",
      "Жанна из A",
      new AbortController().signal,
      calendar,
      {
        find: async () => {
          throw Error("unexpected write");
        },
      },
      "owner",
      undefined,
      conversation,
    );
  const first = execute();
  assert.equal(
    (await first("showEventList", { ...query, scope: "my" })).ok,
    false,
  );
  await first("searchPeople", { query: "Жанна", page: 1 });
  assert.equal(
    (await first("showEventList", { ...query, scope: "my" })).ok,
    false,
  );
  const reply = await execute()("showEventList", { ...query, scope: "my" });
  assert.equal(reply.ok, true);
  if (reply.ok && "kind" in reply.data && reply.data.kind === "event-list")
    assert.equal(reply.data.organizer?.participantId, "zhanna");
});

test("large catalog is bounded and reports incomplete results", async () => {
  let reads = 0;
  const result = await readEventList(
    "account",
    query,
    {
      calendars: async () =>
        Array.from({ length: 100 }, (_, i) => ({
          id: String(i),
          name: String(i),
        })),
      events: async () => {
        reads++;
        return { events: [], issues: [] };
      },
    },
    new AbortController().signal,
  );
  assert.equal(reads, 96);
  assert.equal(result.complete, false);
});

test("one list row per overnight event, clamped to first visible day", async () => {
  const { eventListMeetings } =
    await import("../../src/renderer/event-list-meetings.js");
  const rows = eventListMeetings(
    [
      {
        ...event,
        startsAt: "2026-09-30T23:00:00+05:00",
        endsAt: "2026-10-02T01:00:00+05:00",
      },
    ],
    "2026-10-01",
    "2026-10-31",
    [],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.date, "2026-10-01");
  assert.match(rows[0]!.timeLabel!, /23:00/);
  assert.match(rows[0]!.timeLabel!, /01:00/);
});
