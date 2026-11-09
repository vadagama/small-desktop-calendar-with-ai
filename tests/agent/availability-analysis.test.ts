import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analysisQuery,
  analysisDates,
  partitionAvailability,
  commonAvailability,
  availabilityWindowAt,
} from "../../src/shared/availability-analysis.js";
const q = {
  accountId: "a",
  participantIds: ["p"],
  date: "2026-11-10",
  period: "week" as const,
  durationMinutes: 60,
};
const at = (time: string) => `2026-11-10T${time}:00+05:00`;
test("analysis validates IDs and normalizes one day versus working week", () => {
  assert.deepEqual(analysisDates(analysisQuery.parse(q)), [
    "2026-11-09",
    "2026-11-10",
    "2026-11-11",
    "2026-11-12",
    "2026-11-13",
  ]);
  assert.deepEqual(
    analysisDates(analysisQuery.parse({ ...q, period: "day" })),
    [q.date],
  );
  assert.equal(
    analysisQuery.safeParse({ ...q, participantIds: ["p", "p"] }).success,
    false,
  );
  assert.equal(
    analysisQuery.safeParse({ ...q, date: "2026-02-30" }).success,
    false,
  );
  assert.equal(
    analysisQuery.safeParse({ ...q, timeFrom: "18:00", timeTo: "09:00" })
      .success,
    false,
  );
});
test("only confirmed free coverage is selectable; busy and missing coverage win", () => {
  const intervals = partitionAvailability(
    q.date,
    [{ start: at("09:00"), end: at("12:00") }],
    [{ start: at("10:10"), end: at("10:25") }],
    "09:00",
    "18:00",
    0,
  );
  assert.equal(intervals.find((i) => i.start === at("10:10"))?.state, "busy");
  assert.equal(
    intervals.find((i) => i.start === at("12:00"))?.state,
    "unknown",
  );
  const common = commonAvailability(
    [
      intervals,
      partitionAvailability(
        q.date,
        [{ start: at("10:25"), end: at("12:00") }],
        [],
        "09:00",
        "18:00",
        0,
      ),
    ],
    60,
  );
  assert.deepEqual(common, [{ start: at("10:25"), end: at("12:00") }]);
  assert.deepEqual(commonAvailability([], 60), []);
});
test("touching free intervals merge and past time is not offered", () => {
  const rows = partitionAvailability(
    q.date,
    [
      { start: at("09:00"), end: at("10:00") },
      { start: at("10:00"), end: at("12:00") },
    ],
    [],
    "09:00",
    "18:00",
    Date.parse(at("10:00")),
  );
  assert.deepEqual(commonAvailability([rows], 60), [
    { start: at("10:00"), end: at("12:00") },
  ]);
});

test("service keeps omitted coverage unknown and validates each participant", async () => {
  const { AvailabilityService } =
    await import("../../src/main/availability.js");
  const service = new AvailabilityService(
    {
      readCalendar: async (_account, action) =>
        action(async (path, body) => {
          const input = body as { participant_ids: string[] };
          return Response.json(
            path.endsWith("busy-intervals")
              ? {
                  data: [
                    {
                      type: "participant",
                      id: "p",
                      busy_slots: [{ start: at("10:10"), end: at("10:25") }],
                    },
                  ],
                }
              : {
                  data: {
                    available_slots: [{ start: at("09:00"), end: at("12:00") }],
                    has_more: false,
                  },
                },
          );
        }),
    },
    () => 0,
  );
  const result = await service.analyze({
    ...q,
    period: "day",
    participantIds: ["p", "missing"],
  });
  assert.equal(
    result.days[0]?.participants[1]?.intervals.some((i) => i.state === "free"),
    false,
  );
  assert.deepEqual(result.days[0]?.commonWindows, []);
  assert.equal(
    result.days[0]?.participants[0]?.intervals.some((i) => i.state === "busy"),
    true,
  );
});

