import { test } from "node:test";
import assert from "node:assert/strict";
import { SmallAuth, type AuthTransport } from "../../src/main/small-auth.js";
import { SmallAuthError } from "../../src/main/small-auth.js";
import type { SecretStore } from "../../src/main/profiles.js";

const token = (name: string) =>
  `header.${Buffer.from(JSON.stringify({ uid: name, name, preferred_username: name })).toString("base64url")}.signature`;
function setup() {
  let saved: string | null = null;
  let cookie = "";
  let user = "Employee A";
  let revoked = false;
  let passwordChanged = false;
  let expired = false;
  let offline = false;
  let denied = false;
  let refreshes = 0;
  const calls: string[] = [];
  const secrets: SecretStore = {
    get: async () => {
      if (denied) throw Error("sensitive storage detail");
      return saved;
    },
    set: async (_key, value) => {
      if (denied) throw Error("sensitive storage detail");
      saved = value;
    },
    remove: async () => {
      if (denied) throw Error("sensitive storage detail");
      saved = null;
    },
  };
  const transport: AuthTransport = {
    restore: async (value) => {
      cookie = value;
    },
    snapshot: async () => cookie,
    clear: async () => {
      cookie = "";
    },
    request: async (path, init) => {
      calls.push(path);
      if (offline) throw Error("sensitive network detail");
      if (path.endsWith("/login")) {
        const body = JSON.parse(String(init.body));
        if (passwordChanged || body.password !== "synthetic-password")
          return new Response(null, { status: 401 });
        revoked = false;
        expired = false;
        user = body.username;
        cookie = `synthetic-cookie-${user}`;
        return Response.json({ data: { access_token: token(user) } });
      }
      if (path.endsWith("/refresh")) {
        refreshes++;
        if (revoked || !cookie) return new Response(null, { status: 401 });
        expired = false;
        cookie += "-rotated";
        return Response.json({ data: { access_token: token(user) } });
      }
      if (path.endsWith("/logout")) return Response.json({});
      if (expired || revoked) return new Response(null, { status: 401 });
      return Response.json({ data: { avatar: null } });
    },
  };
  return {
    auth: new SmallAuth(transport, secrets),
    transport,
    secrets,
    calls,
    restart: () => new SmallAuth(transport, secrets),
    saved: () => saved,
    expire: () => {
      expired = true;
    },
    changePassword: () => {
      passwordChanged = true;
      revoked = true;
    },
    revoke: () => {
      revoked = true;
    },
    offline: () => {
      offline = true;
    },
    deny: () => {
      denied = true;
    },
    refreshes: () => refreshes,
  };
}
const login = { username: "employee-a", password: "synthetic-password" };

test("auth failures distinguish credentials, connectivity, service and permissions", async () => {
  for (const [status, kind] of [
    [403, "denied"],
    [503, "service"],
  ] as const) {
    const f = setup();
    await f.auth.login(login);
    const saved = f.saved();
    let required = false;
    f.auth.subscribeRequired(() => {
      required = true;
    });
    const request = f.transport.request;
    f.transport.request = (path, init) =>
      path.endsWith("/info")
        ? Promise.resolve(new Response(null, { status }))
        : request(path, init);
    await assert.rejects(
      f.auth.read(),
      (error) => error instanceof SmallAuthError && error.kind === kind,
    );
    assert.equal(required, false);
    assert.equal(f.saved(), saved);
  }
  const offline = setup();
  await offline.auth.login(login);
  offline.offline();
  await assert.rejects(
    offline.auth.read(),
    (error) => error instanceof SmallAuthError && error.kind === "network",
  );
  const badLogin = setup();
  await assert.rejects(
    badLogin.auth.login({ ...login, password: "wrong" }),
    (error) => error instanceof SmallAuthError && error.kind === "auth",
  );
});

