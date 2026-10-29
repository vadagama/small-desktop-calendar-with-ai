import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ProbeGuard,
  assertExecutable,
  dryRunPlan,
  experiments,
  parseArgs,
  probePrefix,
  runProbe,
  writeLimit,
  type ProbeArgs,
  type ProbeFetch,
} from "../../scripts/series-probe.js";

const api = "/gate/team/api";
const ok: ProbeArgs = {
  execute: true,
  baseUrl: "https://test.example",
  allowHost: "test.example",
  calendarId: "77",
  confirm: "test.example:77",
};
const env = { SMALL_PROBE_COOKIE: "session=SECRET-COOKIE" };

test("without --execute the probe only describes its plan", () => {
  assert.deepEqual(parseArgs([]), { execute: false });
  const plan = dryRunPlan();
  for (const e of experiments) assert.match(plan, new RegExp(e.id));
  assert.match(plan, /запросы не отправляются/);
  assert.match(dryRunPlan(["E3"]), /E3\./);
  assert.doesNotMatch(dryRunPlan(["E3"]), /E4\./);
  assert.throws(() => assertExecutable({ execute: false }, env), /--execute/);
  assert.throws(() => parseArgs(["--unknown"]), /Неизвестный/);
  assert.throws(() => parseArgs(["--base-url"]), /значение/);
});

test("every missing or mismatching precondition blocks execution", () => {
  assert.deepEqual(assertExecutable(ok, env), {
    origin: "https://test.example",
    calendarId: 77,
  });
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ baseUrl: undefined }, /Нужны/],
    [{ allowHost: undefined }, /Нужны/],
    [{ calendarId: undefined }, /Нужны/],
    [{ confirm: undefined }, /Нужны/],
    [{ baseUrl: "http://test.example" }, /https/],
    [{ allowHost: "other.example" }, /allow-host/],
    [{ calendarId: "abc", confirm: "test.example:abc" }, /числом/],
    [{ confirm: "test.example:78" }, /confirm/],
  ];
  for (const [patch, message] of cases)
    assert.throws(
      () => assertExecutable({ ...ok, ...patch } as ProbeArgs, env),
      message,
    );
  assert.throws(() => assertExecutable(ok, {}), /SMALL_PROBE_COOKIE/);
});

test("the guard allows only writes about events created by this run", () => {
  const guard = new ProbeGuard();
  const create = {
    title: `${probePrefix}series`,
    participant_ids: [],
  };
  guard.check("GET", `${api}/anything`);
  guard.check("POST", `${api}/calendar/events`, create);
  for (const bad of [
    { ...create, title: "Реальная встреча" },
    { ...create, participant_ids: ["real-person"] },
    { title: `${probePrefix}x` },
  ])
    assert.throws(() => guard.check("POST", `${api}/calendar/events`, bad));
  assert.throws(
    () => guard.check("DELETE", `${api}/calendar/events/foreign`),
    /только для событий/,
  );
  guard.owned.add("mine");
  guard.check("DELETE", `${api}/calendar/events/mine`);
  guard.check("PUT", `${api}/calendar/events/mine?force=false`, {});
  guard.check("POST", `${api}/calendar/events/mine/cancel`, {});
  assert.throws(() => guard.check("PUT", `${api}/calendar/events/mine`, {}));
  assert.throws(() =>
    guard.check("PUT", `${api}/calendar/events/mine?force=true`, {}),
  );
  assert.throws(() => guard.check("DELETE", `${api}/calendars/mine`));
  assert.throws(() => guard.check("PATCH", `${api}/calendar/events/mine`));
  assert.throws(
    () =>
      guard.check("POST", `${api}/calendar/events/from-template`, {
        original_event_id: "foreign",
      }),
    /серий этого запуска/,
  );
  guard.masters.add("mine");
  guard.check("POST", `${api}/calendar/events/from-template`, {
    original_event_id: "mine",
  });
});

test("the guard stops after the write limit", () => {
  const guard = new ProbeGuard();
  guard.owned.add("mine");
  for (let i = 0; i < writeLimit; i++)
    guard.check("DELETE", `${api}/calendar/events/mine`);
  assert.throws(
    () => guard.check("DELETE", `${api}/calendar/events/mine`),
    /лимит/,
  );
});

