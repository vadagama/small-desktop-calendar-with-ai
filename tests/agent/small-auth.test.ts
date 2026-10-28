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