test("session expiry notifies all consumers, but offline checks and refresh recovery do not", async () => {
  const f = setup();
  let required = 0;
  const unsubscribe = f.auth.subscribeRequired(() => required++);
  await f.auth.login(login);
  f.expire();
  await f.auth.read();
  assert.equal(required, 0);
  f.changePassword();
  assert.equal((await f.auth.read()).status, "signed-out");
  assert.ok(required > 0);
  unsubscribe();
  const before = required;
  await f.auth.read();
  assert.equal(required, before);
  const offline = setup();
  offline.auth.subscribeRequired(() => assert.fail("network is not expiry"));
  await offline.auth.login(login);
  offline.offline();
  await assert.rejects(offline.auth.read());
});

test("unauthorized writes recover the session without replay or sign-out", async () => {
  const f = setup();
  await f.auth.login(login);
  const original = f.transport.request;
  let writes = 0;
  f.transport.request = async (path, init) => {
    if (init.method === "DELETE") {
      writes++;
      return new Response(null, { status: 401 });
    }
    return original(path, init);
  };
  let required = false;
  f.auth.subscribeRequired(() => {
    required = true;
  });
  assert.equal(
    (await f.auth.deleteCalendarEvent("employee-a", "42")).headers.get(
      "X-Small-Session-Recovered",
    ),
    "true",
  );
  assert.equal(required, false);
  assert.equal(writes, 1);
  assert.equal((await f.auth.read()).status, "signed-in");
});

test("login verifies profile and returns only display identity, then restores through refresh", async () => {
  const f = setup();
  const state = await f.auth.login(login);
  assert.deepEqual(state, {
    status: "signed-in",
    profile: { id: "employee-a", name: "employee-a", username: "employee-a" },
  });
  assert.ok(f.calls.includes("/gate/team/api/user/info"));
  assert.equal(JSON.stringify(state).includes("synthetic-cookie"), false);
  assert.equal(f.saved()?.includes("synthetic-password"), false);
  assert.deepEqual(await f.restart().read(), state);
  assert.equal(f.refreshes(), 1);
});

test("expired access refreshes once; changed password clears saved session", async () => {
  const f = setup();
  await f.auth.login(login);
  f.expire();
  assert.equal((await f.auth.read()).status, "signed-in");
  assert.equal(f.refreshes(), 1);
  f.changePassword();
  assert.equal((await f.auth.read()).status, "signed-out");
  assert.equal(JSON.parse(f.saved()!).session, null);
});

test("logout clears local access even when the server is unavailable", async () => {
  const f = setup();
  await f.auth.login(login);
  f.offline();
  const state = await f.auth.logout();
  assert.equal(state.status, "signed-out");
  assert.ok(state.warning);
  assert.equal(JSON.parse(f.saved()!).session, null);
  assert.equal((await f.restart().read()).status, "signed-out");
});

test("switching accounts and invalid login cannot retain previous profile", async () => {
  const f = setup();
  await f.auth.login(login);
  const next = await f.auth.login({ ...login, username: "employee-b" });
  assert.equal(next.status === "signed-in" && next.profile.id, "employee-b");
  await assert.rejects(
    f.auth.login({ ...login, password: "wrong" }),
    /Логин или пароль/,
  );
  assert.equal((await f.auth.read()).status, "signed-out");
  assert.equal(JSON.parse(f.saved()!).session, null);
});

test("local storage refusal blocks login and hides internal errors", async () => {
  const f = setup();
  f.deny();
  await assert.rejects(f.auth.login(login), /локальн/);
  assert.equal(f.calls.length, 0);
});

test("invalid inputs cannot reach the network", async () => {
  const f = setup();
  await assert.rejects(f.auth.login({ username: "", password: "x" }), /логин/);
  await assert.rejects(
    f.auth.login({ ...login, endpoint: "https://evil.invalid" }),
    /логин/,
  );
  assert.equal(f.calls.length, 0);
});

test("offline profile check reports an error without destroying recoverable session", async () => {
  const f = setup();
  await f.auth.login(login);
  const before = f.saved();
  f.offline();
  await assert.rejects(f.auth.read(), /Small/);
  assert.equal(f.saved(), before);
});

test("local logout invalidates persisted credentials even if cookie cleanup fails", async () => {
  const f = setup();
  await f.auth.login(login);
  f.transport.clear = async () => {
    throw Error("synthetic cookie cleanup failure");
  };
  await assert.rejects(f.auth.logout());
  assert.equal(JSON.parse(f.saved()!).session, null);
});

