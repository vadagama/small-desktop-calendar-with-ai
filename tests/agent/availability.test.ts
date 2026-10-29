import { test } from "node:test";
import assert from "node:assert/strict";
import { AvailabilityService } from "../../src/main/availability.js";
const query = {
  accountId: "account-a",
  participantIds: ["a", "b"],
  date: "2026-10-29",
  durationMinutes: 30,
};
const slot = {
  start: "2026-10-29T09:00:00+05:00",
  end: "2026-10-29T09:30:00+05:00",
};
const coverage = ["a", "b"].map((participant_id) => ({
  type: "participant",
  participant_id,
  busy_slots: [],
}));
function setup(
  slots: unknown = { data: { available_slots: [slot] } },
  busy: unknown = { data: coverage },
) {
  const calls: { path: string; body: unknown }[] = [];
  const service = new AvailabilityService(
    {
      readCalendar: async (account, action) => {
        assert.equal(account, "account-a");
        return action(async (path, body) => {
          calls.push({ path, body });
          return Response.json(path.endsWith("/find-slots") ? slots : busy);
        });
      },
    },
    () => Date.parse("2026-10-28T00:00:00Z"),
  );
  return { service, calls };
}
test("slots retain every participant and are checked against individual busy intervals", async () => {
  const f = setup();
  assert.deepEqual(await f.service.find(query), {
    slots: [slot],
    participantIds: ["a", "b"],
    date: query.date,
    durationMinutes: 30,
    timezone: "Asia/Almaty",
  });
  assert.deepEqual(
    f.calls.map((call) => call.body),
    [
      {
        participant_ids: ["a", "b"],
        start_date: query.date,
        duration_minutes: 30,
        timezone: "Asia/Almaty",
        include_weekends: false,
      },
      {
        participant_ids: ["a", "b"],
        date: query.date,
        timezone: "Asia/Almaty",
      },
    ],
  );
});
test("missing, aggregated, duplicate or malformed busy coverage is unknown, never free", async () => {
  for (const data of [
    [],
    coverage.slice(0, 1),
    [coverage[0], coverage[0]],
    [{ type: "participant", busy_slots: [] }],
    [{ ...coverage[0], busy_slots: null }, coverage[1]],
    [{ ...coverage[0], error: "denied" }, coverage[1]],
  ]) {
    await assert.rejects(
      setup(undefined, { data }).service.find(query),
      /занятост/,
    );
  }
});
test("conflicts are filtered using half-open intervals; duplicate slots deduplicate", async () => {
  const later = {
    start: "2026-10-29T09:30:00+05:00",
    end: "2026-10-29T10:00:00+05:00",
  };
  const f = setup(
    { data: { available_slots: [slot, later, later] } },
    { data: [{ ...coverage[0], busy_slots: [slot] }, coverage[1]] },
  );
  assert.deepEqual((await f.service.find(query)).slots, [later]);
});
test("valid empty slots differ from missing slots or malformed timestamps", async () => {
  assert.deepEqual(
    (await setup({ data: { available_slots: [] } }).service.find(query)).slots,
    [],
  );
  for (const response of [
    {},
    { data: {} },
    { data: { available_slots: [{ ...slot, start: "2026-10-29T09:00:00" }] } },
    { data: { available_slots: [{ ...slot, end: slot.start }] } },
  ])
    await assert.rejects(setup(response).service.find(query));
});
test("search stays within selected Almaty date and requested duration", async () => {
  const f = setup({
    data: {
      available_slots: [
        slot,
        { ...slot, end: "2026-10-29T10:00:00+05:00" },
        {
          start: "2026-10-30T09:00:00+05:00",
          end: "2026-10-30T09:30:00+05:00",
        },
      ],
    },
  });
  assert.deepEqual((await f.service.find(query)).slots, [slot]);
});
test("invalid participants, date and duration are rejected before any request", async () => {
  const f = setup();
  for (const input of [
    { ...query, participantIds: [] },
    { ...query, participantIds: ["a", "a"] },
    { ...query, date: "2026-02-30" },
    { ...query, durationMinutes: 0 },
    { ...query, force: true },
  ])
    await assert.rejects(f.service.find(input));
  assert.equal(f.calls.length, 0);
});