test("AI analysis requires verified composition and never executes a calendar write", async () => {
  const { createCalendarToolExecutor } =
    await import("../../src/main/calendar-tools.js");
  const { CalendarConversation } =
    await import("../../src/main/calendar-conversation.js");
  const state = new CalendarConversation();
  const execute = createCalendarToolExecutor(
    "a",
    "Найди свободное время для Анны",
    new AbortController().signal,
    {
      events: async () => ({ events: [], issues: [] }),
      searchPeople: async () => ({
        people: [{ participantId: "p", name: "Анна", position: "Тимлид" }],
        page: 1,
        nextPage: null,
      }),
    },
    {
      find: async () => {
        throw Error("must not search/write before opening");
      },
    },
    "Я",
    undefined,
    state,
    undefined,
    "self",
  );
  assert.equal(
    (
      await execute("showAvailabilityAnalysis", {
        participantIds: ["p"],
        date: q.date,
      })
    ).ok,
    false,
  );
  await execute("searchPeople", { query: "Анна", page: 1 });
  await execute("selectParticipants", { participantIds: ["p"] });
  const result = await execute("showAvailabilityAnalysis", {
    participantIds: ["p"],
    date: q.date,
    period: "day",
    includeSelf: false,
  });
  assert.equal(result.ok, true);
  if (
    result.ok &&
    "kind" in result.data &&
    result.data.kind === "availability-analysis"
  ) {
    assert.deepEqual(result.data.query.participantIds, ["self", "p"]);
    assert.equal(result.data.query.durationMinutes, 60);
    assert.equal(result.data.query.period, "day");
  } else assert.fail("opening missing");
  const repeated = await execute("showAvailabilityAnalysis", {
    participantIds: ["p", "self"],
    date: q.date,
    period: "day",
  });
  assert.equal(repeated.ok, true);
  if (
    repeated.ok &&
    "kind" in repeated.data &&
    repeated.data.kind === "availability-analysis"
  )
    assert.deepEqual(repeated.data.query.participantIds, ["self", "p"]);
  assert.equal(
    (
      await execute("showAvailabilityAnalysis", {
        participantIds: ["p"],
        date: q.date,
        accountId: "foreign",
      })
    ).ok,
    false,
  );
});

test("analysis accepts verified saved group and respects duration, window and organizer buffer", async () => {
  const { AssistantMemoryStore } =
    await import("../../src/main/assistant-memory.js");
  const { MemoryProposals } =
    await import("../../src/main/memory-proposals.js");
  const { createCalendarToolExecutor } =
    await import("../../src/main/calendar-tools.js");
  const { CalendarConversation } =
    await import("../../src/main/calendar-conversation.js");
  const values = new Map<string, string>();
  const store = new AssistantMemoryStore("/nonexistent", {
    get: async (k) => values.get(k) ?? null,
    set: async (k, v) => {
      values.set(k, v);
    },
    remove: async (k) => {
      values.delete(k);
    },
  });
  const people = [
    { participantId: "p", name: "Анна Тестовая", position: "Тимлид" },
  ];
  await store.write("a", {
    revision: 0,
    requestId: crypto.randomUUID(),
    change: {
      action: "group",
      value: { name: "Тимлиды", participantIds: ["p"], people },
    },
  });
  await store.write("a", {
    revision: 1,
    requestId: crypto.randomUUID(),
    change: {
      action: "preferences",
      value: {
        durationMinutes: 90,
        timeFrom: "14:00",
        timeTo: "18:00",
        bufferMinutes: 15,
      },
    },
  });
  const saved = await store.read("a");
  const state = new CalendarConversation();
  const execute = createCalendarToolExecutor(
    "a",
    "Найди мне время с тимлидами во вторник",
    new AbortController().signal,
    {
      events: async () => ({ events: [], issues: [] }),
      searchPeople: async () => ({ people, page: 1, nextPage: null }),
    },
    {
      find: async () => {
        throw Error("No legacy find");
      },
    },
    "Я",
    undefined,
    state,
    undefined,
    "self",
    undefined,
    undefined,
    {
      store,
      proposals: new MemoryProposals(store),
      ownerId: 1,
      epoch: 1,
      messageId: "test",
    },
  );
  const selected = await execute("assistantMemory", {
    action: "useGroup",
    id: saved.groups[0]!.id,
  });
  assert.equal(selected.ok, true);
  const result = await execute("showAvailabilityAnalysis", {
    participantIds: ["p"],
    period: "day",
    date: q.date,
    includeSelf: true,
  });
  assert.equal(result.ok, true);
  if (
    result.ok &&
    "kind" in result.data &&
    result.data.kind === "availability-analysis"
  ) {
    assert.equal(result.data.query.durationMinutes, 90);
    assert.equal(result.data.query.timeFrom, "14:00");
    assert.equal(result.data.query.bufferMinutes, 15);
  } else assert.fail("Missing analysis");
});