test("queued logout cannot be undone by an earlier profile refresh", async () => {
  const f = setup();
  await f.auth.login(login);
  f.expire();
  const [read, logout] = await Promise.all([f.auth.read(), f.auth.logout()]);
  assert.equal(read.status, "signed-in");
  assert.equal(logout.status, "signed-out");
  assert.equal(JSON.parse(f.saved()!).session, null);
  assert.equal((await f.auth.read()).status, "signed-out");
});

test("calendar reads reject another account before any calendar request", async () => {
  const f = setup();
  await f.auth.login(login);
  let requested = false;
  await assert.rejects(
    f.auth.readCalendar("employee-b", async (get) => {
      requested = true;
      return get("/gate/team/api/calendars/public");
    }),
    /аккаунт/,
  );
  assert.equal(requested, false);
});

test("a pending calendar response is invalidated as soon as logout is requested", async () => {
  const f = setup();
  await f.auth.login(login);
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = f.auth.readCalendar("employee-a", async () => {
    entered();
    await held;
    return "private synthetic event";
  });
  await started;
  const logout = f.auth.logout();
  release();
  await assert.rejects(read, /аккаунт|сесси/);
  assert.equal((await logout).status, "signed-out");
});

test("availability POST refresh preserves body and cannot become an event write", async () => {
  const f = setup();
  await f.auth.login(login);
  const request = f.transport.request;
  const body = {
    participant_ids: ["synthetic-a"],
    date: "2026-10-29",
    timezone: "Asia/Almaty",
  };
  const sent: RequestInit[] = [];
  f.transport.request = async (path, init) => {
    if (path.endsWith("/busy-intervals")) {
      sent.push(init);
      return sent.length === 1
        ? new Response(null, { status: 401 })
        : Response.json({ data: [] });
    }
    return request(path, init);
  };
  await f.auth.readCalendar("employee-a", (get) =>
    get("/gate/team/api/calendar/events/busy-intervals", body),
  );
  assert.equal(sent.length, 2);
  for (const init of sent) {
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(String(init.body)), body);
  }
  const before = f.calls.length;
  await assert.rejects(
    f.auth.readCalendar("employee-a", (get) =>
      get("/gate/team/api/calendar/events", body),
    ),
    /недоступна/,
  );
  assert.equal(
    f.calls.slice(before).includes("/gate/team/api/calendar/events"),
    false,
  );
});

test("calendar domain failures retain safe kinds and messages across session boundary", async () => {
  const { CalendarError } = await import("../../src/main/calendar.js");
  const f = setup();
  await f.auth.login(login);
  await assert.rejects(
    f.auth.readCalendar("employee-a", async () => {
      throw new CalendarError("invalid", "Занятость неизвестна.");
    }),
    (error: unknown) =>
      error instanceof CalendarError &&
      error.kind === "invalid" &&
      error.message === "Занятость неизвестна.",
  );
});

test("calendar creation checks the account and never replays a rejected POST", async () => {
  const { meetingCreatePath } =
    await import("../../src/main/meeting-request.js");
  const f = setup();
  await f.auth.login({
    username: "employee-a",
    password: "synthetic-password",
  });
  let writes = 0;
  const original = f.transport.request;
  f.transport.request = async (path, init) => {
    if (path === meetingCreatePath) {
      writes++;
      return new Response(null, { status: 401 });
    }
    return original(path, init);
  };
  const body = {
    title: "Test",
    description: "",
    location: "",
    starts_at: "2099-10-29T09:30:00+05:00",
    ends_at: "2099-10-29T10:00:00+05:00",
    timezone: "Asia/Almaty",
    is_recurring: false,
    is_public: false,
    participant_ids: ["synthetic-a"],
    notification_recipient_ids: [],
    attachments: [],
  };
  await assert.rejects(f.auth.createCalendarEvent("other", body));
  assert.equal(writes, 0);
  assert.equal(
    (await f.auth.createCalendarEvent("employee-a", body)).headers.get(
      "X-Small-Session-Recovered",
    ),
    "true",
  );
  assert.equal(writes, 1);
  assert.equal(f.refreshes(), 1);
  await assert.rejects(
    f.auth.createCalendarEvent("employee-a", { ...body, force: true }),
  );
  assert.equal(writes, 1);
});

