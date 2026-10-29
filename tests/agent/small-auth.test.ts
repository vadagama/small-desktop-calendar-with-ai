import { test } from "node:test";
import assert from "node:assert/strict";
import { SmallAuth, type AuthTransport } from "../../src/main/small-auth.js";
import type { SecretStore } from "../../src/main/profiles.js";

const token = (name: string) =>
  `header.${Buffer.from(JSON.stringify({ uid: name, name, preferred_username: name })).toString("base64url")}.signature`;
function setup() {
  let saved: string | null = null;
  let cookie = "";
  let user = "Employee A";
  let revoked = false;
  let expired = false;
  let offline = false;
  let denied = false;
  let refreshes = 0;
  const calls: string[] = [];
  const secrets: SecretStore = {
    get: async () => {
      if (denied) throw Error("sensitive keychain detail");
      return saved;
    },
    set: async (_key, value) => {
      if (denied) throw Error("sensitive keychain detail");
      saved = value;
    },
    remove: async () => {
      if (denied) throw Error("sensitive keychain detail");
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
        if (body.password !== "synthetic-password")
          return new Response(null, { status: 401 });
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

test("expired access refreshes once; revoked refresh clears saved session", async () => {
  const f = setup();
  await f.auth.login(login);
  f.expire();
  assert.equal((await f.auth.read()).status, "signed-in");
  assert.equal(f.refreshes(), 1);
  f.revoke();
  assert.equal((await f.auth.read()).status, "signed-out");
  assert.equal(f.saved(), null);
});

test("logout clears local access even when the server is unavailable", async () => {
  const f = setup();
  await f.auth.login(login);
  f.offline();
  const state = await f.auth.logout();
  assert.equal(state.status, "signed-out");
  assert.ok(state.warning);
  assert.equal(f.saved(), null);
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
  assert.equal(f.saved(), null);
});

test("Keychain refusal blocks login and hides internal errors", async () => {
  const f = setup();
  f.deny();
  await assert.rejects(f.auth.login(login), /Keychain/);
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
  assert.equal(f.saved(), null);
});

test("queued logout cannot be undone by an earlier profile refresh", async () => {
  const f = setup();
  await f.auth.login(login);
  f.expire();
  const [read, logout] = await Promise.all([f.auth.read(), f.auth.logout()]);
  assert.equal(read.status, "signed-in");
  assert.equal(logout.status, "signed-out");
  assert.equal(f.saved(), null);
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

test("calendar creation checks the account and never refreshes/replays a rejected POST", async () => {
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
    (await f.auth.createCalendarEvent("employee-a", body)).status,
    401,
  );
  assert.equal(writes, 1);
  assert.ok(!f.calls.includes("/gate/auth/refresh"));
  await assert.rejects(
    f.auth.createCalendarEvent("employee-a", { ...body, force: true }),
  );
  assert.equal(writes, 1);
});

test("event mutation authenticates the account and sends DELETE once without refresh replay", async () => {
  const f = setup();
  await f.auth.login({
    username: "employee-a",
    password: "synthetic-password",
  });
  let writes = 0;
  const original = f.transport.request;
  f.transport.request = async (path, init) => {
    if (path === "/gate/team/api/calendar/events/42") {
      assert.equal(init.method, "DELETE");
      assert.equal(init.body, undefined);
      writes++;
      return new Response(null, { status: 401 });
    }
    return original(path, init);
  };
  await assert.rejects(
    f.auth.mutateCalendarEvent(
      "other",
      "/gate/team/api/calendar/events/42",
      "DELETE",
    ),
  );
  assert.equal(writes, 0);
  assert.equal(
    (
      await f.auth.mutateCalendarEvent(
        "employee-a",
        "/gate/team/api/calendar/events/42",
        "DELETE",
      )
    ).status,
    401,
  );
  assert.equal(writes, 1);
  assert.ok(!f.calls.includes("/gate/auth/refresh"));
  await assert.rejects(
    f.auth.mutateCalendarEvent(
      "employee-a",
      "/gate/team/api/calendar/events/42/cancel",
      "DELETE",
    ),
  );
  assert.equal(writes, 1);
});