test("sandboxed preload has dependency-free channel constants", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../../src/shared/availability-channels.ts", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("import "), false);
});

test("replaced analysis stops before subsequent participant requests", async () => {
  const { AvailabilityService } =
    await import("../../src/main/availability.js");
  const controller = new AbortController();
  let requests = 0;
  const service = new AvailabilityService({
    readCalendar: async (_account, action) =>
      action(async () => {
        requests++;
        controller.abort();
        return Response.json({
          data: [{ type: "participant", id: "p", busy_slots: [] }],
        });
      }),
  });
  await assert.rejects(() =>
    service.analyze({ ...q, period: "day" }, controller.signal),
  );
  assert.equal(requests, 1);
});

test("organizer buffer near midnight requires adjacent-day busy coverage", async () => {
  const { AvailabilityService } =
    await import("../../src/main/availability.js");
  const service = new AvailabilityService(
    {
      readCalendar: async (_account, action) =>
        action(async (_path, body) =>
          Response.json({
            data:
              (body as { date?: string }).date === q.date
                ? [{ type: "participant", id: "p", busy_slots: [] }]
                : [],
          }),
        ),
    },
    () => 0,
  );
  await assert.rejects(
    () =>
      service.analyze({
        ...q,
        period: "day",
        timeFrom: "00:00",
        bufferMinutes: 15,
        organizerParticipantId: "p",
      }),
    /соседнего дня/,
  );
});

test("twenty participants intersect exact fractional boundaries and clip midnight", () => {
  const row = partitionAvailability(
    q.date,
    [{ start: "2026-11-09T23:30:00+05:00", end: at("12:00") }],
    [{ start: at("09:00"), end: "2026-11-10T09:15:30+05:00" }],
    "00:00",
    "23:59",
    0,
  );
  const narrow = partitionAvailability(
    q.date,
    [{ start: "2026-11-10T09:15:45+05:00", end: at("11:15") }],
    [],
    "09:00",
    "18:00",
    0,
  );
  const result = commonAvailability(
    [...Array.from({ length: 19 }, () => row), narrow],
    60,
  );
  assert.deepEqual(result, [
    { start: "2026-11-10T09:15:45+05:00", end: at("11:15") },
  ]);
  assert.equal(row[0]?.start, "2026-11-10T00:00:00+05:00");
  assert.equal(row.at(-1)?.end, "2026-11-11T00:00:00+05:00");
  assert.equal(
    analysisQuery.safeParse({
      ...q,
      participantIds: Array.from({ length: 21 }, (_, i) => `p${i}`),
    }).success,
    false,
  );
});

test("sampled search pagination does not invalidate a complete busy timeline", async () => {
  const { AvailabilityService } =
    await import("../../src/main/availability.js");
  const result = await new AvailabilityService(
    {
      readCalendar: async (_account, action) =>
        action(async (path) =>
          Response.json(
            path.endsWith("busy-intervals")
              ? { data: [{ type: "participant", id: "p", busy_slots: [] }] }
              : {
                  data: {
                    has_more: true,
                    available_slots: [{ start: at("09:00"), end: at("18:00") }],
                  },
                },
          ),
        ),
    },
    () => 0,
  ).analyze({ ...q, period: "day" });
  assert.deepEqual(result.days[0]?.commonWindows, [
    { start: at("09:00"), end: at("13:00") },
    { start: at("14:00"), end: at("18:00") },
  ]);
  assert.equal(result.days[0]?.participants[0]?.issue, undefined);
});