test("calendar updates and replies send JSON bodies once without replaying an unauthorized write", async () => {
  const f = setup();
  await f.auth.login(login);
  const received: {
    path: string;
    method: string | undefined;
    body: unknown;
  }[] = [];
  const original = f.transport.request;
  f.transport.request = async (path, init) => {
    if (init.method === "PUT" || init.method === "PATCH") {
      received.push({
        path,
        method: init.method,
        body: JSON.parse(String(init.body)),
      });
      return new Response(null, { status: 401 });
    }
    return original(path, init);
  };
  const body = {
    title: "Synthetic",
    description: "",
    location: "",
    starts_at: "2099-10-29T09:00:00+05:00",
    ends_at: "2099-10-29T10:00:00+05:00",
    timezone: "Asia/Almaty",
    is_recurring: false as const,
    is_public: false,
    calendar_ids: [],
    participant_ids: ["employee-a"],
    notification_recipient_ids: [],
    attachments: [],
  };
  assert.equal(
    (await f.auth.updateCalendarEvent("employee-a", "42", body)).headers.get(
      "X-Small-Session-Recovered",
    ),
    "true",
  );
  await f.auth.login(login);
  assert.equal(
    (
      await f.auth.respondCalendarEvent("employee-a", "42", "accepted")
    ).headers.get("X-Small-Session-Recovered"),
    "true",
  );
  assert.equal(received.length, 2);
  assert.deepEqual(received[0]?.body, body);
  assert.deepEqual(received[1]?.body, { status: "accepted" });
  assert.equal(f.refreshes(), 2);
});

test("series writes are validated, sent once with exact routes and never replayed on 401", async () => {
  const f = setup();
  await f.auth.login(login);
  const received: {
    path: string;
    method: string | undefined;
    body: unknown;
  }[] = [];
  const original = f.transport.request;
  f.transport.request = async (path, init) => {
    if (
      !path.startsWith("/gate/auth/") &&
      (init.method === "POST" || init.method === "PUT")
    ) {
      received.push({
        path,
        method: init.method,
        body: JSON.parse(String(init.body)),
      });
      return new Response(null, { status: 401 });
    }
    return original(path, init);
  };
  const body = {
    title: "Серия",
    description: "",
    location: "",
    starts_at: "2099-10-29T09:00:00+05:00",
    ends_at: "2099-10-29T10:00:00+05:00",
    timezone: "Asia/Almaty",
    is_recurring: true as const,
    recurrence_rule: { FREQ: "WEEKLY", BYDAY: ["TH"], UNTIL: "2099-12-31" },
    recurrence_type: "custom" as const,
    recurring_edit_type: "all-next" as const,
    is_public: false,
    calendar_ids: [],
    participant_ids: ["employee-a"],
    notification_recipient_ids: [],
    attachments: [],
  };
  assert.equal(
    (
      await f.auth.materializeCalendarEvent("employee-a", "43", "2099-10-29")
    ).headers.get("X-Small-Session-Recovered"),
    "true",
  );
  await f.auth.login(login);
  assert.equal(
    (
      await f.auth.updateSeriesCalendarEvent("employee-a", "900", body)
    ).headers.get("X-Small-Session-Recovered"),
    "true",
  );
  await f.auth.login(login);
  assert.equal(
    (
      await f.auth.cancelCalendarEvent("employee-a", "900", "Отмена")
    ).headers.get("X-Small-Session-Recovered"),
    "true",
  );
  assert.deepEqual(
    received.map((r) => [r.method, r.path]),
    [
      ["POST", "/gate/team/api/calendar/events/from-template"],
      ["PUT", "/gate/team/api/calendar/events/900?force=false"],
      ["POST", "/gate/team/api/calendar/events/900/cancel"],
    ],
  );
  assert.deepEqual(received[0]?.body, {
    original_event_id: "43",
    date: "2099-10-29",
  });
  assert.deepEqual(received[1]?.body, body);
  assert.deepEqual(received[2]?.body, { reason: "Отмена" });
  assert.equal(f.refreshes(), 3);
  const before = received.length;
  for (const bad of [
    () => f.auth.materializeCalendarEvent("employee-a", "a/b", "2099-10-29"),
    () => f.auth.materializeCalendarEvent("employee-a", "43", "tomorrow"),
    () => f.auth.updateSeriesCalendarEvent("employee-a", "9/0", body),
    () =>
      f.auth.updateSeriesCalendarEvent("employee-a", "900", {
        ...body,
        is_recurring: false,
      } as never),
    () =>
      f.auth.updateSeriesCalendarEvent("employee-a", "900", {
        ...body,
        recurring_edit_type: "all",
      } as never),
    () => f.auth.cancelCalendarEvent("employee-a", "900", ""),
    () => f.auth.cancelCalendarEvent("employee-a", "../x", "r"),
    () => f.auth.cancelCalendarEvent("other-account", "900", "r"),
    () => f.auth.materializeCalendarEvent("other-account", "43", "2099-10-29"),
  ])
    await assert.rejects(bad());
  assert.equal(received.length, before);
});