test("past slots and slots crossing the Almaty day boundary are never suggested", async () => {
  const service = new AvailabilityService(
    {
      readCalendar: async (_account, action) =>
        action(async (path) =>
          Response.json(
            path.endsWith("/find-slots")
              ? {
                  data: {
                    available_slots: [
                      slot,
                      {
                        start: "2026-10-29T23:45:00+05:00",
                        end: "2026-10-30T00:15:00+05:00",
                      },
                    ],
                  },
                }
              : { data: coverage },
          ),
        ),
    },
    () => Date.parse("2026-10-29T09:15:00+05:00"),
  );
  assert.deepEqual((await service.find(query)).slots, []);
});

test("weekend requests cannot show slots even if the server returns them", async () => {
  const f = setup({
    data: {
      available_slots: [
        {
          start: "2026-11-01T09:00:00+05:00",
          end: "2026-11-01T09:30:00+05:00",
        },
      ],
    },
  });
  await assert.rejects(
    f.service.find({ ...query, date: "2026-11-01" }),
    /рабочий день/,
  );
  assert.equal(f.calls.length, 0);
});

test("excessive combined busy intervals cannot block the trusted process", async () => {
  const data = coverage.map((record) => ({
    ...record,
    busy_slots: Array.from({ length: 2501 }, () => slot),
  }));
  await assert.rejects(
    setup(undefined, { data }).service.find(query),
    /слишком много/,
  );
});

test("manual creation can explicitly check weekend slots without changing the default", async () => {
  const weekend = {
    start: "2026-10-31T09:00:00+05:00",
    end: "2026-10-31T09:30:00+05:00",
  };
  const f = setup({ data: { available_slots: [weekend] } });
  await assert.rejects(
    f.service.find({ ...query, date: "2026-10-31" }),
    /рабочий день/,
  );
  assert.deepEqual(
    (
      await f.service.find({
        ...query,
        date: "2026-10-31",
        includeWeekends: true,
      })
    ).slots,
    [weekend],
  );
  assert.equal(
    (f.calls[0]!.body as { include_weekends: boolean }).include_weekends,
    true,
  );
});

test("Small success envelopes and busy participant id fields are accepted", async () => {
  const f = setup(
    { status: "success", data: { available_slots: [slot], has_more: false } },
    {
      status: "success",
      data: coverage.map(({ participant_id, ...record }) => ({
        ...record,
        id: participant_id,
      })),
    },
  );
  assert.deepEqual((await f.service.find(query)).slots, [slot]);
});
test("Small id records still require full and unambiguous participant coverage", async () => {
  for (const data of [
    [{ type: "participant", id: "a", busy_slots: [] }],
    [
      { type: "participant", id: "a", participant_id: "b", busy_slots: [] },
      { type: "participant", id: "b", busy_slots: [] },
    ],
    [
      { type: "participant", id: "a", busy_slots: [] },
      { type: "participant", id: "a", busy_slots: [] },
    ],
  ])
    await assert.rejects(
      setup(undefined, { status: "success", data }).service.find(query),
    );
});

test("incomplete slot results and non-success envelopes never establish availability", async () => {
  await assert.rejects(
    setup({
      status: "success",
      data: { available_slots: [slot], has_more: true },
    }).service.find(query),
    /неполный/,
  );
  await assert.rejects(
    setup({
      status: "error",
      data: { available_slots: [slot], has_more: false },
    }).service.find(query),
  );
  await assert.rejects(
    setup(undefined, { status: "error", data: coverage }).service.find(query),
  );
});

test("afternoon bounds filter complete slots and reject reversed bounds", async () => {
  const afternoon = {
    start: "2026-10-29T14:00:00+05:00",
    end: "2026-10-29T14:30:00+05:00",
  };
  const late = {
    start: "2026-10-29T17:45:00+05:00",
    end: "2026-10-29T18:15:00+05:00",
  };
  const { service } = setup({
    data: { available_slots: [slot, afternoon, late] },
  });
  assert.deepEqual(
    (await service.find({ ...query, timeFrom: "14:00", timeTo: "18:00" }))
      .slots,
    [afternoon],
  );
  await assert.rejects(
    service.find({ ...query, timeFrom: "18:00", timeTo: "14:00" }),
  );
});
test("explicit weekend request reaches the API and preserves day boundaries", async () => {
  const saturday = {
    start: "2026-10-31T14:00:00+05:00",
    end: "2026-10-31T14:30:00+05:00",
  };
  const { service, calls } = setup({
    data: { available_slots: [slot, saturday] },
  });
  const result = await service.find({
    ...query,
    date: "2026-10-31",
    includeWeekends: true,
    timeFrom: "14:00",
  });
  assert.deepEqual(result.slots, [saturday]);
  assert.equal(
    (calls[0]?.body as { include_weekends: boolean }).include_weekends,
    true,
  );
});
