import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SmallSeriesBackend,
  seriesIdOf,
  type SeriesSession,
} from "../../src/main/series-backend.js";
import { SmallAuthError } from "../../src/main/small-auth.js";
import type { CalendarEvent } from "../../src/shared/calendar.js";
import { occurrenceAliases } from "../../src/shared/occurrence-key.js";
import { legacyOccurrenceKey } from "../../src/shared/series-scope.js";

const event = (
  patch: Partial<CalendarEvent> & { key: string },
): CalendarEvent => ({
  lookup: { id: "1" },
  title: "Планёрка",
  startsAt: "2026-11-05T05:00:00Z",
  endsAt: "2026-11-05T06:00:00Z",
  calendarIds: [],
  organizer: "Анна",
  location: "",
  description: "",
  participants: [
    { id: "person-me", name: "Я", status: "accepted", organizer: true },
  ],
  ...patch,
});
const virtual = (date: string, series = "43") =>
  event({
    key: `series:${series}:${Date.parse(`${date}T05:00:00Z`)}`,
    lookup: { originalEventId: series, date },
    originalEventId: series,
    recurring: true,
    startsAt: `${date}T05:00:00Z`,
    endsAt: `${date}T06:00:00Z`,
  });
const withoutParticipants = (e: CalendarEvent): CalendarEvent => {
  const { participants: _omitted, ...rest } = e;
  return rest;
};
const calendarWith = (
  events: CalendarEvent[],
  issues: { source: string; kind: "network"; message: string }[] = [],
) => ({
  events: async () => ({ events, issues }),
});
const card = (patch: Record<string, unknown> = {}) => ({
  data: {
    id: null,
    original_event_id: 43,
    creator_id: "person-me",
    title: "Планёрка",
    description: null,
    location: null,
    starts_at: "2026-11-05T10:00:00+05:00",
    ends_at: "2026-11-05T11:00:00+05:00",
    timezone: "Asia/Almaty",
    is_recurring: true,
    recurrence_rule: { FREQ: "WEEKLY", BYDAY: ["TH"], UNTIL: "2026-12-31" },
    is_public: false,
    calendar_ids: [7],
    participants: [{ id: "p1" }],
    notification_recipients: [{ id: "p3" }],
    attachments: [{ id: "f1" }],
    ...patch,
  },
});
function session(overrides: Partial<SeriesSession> = {}) {
  const paths: string[] = [];
  const writes: { kind: string; args: unknown[] }[] = [];
  let response: unknown = card();
  const value: SeriesSession = {
    readCalendar: async (_account, action) =>
      action(async (path) => {
        paths.push(path);
        return Response.json(response);
      }, "person-me"),
    materializeCalendarEvent: async (...args) => {
      writes.push({ kind: "materialize", args });
      return Response.json({ data: { id: 901 } });
    },
    updateSeriesCalendarEvent: async (...args) => {
      writes.push({ kind: "update", args });
      return new Response(null, { status: 200 });
    },
    cancelCalendarEvent: async (...args) => {
      writes.push({ kind: "cancel", args });
      return new Response(null, { status: 200 });
    },
    ...overrides,
  };
  return { value, paths, writes, respond: (v: unknown) => (response = v) };
}

test("series membership: the original_event_id, or the id of the recurring template", () => {
  assert.equal(seriesIdOf(virtual("2026-11-05")), "43");
  assert.equal(
    seriesIdOf(
      event({ key: "event:43", lookup: { id: "43" }, recurring: true }),
    ),
    "43",
  );
  assert.equal(
    seriesIdOf(event({ key: "event:9", lookup: { id: "9" } })),
    null,
  );
  assert.equal(
    seriesIdOf(
      event({ key: "event:9", lookup: { id: "9" }, recurring: false }),
    ),
    null,
  );
});