test("expired refresh requires a password once and stays signed out after restart", async () => {
  const f = setup();
  await f.auth.login(login);
  f.revoke();
  let required = 0;
  const restarted = f.restart();
  restarted.subscribeRequired(() => required++);
  assert.equal((await restarted.read()).status, "signed-out");
  assert.equal(f.calls.filter((p) => p.endsWith("/login")).length, 1);
  assert.ok(required > 0);
  const calls = f.calls.length;
  assert.equal((await f.restart().read()).status, "signed-out");
  assert.equal(f.calls.length, calls);
});

test("refresh server failures never trigger password login or delete saved credentials", async () => {
  const f = setup();
  await f.auth.login(login);
  f.expire();
  const before = f.saved();
  const request = f.transport.request;
  f.transport.request = (path, init) =>
    path.endsWith("/refresh")
      ? Promise.resolve(new Response(null, { status: 503 }))
      : request(path, init);
  await assert.rejects(f.auth.read());
  assert.equal(f.saved(), before);
  assert.equal(f.calls.filter((p) => p.endsWith("/login")).length, 1);
});

test("refresh refuses a changed account identity and drops the session", async () => {
  const f = setup();
  await f.auth.login(login);
  f.expire();
  const request = f.transport.request;
  f.transport.request = async (path, init) =>
    path.endsWith("/refresh")
      ? Response.json({ data: { access_token: token("other") } })
      : request(path, init);
  await assert.rejects(f.auth.read(), /аккаунт/);
  assert.equal(JSON.parse(f.saved()!).session, null);
});

test("legacy cookie-only sessions restore without inventing saved credentials", async () => {
  const f = setup();
  await f.auth.login(login);
  const legacy = JSON.parse(f.saved()!).session;
  await f.secrets.set("small-auth-session-v1", legacy);
  const restarted = f.restart();
  assert.equal((await restarted.read()).status, "signed-in");
  f.revoke();
  assert.equal((await restarted.read()).status, "signed-out");
  assert.equal(f.calls.filter((p) => p.endsWith("/login")).length, 1);
});

test("concurrent reads stop after rejected refresh and never try password login", async () => {
  const f = setup();
  await f.auth.login(login);
  f.revoke();
  const states = await Promise.all([
    f.auth.read(),
    f.auth.read(),
    f.auth.read(),
  ]);
  assert.ok(states.every((state) => state.status === "signed-out"));
  assert.equal(f.calls.filter((p) => p.endsWith("/login")).length, 1);
  f.revoke();
  const [, loggedOut] = await Promise.all([f.auth.read(), f.auth.logout()]);
  assert.equal(loggedOut.status, "signed-out");
  assert.equal(JSON.parse(f.saved()!).session, null);
  assert.equal((await f.restart().read()).status, "signed-out");
});