test("full busy response yields continuous free windows, not one-minute search suggestions", async () => {
  const { AvailabilityService } =
    await import("../../src/main/availability.js");
  const paths: string[] = [];
  const service = new AvailabilityService(
    {
      readCalendar: async (_account, action) =>
        action(async (path) => {
          paths.push(path);
          return Response.json(
            path.endsWith("busy-intervals")
              ? {
                  data: [
                    {
                      type: "participant",
                      id: "p",
                      busy_slots: [{ start: at("10:10"), end: at("10:25") }],
                    },
                  ],
                }
              : {
                  data: {
                    available_slots: [
                      { start: at("09:00"), end: at("09:01") },
                      { start: at("09:30"), end: at("09:31") },
                    ],
                    has_more: false,
                  },
                },
          );
        }),
    },
    () => 0,
  );
  const result = await service.analyze({ ...q, period: "day" });
  assert.deepEqual(result.days[0]?.commonWindows, [
    { start: at("09:00"), end: at("10:10") },
    { start: at("10:25"), end: at("13:00") },
    { start: at("14:00"), end: at("18:00") },
  ]);
  assert.equal(
    result.days[0]?.participants[0]?.intervals.some(
      (i) => i.state === "unknown",
    ),
    false,
  );
  assert.equal(
    paths.some((p) => p.endsWith("find-slots")),
    false,
  );
  assert.equal(
    result.days[0]?.participants[0]?.intervals.find(
      (i) => i.start === at("13:00"),
    )?.state,
    "outside-hours",
  );
});

test("exact dashboard choice rechecks its interval instead of a sampled suggestions list", async () => {
  const { AvailabilityService } =
    await import("../../src/main/availability.js");
  const paths: string[] = [];
  const service = new AvailabilityService(
    {
      readCalendar: async (_account, action) =>
        action(async (path) => {
          paths.push(path);
          return Response.json(
            path.endsWith("busy-intervals")
              ? { data: [{ type: "participant", id: "p", busy_slots: [] }] }
              : { data: { available_slots: [], has_more: true } },
          );
        }),
    },
    () => 0,
  );
  const exactInterval = { start: at("10:15"), end: at("11:15") };
  const result = await service.find({
    accountId: q.accountId,
    participantIds: q.participantIds,
    date: q.date,
    durationMinutes: 60,
    exactInterval,
  });
  assert.deepEqual(result.slots, [exactInterval]);
  assert.equal(
    paths.some((p) => p.endsWith("find-slots")),
    false,
  );
});

test("exact choices still reject lunch, outside work hours, busy conflicts and missing people", async () => {
  const { AvailabilityService } =
    await import("../../src/main/availability.js");
  let missing = false;
  const service = new AvailabilityService(
    {
      readCalendar: async (_account, action) =>
        action(async () =>
          Response.json({
            data: missing
              ? []
              : [
                  {
                    type: "participant",
                    id: "p",
                    busy_slots: [{ start: at("10:10"), end: at("10:25") }],
                  },
                ],
          }),
        ),
    },
    () => 0,
  );
  const query = {
    accountId: q.accountId,
    participantIds: q.participantIds,
    date: q.date,
    durationMinutes: 60,
  };
  for (const exactInterval of [
    { start: at("12:30"), end: at("13:30") },
    { start: at("08:00"), end: at("09:00") },
    { start: at("09:30"), end: at("10:30") },
  ]) {
    assert.deepEqual(
      (await service.find({ ...query, exactInterval })).slots,
      [],
    );
  }
  missing = true;
  await assert.rejects(
    () =>
      service.find({
        ...query,
        exactInterval: { start: at("11:00"), end: at("12:00") },
      }),
    /полной занятости/,
  );
});

test("personal segment requires organizer coverage and never jumps to an earlier window start", () => {
  const personal = [{ start: at("10:00"), end: at("13:00") }];
  const common = [{ start: at("11:00"), end: at("12:00") }];
  assert.equal(
    availabilityWindowAt(
      { start: at("09:00"), end: at("10:00") },
      personal,
      common,
      60,
    ),
    undefined,
  );
  assert.deepEqual(
    availabilityWindowAt(
      { start: at("12:00"), end: at("13:00") },
      personal,
      common,
      60,
    ),
    { start: at("12:00"), end: at("13:00"), common: false },
  );
  assert.equal(
    availabilityWindowAt(
      { start: at("12:30"), end: at("13:00") },
      personal,
      common,
      60,
    ),
    undefined,
  );
  assert.deepEqual(
    availabilityWindowAt(
      { start: at("11:00"), end: at("12:00") },
      personal,
      common,
      60,
    ),
    { start: at("11:00"), end: at("12:00"), common: true },
  );
});