test("the window keeps only the series, keys occurrences by original date and flags incomplete reads", async () => {
  const own = event({
    key: "event:900",
    lookup: { id: "900" },
    originalEventId: "43",
    recurring: true,
    startsAt: "2026-11-12T05:00:00Z",
    endsAt: "2026-11-12T06:00:00Z",
  });
  const template = event({
    key: "event:43",
    lookup: { id: "43" },
    recurring: true,
    startsAt: "2026-11-19T05:00:00Z",
    endsAt: "2026-11-19T06:00:00Z",
  });
  const other = virtual("2026-11-05", "77");
  const plain = event({ key: "event:5", lookup: { id: "5" } });
  const backend = new SmallSeriesBackend(
    session().value,
    calendarWith([virtual("2026-11-05"), own, template, other, plain]),
  );
  const { views, complete } = await backend.window(
    "acc",
    "43",
    "2026-10-29",
    "2026-11-30",
  );
  assert.equal(complete, true);
  assert.deepEqual(
    views.map((v) => [v.key, v.eventId ?? null, v.organizerId]),
    [
      ["series:43:2026-11-05", null, "person-me"],
      ["series:43:2026-11-12", "900", "person-me"],
      ["series:43:2026-11-19", "43", "person-me"],
    ],
  );
  const partial = await new SmallSeriesBackend(
    session().value,
    calendarWith(
      [virtual("2026-11-05")],
      [{ source: "my", kind: "network", message: "x" }],
    ),
  ).window("acc", "43", "2026-10-29", "2026-11-30");
  assert.equal(partial.complete, false);
});

test("an unknown organizer stays empty so the write is refused", async () => {
  const noOrganizer = {
    ...virtual("2026-11-05"),
    participants: [
      { id: "x", name: "X", status: "accepted", organizer: false },
    ],
  };
  const { views } = await new SmallSeriesBackend(
    session().value,
    calendarWith([noOrganizer]),
  ).window("acc", "43", "2026-10-29", "2026-11-30");
  assert.equal(views[0]!.organizerId, "");
  const { views: none } = await new SmallSeriesBackend(
    session().value,
    calendarWith([withoutParticipants(virtual("2026-11-05"))]),
  ).window("acc", "43", "2026-10-29", "2026-11-30");
  assert.equal(none[0]!.organizerId, "");
});

test("a virtual card is read with GET generated, a materialized one by id, both without writing", async () => {
  const s = session();
  const backend = new SmallSeriesBackend(s.value, calendarWith([]));
  const virtualCard = await backend.card("acc", {
    seriesId: "43",
    originalDate: "2026-11-05",
  });
  assert.equal(
    s.paths[0],
    "/gate/team/api/calendar/events/generated?original_event_id=43&date=2026-11-05",
  );
  assert.deepEqual(
    [virtualCard?.description, virtualCard?.location, virtualCard?.eventId],
    ["", "", undefined],
  );
  assert.deepEqual(virtualCard?.participantIds, ["p1"]);
  assert.deepEqual(virtualCard?.calendarIds, [7]);
  s.respond(card({ id: 900 }));
  const own = await backend.card("acc", {
    seriesId: "43",
    originalDate: "2026-11-05",
    eventId: "900",
  });
  assert.equal(s.paths[1], "/gate/team/api/calendar/events/900");
  assert.equal(own?.eventId, "900");
  assert.deepEqual(s.writes, []);
});

test("an incomplete, foreign or non-recurring card is never returned", async () => {
  const ref = { seriesId: "43", originalDate: "2026-11-05" };
  const cases: [string, Record<string, unknown> | null][] = [
    ["no timezone", card({ timezone: "" })],
    ["no recurrence rule", card({ recurrence_rule: undefined })],
    ["no attachments", card({ attachments: undefined })],
    ["no creator", card({ creator_id: undefined })],
    ["not recurring", card({ is_recurring: false })],
    ["another series", card({ original_event_id: 44 })],
    ["garbage", { data: "x" }],
  ];
  for (const [name, response] of cases) {
    const s = session();
    s.respond(response);
    assert.equal(
      await new SmallSeriesBackend(s.value, calendarWith([])).card("acc", ref),
      null,
      name,
    );
  }
  const s = session();
  s.respond(card({ id: 901 }));
  assert.equal(
    await new SmallSeriesBackend(s.value, calendarWith([])).card("acc", {
      ...ref,
      eventId: "900",
    }),
    null,
  );
});