test("a write rejected before a failed refresh retains explicit rejection and recoverable credentials", async () => {
  const { calendarJson, CalendarError } =
    await import("../../src/main/calendar.js");
  const f = setup();
  await f.auth.login(login);
  const saved = f.saved();
  const original = f.transport.request;
  f.transport.request = (path, init) =>
    init.method === "DELETE"
      ? Promise.resolve(new Response(null, { status: 401 }))
      : path.endsWith("/refresh")
        ? Promise.resolve(new Response(null, { status: 503 }))
        : original(path, init);
  const response = await f.auth.deleteCalendarEvent("employee-a", "42");
  assert.equal(response.status, 401);
  await assert.rejects(
    calendarJson(response),
    (error: unknown) =>
      error instanceof CalendarError &&
      error.kind === "network" &&
      /Повторите действие/.test(error.message),
  );
  assert.equal(f.saved(), saved);
});

test("password is never persisted; expired refresh preserves username without automatic login", async () => {
  const f = setup();
  await f.auth.login(login);
  assert.equal(f.saved()?.includes(login.password), false);
  f.revoke();
  assert.deepEqual(await f.restart().read(), {
    status: "signed-out",
    username: "employee-a",
    reason: "expired",
  });
  assert.equal(f.calls.filter((p) => p.endsWith("/login")).length, 1);
  assert.equal(JSON.parse(f.saved()!).session, null);
  assert.deepEqual(await f.restart().read(), {
    status: "signed-out",
    username: "employee-a",
    reason: "expired",
  });
});

test("legacy password is removed before an offline refresh while cookies and username survive", async () => {
  const f = setup();
  await f.auth.login(login);
  const session = JSON.parse(f.saved()!).session;
  await f.secrets.set(
    "small-auth-session-v1",
    JSON.stringify({
      version: 2,
      session,
      login: { ...login, accountId: "employee-a" },
    }),
  );
  f.offline();
  await assert.rejects(f.restart().read());
  const saved = JSON.parse(f.saved()!);
  assert.equal(saved.version, 3);
  assert.equal(saved.username, "employee-a");
  assert.equal(saved.session, session);
  assert.equal(f.saved()?.includes(login.password), false);
});

test("logout before restoration removes legacy password but remembers username across restart", async () => {
  const f = setup();
  await f.auth.login(login);
  await f.secrets.set(
    "small-auth-session-v1",
    JSON.stringify({
      version: 2,
      session: JSON.parse(f.saved()!).session,
      login: { ...login, accountId: "employee-a" },
    }),
  );
  await f.restart().logout();
  assert.deepEqual(await f.restart().read(), {
    status: "signed-out",
    username: "employee-a",
  });
  assert.equal(JSON.parse(f.saved()!).session, null);
  assert.equal(f.saved()?.includes(login.password), false);
});

test("no intermediate login snapshot contains the password, even if profile verification fails", async () => {
  const f = setup();
  const set = f.secrets.set;
  const snapshots: string[] = [];
  f.secrets.set = async (key, value) => {
    snapshots.push(value);
    await set(key, value);
  };
  const request = f.transport.request;
  f.transport.request = (path, init) =>
    path.endsWith("/info")
      ? Promise.resolve(new Response(null, { status: 503 }))
      : request(path, init);
  await assert.rejects(f.auth.login(login));
  assert.ok(snapshots.length > 0);
  assert.ok(
    snapshots.every(
      (value) =>
        !value.includes(login.password) && !value.includes('"password"'),
    ),
  );
  assert.deepEqual(await f.restart().read(), {
    status: "signed-out",
    username: login.username,
  });
});

test("failed legacy migration blocks the network and can be retried without losing the session", async () => {
  const f = setup();
  await f.auth.login(login);
  const legacy = JSON.stringify({
    version: 2,
    session: JSON.parse(f.saved()!).session,
    login: { ...login, accountId: "employee-a" },
  });
  await f.secrets.set("small-auth-session-v1", legacy);
  const set = f.secrets.set;
  f.secrets.set = async () => {
    throw Error("synthetic disk failure");
  };
  const before = f.calls.length;
  const restarted = f.restart();
  await assert.rejects(
    restarted.read(),
    (error) => error instanceof SmallAuthError && error.kind === "storage",
  );
  assert.equal(f.calls.length, before);
  assert.equal(f.saved(), legacy);
  f.secrets.set = set;
  assert.equal((await restarted.read()).status, "signed-in");
  assert.equal(f.saved()?.includes(login.password), false);
});
