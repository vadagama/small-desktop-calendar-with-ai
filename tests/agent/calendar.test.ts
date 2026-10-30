import { test } from "node:test";
import assert from "node:assert/strict";
import { CalendarService } from "../../src/main/calendar.js";
import {
  calendarRange,
  splitEventDays,
} from "../../src/shared/calendar-time.js";

const event = {
  id: 42,
  title: "Synthetic meeting",
  starts_at: "2026-10-29T04:00:00Z",
  ends_at: "2026-10-29T05:00:00Z",
  creator_name: "Synthetic organizer",
  calendar_ids: [7],
};
const query = {
  accountId: "account-a",
  date: "2026-10-29",
  view: "week" as const,
  myCalendar: true,
  calendarIds: [],
};
function setup(respond: (path: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  const service = new CalendarService({
    readCalendar: async (accountId, action) => {
      assert.equal(accountId, "account-a");
      return action(async (path) => {
        calls.push(path);
        return respond(path);
      }, "person-a");
    },
  });
  return { service, calls };
}

test("periods use Almaty boundaries independently of the host timezone", () => {
  assert.deepEqual(calendarRange("2026-10-29", "day"), {
    start: "2026-10-28T19:00:00.000Z",
    end: "2026-10-29T19:00:00.000Z",
  });
  assert.deepEqual(calendarRange("2026-10-29", "week"), {
    start: "2026-10-25T19:00:00.000Z",
    end: "2026-11-01T19:00:00.000Z",
  });
  // Includes the full visible month grid, including adjacent months.
  assert.deepEqual(calendarRange("2026-10-29", "month"), {
    start: "2026-09-27T19:00:00.000Z",
    end: "2026-11-01T19:00:00.000Z",
  });
});

test("events spanning midnight produce clipped day segments, with no phantom day at midnight", () => {
  const segments = splitEventDays(
    "2026-10-29T18:30:00Z",
    "2026-10-30T19:00:00Z",
    calendarRange(query.date, "week"),
  );
  assert.deepEqual(segments, [
    { date: "2026-10-29", start: 1410, duration: 30 },
    { date: "2026-10-30", start: 0, duration: 1440 },
  ]);
});

test("personal events read the verified query contract and normalize safe fields", async () => {
  const f = setup(() => Response.json({ data: [event] }));
  const result = await f.service.events(query);
  assert.equal(result.events[0]?.title, event.title);
  assert.equal(result.events[0]?.startsAt, event.starts_at);
  const url = new URL(f.calls[0]!, "https://team.small.kz");
  assert.equal(url.pathname, "/gate/team/api/calendars/my/events");
  assert.equal(url.searchParams.get("start_date"), "2026-10-25T19:00:00.000Z");
  assert.equal(url.searchParams.get("end_date"), "2026-11-01T19:00:00.000Z");
  assert.deepEqual(result.issues, []);
});

test("unknown list envelopes fail instead of masquerading as empty", async () => {
  const f = setup(() => Response.json({ unexpected: [] }));
  await assert.rejects(
    f.service.calendars({ accountId: "account-a" }),
    /формат/,
  );
  const result = await f.service.events(query);
  assert.equal(result.events.length, 0);
  assert.equal(result.issues[0]?.kind, "invalid");
});

test("a failed calendar yields partial data and a visible permission error", async () => {
  const f = setup((path) =>
    path.includes("/8/")
      ? new Response(null, { status: 403 })
      : Response.json({ data: { "42": event } }),
  );
  const result = await f.service.events({
    ...query,
    myCalendar: false,
    calendarIds: ["7", "8"],
  });
  assert.equal(result.events.length, 1);
  assert.equal(result.issues[0]?.kind, "denied");
  assert.equal(result.issues[0]?.source, "8");
});

test("duplicate calendar copies deduplicate; recurrence instances retain distinct identity", async () => {
  const generated = { ...event, id: null, original_event_id: 42 };
  const next = {
    ...generated,
    starts_at: "2026-10-30T04:00:00Z",
    ends_at: "2026-10-30T05:00:00Z",
  };
  const f = setup(() => Response.json({ data: [event, generated, next] }));
  const result = await f.service.events({
    ...query,
    myCalendar: false,
    calendarIds: ["7", "8"],
  });
  assert.equal(result.events.length, 3);
  assert.equal(new Set(result.events.map((e) => e.key)).size, 3);
  assert.deepEqual(result.events[1]?.lookup, {
    originalEventId: "42",
    date: "2026-10-29",
  });
});

test("invalid timestamps and reversed intervals mark the result incomplete", async () => {
  const f = setup(() =>
    Response.json({
      data: [
        event,
        { ...event, starts_at: "2026-10-29T04:00:00" },
        { ...event, ends_at: "2026-10-29T03:00:00Z" },
      ],
    }),
  );
  const result = await f.service.events(query);
  assert.equal(result.events.length, 1);
  assert.ok(result.issues.some((issue) => issue.kind === "invalid"));
});

test("generated details use read-only GET lookup, never from-template", async () => {
  const f = setup(() =>
    Response.json({
      data: {
        ...event,
        original_event_id: 42,
        description: "Synthetic agenda",
        location: "Synthetic room",
      },
    }),
  );
  const detail = await f.service.detail({
    accountId: "account-a",
    lookup: { originalEventId: "42", date: "2026-10-29" },
  });
  assert.equal(detail.description, "Synthetic agenda");
  assert.equal(detail.location, "Synthetic room");
  assert.equal(f.calls.length, 1);
  assert.match(
    f.calls[0]!,
    /^\/gate\/team\/api\/calendar\/events\/generated\?/,
  );
  assert.equal(
    f.calls.some((path) => path.includes("from-template")),
    false,
  );
});

test("malformed query, impossible dates and path injection never reach the API", async () => {
  const f = setup(() => Response.json({ data: [] }));
  for (const input of [
    { ...query, date: "2026-02-30" },
    { ...query, endpoint: "https://evil.invalid" },
    { ...query, calendarIds: ["../user/info"] },
  ]) {
    await assert.rejects(f.service.events(input));
  }
  await assert.rejects(
    f.service.detail({ accountId: "account-a", lookup: { id: "../profile" } }),
  );
  assert.equal(f.calls.length, 0);
});

test("public calendar list uses server IDs and names without demo aliases", async () => {
  const f = setup(() =>
    Response.json({
      data: [
        { id: 7, name: "Synthetic room", description: "Synthetic description" },
      ],
    }),
  );
  assert.deepEqual(await f.service.calendars({ accountId: "account-a" }), [
    { id: "7", name: "Synthetic room" },
  ]);
});

test("calendar transport permits only fixed GET routes and verified query keys", async () => {
  const { isCalendarReadPath } = await import("../../src/main/calendar.js");
  assert.equal(
    isCalendarReadPath(
      "/gate/team/api/calendars/my/events?start_date=2026-10-29T00%3A00%3A00Z&end_date=2026-10-30T00%3A00%3A00Z",
    ),
    true,
  );
  for (const path of [
    "https://evil.invalid",
    "//evil.invalid/path",
    "/gate/team/api/calendar/events/from-template",
    "/gate/team/api/calendars/my/events?force=true",
    "/gate/team/api/calendar/events/42?force=true",
    "/gate/team/api/calendar/events/generated",
    "/gate/team/api/calendar/events/42#fragment",
  ])
    assert.equal(isCalendarReadPath(path), false, path);
});

test("a materialized instance keeps its own stable ID when its start changes", async () => {
  const f = setup(() =>
    Response.json({ data: [{ ...event, id: 99, original_event_id: 42 }] }),
  );
  const result = await f.service.events(query);
  assert.equal(result.events[0]?.key, "event:99");
  assert.deepEqual(result.events[0]?.lookup, { id: "99" });
});

const virtualRaw = {
  ...event,
  id: null,
  original_event_id: 43,
  is_recurring: true,
};
const keysOf = (events: { key: string }[]) => events.map((e) => e.key);

test("primary keys do not change; aliases link the views of a series occurrence", async () => {
  const f = setup(() =>
    Response.json({
      data: [
        { ...event, id: 5 },
        {
          ...virtualRaw,
          starts_at: "2026-10-30T04:00:00Z",
          ends_at: "2026-10-30T05:00:00Z",
        },
        {
          ...event,
          id: 99,
          original_event_id: 42,
          starts_at: "2026-10-31T04:00:00Z",
          ends_at: "2026-10-31T05:00:00Z",
        },
      ],
    }),
  );
  const [plain, virtual, own] = (await f.service.events(query)).events;
  assert.deepEqual([plain?.key, plain?.aliases], ["event:5", undefined]);
  assert.equal(virtual?.key, `series:43:${Date.parse("2026-10-30T04:00:00Z")}`);
  assert.deepEqual(virtual?.aliases, ["series:43:2026-10-30"]);
  assert.equal(own?.key, "event:99");
  assert.deepEqual(own?.aliases, [
    "series:42:2026-10-31",
    `series:42:${Date.parse("2026-10-31T04:00:00Z")}`,
  ]);
});

test("a virtual and a materialized view of one occurrence collapse into the materialized one", async () => {
  for (const order of [0, 1]) {
    const views = [virtualRaw, { ...virtualRaw, id: 900 }];
    const f = setup(() =>
      Response.json({ data: order ? views.reverse() : views }),
    );
    const { events, issues } = await f.service.events(query);
    assert.deepEqual(issues, []);
    assert.deepEqual(keysOf(events), ["event:900"]);
    assert.deepEqual(events[0]?.lookup, { id: "900" });
  }
});

test("a materialized view moved within the day still replaces the virtual one; another day does not", async () => {
  const moved = {
    ...virtualRaw,
    id: 900,
    starts_at: "2026-10-29T09:00:00Z",
    ends_at: "2026-10-29T10:00:00Z",
  };
  const sameDay = setup(() => Response.json({ data: [virtualRaw, moved] }));
  assert.deepEqual(keysOf((await sameDay.service.events(query)).events), [
    "event:900",
  ]);
  const otherDay = setup(() =>
    Response.json({
      data: [
        virtualRaw,
        {
          ...moved,
          starts_at: "2026-10-30T09:00:00Z",
          ends_at: "2026-10-30T10:00:00Z",
        },
      ],
    }),
  );
  assert.equal((await otherDay.service.events(query)).events.length, 2);
});

test("two different events of a series on one day stay visible; sources repeating an event add nothing", async () => {
  const f = setup(() =>
    Response.json({
      data: [
        { ...virtualRaw, id: 900 },
        { ...virtualRaw, id: 901 },
      ],
    }),
  );
  assert.deepEqual(keysOf((await f.service.events(query)).events), [
    "event:900",
    "event:901",
  ]);
  const twoSources = setup(() =>
    Response.json({ data: [{ ...virtualRaw, id: 900 }] }),
  );
  const result = await twoSources.service.events({
    ...query,
    myCalendar: false,
    calendarIds: ["7", "8"],
  });
  assert.deepEqual(keysOf(result.events), ["event:900"]);
});

test("detail carries the same keys and aliases as the list", async () => {
  const virtualDetail = setup(() => Response.json({ data: virtualRaw }));
  const v = await virtualDetail.service.detail({
    accountId: "account-a",
    lookup: { originalEventId: "43", date: "2026-10-29" },
  });
  assert.deepEqual(v.aliases, ["series:43:2026-10-29"]);
  const ownDetail = setup(() =>
    Response.json({ data: { ...virtualRaw, id: 900 } }),
  );
  const own = await ownDetail.service.detail({
    accountId: "account-a",
    lookup: { id: "900" },
  });
  assert.equal(own.key, "event:900");
  assert.equal(own.aliases?.length, 2);
});

test("oversized responses become an explicit incomplete-data error", async () => {
  const f = setup(() => new Response("x".repeat(8 * 1024 * 1024 + 1)));
  const result = await f.service.events(query);
  assert.equal(result.events.length, 0);
  assert.match(result.issues[0]!.message, /слишком большой/);
});

test("detail rejects a response for another event or another occurrence date", async () => {
  const f = setup(() =>
    Response.json({ data: { ...event, original_event_id: 42 } }),
  );
  await assert.rejects(
    f.service.detail({ accountId: "account-a", lookup: { id: "99" } }),
    /совпадает/,
  );
  await assert.rejects(
    f.service.detail({
      accountId: "account-a",
      lookup: { originalEventId: "42", date: "2026-10-30" },
    }),
    /совпадает/,
  );
});

test("calendar roles distinguish organizer, informed, invited and missing metadata", async () => {
  for (const [metadata, role] of [
    [{ creator_id: "person-a", is_informed: true }, "organizer"],
    [{ creator_id: "other", is_informed: true }, "informed"],
    [{ creator_id: "other", is_informed: false }, "invited"],
    [{}, "unknown"],
  ] as const) {
    const { service } = setup(() =>
      Response.json({ data: [{ ...event, ...metadata }] }),
    );
    const result = await service.events(query);
    assert.equal(result.events[0]?.participation, role);
  }
});

test("accepted fill belongs to the current participant, independently of organizer", async () => {
  for (const [participants, accepted] of [
    [[{ id: "person-a", status: "accepted" }], true],
    [
      [
        { id: "other", status: "accepted" },
        { id: "person-a", status: "pending" },
      ],
      false,
    ],
    [[], false],
  ] as const) {
    const { service } = setup(() =>
      Response.json({
        data: [
          { ...event, creator_id: "other", is_informed: false, participants },
        ],
      }),
    );
    const result = await service.events(query);
    assert.equal(result.events[0]?.accepted, accepted);
    assert.equal(result.events[0]?.participation, "invited");
  }
});

test("missing recurrence metadata stays unknown rather than blocking single-event gestures", async () => {
  const f = setup(() =>
    Response.json({ data: [{ ...event, creator_id: "person-a" }] }),
  );
  const result = await f.service.events(query);
  assert.equal(result.events[0]?.participation, "organizer");
  assert.equal(result.events[0]?.recurring, undefined);
});

test("event details retain informed people and recurrence independently of attendees", async () => {
  const f = setup(() =>
    Response.json({
      data: {
        ...event,
        is_recurring: true,
        participants: [
          { id: "attendee", name: "Synthetic attendee", status: "pending" },
        ],
        notification_recipients: [{ id: 91, name: "Synthetic informed" }],
        recurrence_rule: {
          FREQ: "WEEKLY",
          INTERVAL: 2,
          BYDAY: ["FR"],
          UNTIL: "2026-12-31",
        },
      },
    }),
  );
  const detail = await f.service.detail({
    accountId: "account-a",
    lookup: { id: "42" },
  });
  assert.deepEqual(detail.notificationRecipients, [
    { id: "91", name: "Synthetic informed" },
  ]);
  assert.deepEqual(detail.recurrenceRule, {
    FREQ: "WEEKLY",
    INTERVAL: 2,
    BYDAY: ["FR"],
    UNTIL: "2026-12-31",
  });
  assert.deepEqual(
    detail.participants?.map((p) => p.id),
    ["attendee"],
  );
});

test("generated occurrence reads missing recurrence from its series without inheriting rooms", async () => {
  const f = setup((path) =>
    Response.json({
      data: path.includes("generated")
        ? {
            ...event,
            id: null,
            original_event_id: 88,
            is_recurring: true,
            calendar_ids: [25],
          }
        : {
            ...event,
            id: 88,
            is_recurring: true,
            calendar_ids: [7],
            recurrence_rule: { FREQ: "WEEKLY", BYDAY: ["SA"] },
          },
    }),
  );
  const detail = await f.service.detail({
    accountId: "account-a",
    lookup: { originalEventId: "88", date: "2026-10-29" },
  });
  assert.deepEqual(detail.recurrenceRule, { FREQ: "WEEKLY", BYDAY: ["SA"] });
  assert.deepEqual(detail.calendarIds, ["25"]);
  assert.equal(f.calls.length, 2);
});

test("attachments retain names, size and a safe Small storage URL", async () => {
  const f = setup(() =>
    Response.json({
      data: {
        ...event,
        attachments: [
          { id: 1, path: "calendar/test/План встречи.pdf", size: 2048 },
          { id: 2, path: "https://untrusted.test/file.pdf", size: 1 },
        ],
      },
    }),
  );
  const detail = await f.service.detail({
    accountId: "account-a",
    lookup: { id: "42" },
  });
  assert.equal(detail.attachments?.[0]?.name, "План встречи.pdf");
  assert.equal(detail.attachments?.[0]?.size, 2048);
  assert.equal(
    detail.attachments?.[0]?.url,
    "https://minio.skiftrade.kz:9000/team/calendar/test/%D0%9F%D0%BB%D0%B0%D0%BD%20%D0%B2%D1%81%D1%82%D1%80%D0%B5%D1%87%D0%B8.pdf",
  );
  assert.equal(detail.attachments?.[1]?.url, undefined);
});

test("unavailable or unrelated series keeps the occurrence readable without inventing recurrence", async () => {
  for (const parent of [
    new Response(null, { status: 403 }),
    Response.json({
      data: {
        ...event,
        id: 99,
        is_recurring: true,
        recurrence_rule: { FREQ: "DAILY" },
      },
    }),
  ]) {
    const f = setup((path) =>
      path.includes("generated")
        ? Response.json({ data: { ...event, id: null, original_event_id: 88 } })
        : parent,
    );
    const detail = await f.service.detail({
      accountId: "account-a",
      lookup: { originalEventId: "88", date: "2026-10-29" },
    });
    assert.equal(detail.recurring, true);
    assert.equal(detail.recurrenceRule, undefined);
  }
});

test("auth expiry while reading a recurrence template is reported", async () => {
  const f = setup((path) =>
    path.includes("generated")
      ? Response.json({ data: { ...event, id: null, original_event_id: 88 } })
      : new Response(null, { status: 401 }),
  );
  await assert.rejects(
    f.service.detail({
      accountId: "account-a",
      lookup: { originalEventId: "88", date: "2026-10-29" },
    }),
    { kind: "auth" },
  );
});
