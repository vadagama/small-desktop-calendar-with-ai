import assert from "node:assert/strict";
import { test } from "node:test";
import { SeriesController } from "../../src/main/series-controller.js";
import { CalendarError } from "../../src/main/calendar.js";
import { SmallAuthError } from "../../src/main/small-auth.js";
import { isSeriesApproval } from "../../src/main/series-contract.js";
import type { SeriesRequest } from "../../src/shared/series-scope.js";
import type { SmallAuthState } from "../../src/shared/small-auth.js";

const now = "2026-10-29T05:00:00Z";
const evidence = Object.fromEntries(
  ["A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9"].map((a) => [
    a,
    { verifiedOn: "2026-11-01" },
  ]),
);
const signedIn = (participantId?: string): SmallAuthState => ({
  status: "signed-in",
  profile: {
    id: "acc",
    name: "Я",
    username: "me",
    ...(participantId ? { participantId } : {}),
  },
});
const base: SeriesRequest = {
  accountId: "acc",
  operation: "rename",
  scope: "occurrence",
  seriesId: "43",
  originalDate: "2026-11-05",
  beforeStart: "2026-11-05T05:00:00Z",
  beforeEnd: "2026-11-05T06:00:00Z",
  title: "Новая",
};
function setup(state: SmallAuthState = signedIn("person-me"), open = false) {
  const calls: unknown[] = [];
  const service = {
    apply: async (input: unknown) => {
      calls.push(input);
      return {
        status: "applied" as const,
        materialized: true,
        verifiedWindow: { from: "2026-10-22", to: "2027-01-28" },
      };
    },
  };
  const controller = new SeriesController(
    { read: async () => state },
    service,
    () => now,
    open ? evidence : {},
  );
  return { controller, calls };
}

test("requests are strict: unknown fields, a missing title or mismatched parameters are rejected", async () => {
  const { controller, calls } = setup(undefined, true);
  const bad: Record<string, unknown>[] = [
    { ...base, approval: "token" },
    { ...base, title: undefined },
    {
      ...base,
      newStartsAt: "2026-11-05T07:00:00Z",
      newEndsAt: "2026-11-05T08:00:00Z",
    },
    { ...base, operation: "move" },
    {
      ...base,
      operation: "move",
      title: undefined,
      newStartsAt: "2026-11-05T07:00:00Z",
    },
    { ...base, operation: "delete" },
    { ...base, originalDate: "2026-02-30" },
    { ...base, seriesId: "a/b" },
    { ...base, scope: "all" },
    { ...base, operation: "purge" },
    { ...base, beforeStart: "yesterday" },
    { ...base, title: " " },
  ];
  for (const input of bad) {
    await assert.rejects(controller.gate(input), (e) => e instanceof Error);
    await assert.rejects(controller.apply(input), (e) => e instanceof Error);
  }
  assert.deepEqual(calls, []);
});

test("with no confirmed server contract the gate is closed, explains why and carries no token", async () => {
  const { controller, calls } = setup();
  const state = await controller.gate(base);
  assert.equal(state.open, false);
  assert.equal(state.reason, "contract-unverified");
  assert.match(state.message, /не подтверждено проверкой на тестовой среде/);
  assert.match(state.summary, /Только это вхождение: 2026-11-05/);
  assert.deepEqual(Object.keys(state).sort(), [
    "message",
    "open",
    "reason",
    "summary",
  ]);
  await assert.rejects(
    controller.apply(base),
    (e) =>
      e instanceof CalendarError &&
      e.kind === "denied" &&
      /не подтверждено/.test(e.message),
  );
  assert.deepEqual(calls, []);
});

test("policy refusals keep their own reason and do not call the service", async () => {
  const { controller, calls } = setup(undefined, true);
  const past = {
    ...base,
    originalDate: "2026-10-01",
    beforeStart: "2026-10-01T05:00:00Z",
    beforeEnd: "2026-10-01T06:00:00Z",
  };
  const state = await controller.gate(past);
  assert.deepEqual([state.open, state.reason], [false, "past"]);
  await assert.rejects(
    controller.apply(past),
    (e) => e instanceof CalendarError && e.kind === "invalid",
  );
  const unsupported = await controller.gate({
    ...base,
    operation: "delete",
    scope: "following",
    title: undefined,
  });
  assert.equal(unsupported.reason, "unsupported-scope");
  assert.deepEqual(calls, []);
});

test("an open gate hands a gate-issued approval, the session participant and the change to the service", async () => {
  const { controller, calls } = setup(undefined, true);
  const state = await controller.gate(base);
  assert.deepEqual([state.open, state.reason], [true, undefined]);
  assert.deepEqual(Object.keys(state).sort(), ["message", "open", "summary"]);
  assert.ok(!JSON.stringify(state).includes("approval"));
  const result = await controller.apply({ ...base, eventId: "900" });
  assert.deepEqual(result, { status: "applied", materialized: true });
  assert.equal(calls.length, 1);
  const call = calls[0] as {
    accountId: string;
    participantId: string;
    approval: {
      occurrence: { eventId?: string; startsAt: string };
      operation: string;
    };
    change: unknown;
  };
  assert.equal(call.accountId, "acc");
  assert.equal(call.participantId, "person-me");
  assert.ok(isSeriesApproval(call.approval));
  assert.equal(call.approval.occurrence.eventId, "900");
  assert.equal(call.approval.occurrence.startsAt, base.beforeStart);
  assert.deepEqual(call.change, { kind: "rename", title: "Новая" });
  await controller.apply({
    ...base,
    operation: "move",
    scope: "following",
    title: undefined,
    newStartsAt: "2026-11-05T07:00:00Z",
    newEndsAt: "2026-11-05T08:00:00Z",
  });
  const moved = calls[1] as {
    change: unknown;
    approval: { scope: string; newStartsAt: string };
  };
  assert.deepEqual(moved.change, { kind: "move" });
  assert.equal(moved.approval.scope, "following");
  assert.equal(moved.approval.newStartsAt, "2026-11-05T07:00:00Z");
  await controller.apply({ ...base, operation: "delete", title: undefined });
  assert.deepEqual((calls[2] as { change: unknown }).change, {
    kind: "delete",
  });
});

test("the account and participant are taken from the signed-in session, not from the renderer", async () => {
  for (const state of [
    { status: "signed-out" } as SmallAuthState,
    signedIn("person-me"),
  ]) {
    const { controller, calls } = setup(state, true);
    const wrong = { ...base, accountId: "other" };
    await assert.rejects(
      controller.apply(wrong),
      (e) => e instanceof SmallAuthError && e.code === "auth",
    );
    await assert.rejects(
      controller.gate(wrong),
      (e) => e instanceof SmallAuthError,
    );
    assert.deepEqual(calls, []);
  }
  const { controller, calls } = setup(signedIn(), true);
  await assert.rejects(
    controller.apply(base),
    (e) => e instanceof CalendarError && /профиль участника/.test(e.message),
  );
  await assert.rejects(controller.gate(base), /профиль участника/);
  assert.deepEqual(calls, []);
});