/** In-memory server for the probe mechanics only; it says nothing about Team Small. */
function fakeServer(options: { rejectCreate?: boolean } = {}) {
  const store = new Map<string, Record<string, unknown>>();
  const log: { method: string; url: string; body: unknown; cookie?: string }[] =
    [];
  let next = 1;
  const reply = (status: number, data?: unknown, headers = {}) => ({
    status,
    headers: {
      get: (name: string) =>
        (headers as Record<string, string>)[name.toLowerCase()] ?? null,
    },
    text: async () => (data === undefined ? "" : JSON.stringify(data)),
  });
  const fetcher: ProbeFetch = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    log.push({
      method: init.method,
      url,
      body,
      ...(init.headers.Cookie ? { cookie: init.headers.Cookie } : {}),
    });
    const path = url.replace("https://test.example", "");
    const id = /events\/(\d+)/.exec(path)?.[1];
    if (init.method === "POST" && path === `${api}/calendar/events`) {
      if (options.rejectCreate) return reply(422);
      const created = String(next++);
      store.set(created, { id: created, ...body });
      return reply(200, { data: { id: created } });
    }
    if (path.endsWith("/from-template")) {
      const child = String(next++);
      store.set(child, {
        id: child,
        title: store.get(body.original_event_id)?.title,
        original_event_id: body.original_event_id,
        starts_at: `${body.date}T10:00:00+05:00`,
      });
      return reply(200, { data: { id: child } });
    }
    if (init.method === "GET" && path.includes("/calendars/my/events"))
      return reply(200, { data: [...store.values()] });
    if (init.method === "GET" && path.includes("/generated"))
      return reply(200, { data: { original_event_id: "1" } });
    if (init.method === "GET" && id)
      return reply(200, { data: store.get(id) }, { etag: 'W/"1"' });
    if (init.method === "DELETE")
      return id && store.delete(id) ? reply(204) : reply(404);
    return reply(200, { data: {} });
  };
  return { fetcher, store, log };
}

test("a run creates only prefixed events without people, cleans up and redacts the result", async () => {
  const server = fakeServer();
  const result = await runProbe(
    ok,
    env,
    server.fetcher,
    new Date("2026-10-29T05:00:00Z"),
  );
  const writes = server.log.filter((r) => r.method !== "GET");
  assert.ok(writes.length > 0 && writes.length <= writeLimit);
  for (const request of server.log) {
    assert.ok(request.url.startsWith("https://test.example/gate/team/api/"));
    assert.equal(request.cookie, env.SMALL_PROBE_COOKIE);
  }
  for (const create of server.log.filter(
    (r) => r.method === "POST" && r.url.endsWith("/calendar/events"),
  )) {
    const body = create.body as { title: string; participant_ids: unknown[] };
    assert.ok(body.title.startsWith(probePrefix));
    assert.deepEqual(body.participant_ids, []);
    assert.deepEqual(
      (create.body as { calendar_ids: number[] }).calendar_ids,
      [77],
    );
  }
  assert.equal(server.store.size, 0);
  assert.equal(result.cleanup.failed, 0);
  assert.ok(result.cleanup.deleted >= 3);
  assert.deepEqual(result.experiments.map((e) => e.id).slice(0, 7), [
    "E1",
    "E2",
    "E3",
    "E4",
    "E5",
    "E6",
    "E7",
  ]);
  const json = JSON.stringify(result);
  assert.ok(!json.includes("SECRET-COOKIE"));
  assert.ok(!json.includes(probePrefix));
  assert.ok(!/test\.example/.test(json));
  assert.match(json, /\{e\d+\}/);
  assert.ok(!/events\/\d+/.test(json));
  assert.match(json, /Один и тот же id: false/);
  assert.match(json, /ETag: есть/);
  assert.match(json, /нет SMALL_PROBE_COOKIE_OTHER/);
});

test("a rejected series stops later experiments but still runs cleanup and --only filters", async () => {
  const rejected = fakeServer({ rejectCreate: true });
  const result = await runProbe(ok, env, rejected.fetcher, new Date());
  assert.match(JSON.stringify(result.experiments[0]), /отклонено/);
  assert.match(JSON.stringify(result.experiments[1]), /нет серии/);
  assert.equal(rejected.store.size, 0);
  assert.equal(rejected.log.filter((r) => r.method !== "GET").length, 1);
  const only = fakeServer();
  const filtered = await runProbe(
    { ...ok, only: ["E1"] },
    env,
    only.fetcher,
    new Date(),
  );
  assert.deepEqual(
    filtered.experiments.map((e) => e.id).filter((id) => id !== "cleanup"),
    ["E1"],
  );
  assert.equal(only.store.size, 0);
});

test("the probe refuses to start without every precondition and sends nothing", async () => {
  const server = fakeServer();
  await assert.rejects(
    runProbe({ ...ok, confirm: "wrong" }, env, server.fetcher),
    /confirm/,
  );
  await assert.rejects(runProbe(ok, {}, server.fetcher), /COOKIE/);
  assert.equal(server.log.length, 0);
});