test("writes go through the session methods and statuses pass through", async () => {
  const s = session();
  const backend = new SmallSeriesBackend(s.value, calendarWith([]));
  assert.deepEqual(await backend.materialize("acc", "43", "2026-11-05"), {
    status: 200,
    eventId: "901",
  });
  assert.deepEqual(await backend.cancel("acc", "901", "причина"), {
    status: 200,
  });
  assert.deepEqual(
    s.writes.map((w) => w.kind),
    ["materialize", "cancel"],
  );
  assert.deepEqual(s.writes[0]!.args, ["acc", "43", "2026-11-05"]);
  const rejected = new SmallSeriesBackend(
    session({
      materializeCalendarEvent: async () => new Response(null, { status: 422 }),
    }).value,
    calendarWith([]),
  );
  assert.deepEqual(await rejected.materialize("acc", "43", "2026-11-05"), {
    status: 422,
  });
  const unreadable = new SmallSeriesBackend(
    session({
      materializeCalendarEvent: async () =>
        new Response("not json", { status: 200 }),
    }).value,
    calendarWith([]),
  );
  assert.deepEqual(await unreadable.materialize("acc", "43", "2026-11-05"), {
    status: 200,
  });
});

test("a local refusal is reported as never sent, while a network failure stays unknown", async () => {
  const refuse = async () => {
    throw new SmallAuthError("Операция Small недоступна.");
  };
  const backend = new SmallSeriesBackend(
    session({
      materializeCalendarEvent: refuse,
      updateSeriesCalendarEvent: refuse,
      cancelCalendarEvent: refuse,
    }).value,
    calendarWith([]),
  );
  const notSent = { status: 0, notSent: true };
  assert.deepEqual(
    await backend.materialize("acc", "43", "2026-11-05"),
    notSent,
  );
  assert.deepEqual(await backend.cancel("acc", "900", "r"), notSent);
  assert.deepEqual(await backend.update("acc", "900", {} as never), notSent);
  const offline = async () => {
    throw new Error("network");
  };
  const failing = new SmallSeriesBackend(
    session({ cancelCalendarEvent: offline, materializeCalendarEvent: offline })
      .value,
    calendarWith([]),
  );
  await assert.rejects(failing.cancel("acc", "900", "r"), /network/);
  await assert.rejects(
    failing.materialize("acc", "43", "2026-11-05"),
    /network/,
  );
});

const seriesView = (
  id: string | null,
  startsAt: string,
  series = "43",
): CalendarEvent =>
  event({
    key: id ? `event:${id}` : legacyOccurrenceKey(series, startsAt),
    lookup: id
      ? { id }
      : { originalEventId: series, date: startsAt.slice(0, 10) },
    originalEventId: series,
    recurring: true,
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3600000).toISOString(),
    aliases: occurrenceAliases({ seriesId: series, id, startsAt }),
  });
const window = (events: CalendarEvent[]) =>
  new SmallSeriesBackend(session().value, calendarWith(events)).window(
    "acc",
    "43",
    "2026-10-29",
    "2026-11-30",
  );

test("the window shows one view per occurrence: the materialized one replaces the virtual one", async () => {
  for (const order of [0, 1]) {
    const views = [
      seriesView(null, "2026-11-05T05:00:00Z"),
      seriesView("900", "2026-11-05T09:00:00Z"),
    ];
    const { views: result } = await window(order ? views.reverse() : views);
    assert.deepEqual(
      result.map((v) => [v.key, v.eventId, v.startsAt]),
      [["series:43:2026-11-05", "900", "2026-11-05T09:00:00Z"]],
    );
  }
});

test("views are ordered by time, other series stay out and separate events are all kept", async () => {
  const { views, complete } = await window([
    seriesView("901", "2026-11-12T05:00:00Z"),
    seriesView(null, "2026-11-05T05:00:00Z"),
    seriesView(null, "2026-11-05T05:00:00Z", "77"),
    seriesView("902", "2026-11-12T05:00:00Z"),
  ]);
  assert.equal(complete, true);
  assert.deepEqual(
    views.map((v) => [v.startsAt, v.eventId ?? null]),
    [
      ["2026-11-05T05:00:00Z", null],
      ["2026-11-12T05:00:00Z", "901"],
      ["2026-11-12T05:00:00Z", "902"],
    ],
  );
});

test("an occurrence moved to another day stays a separate view", async () => {
  const { views } = await window([
    seriesView(null, "2026-11-05T05:00:00Z"),
    seriesView("900", "2026-11-06T05:00:00Z"),
  ]);
  assert.equal(views.length, 2);
});
