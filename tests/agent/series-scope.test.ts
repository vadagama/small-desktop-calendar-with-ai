import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decideSeriesOperation,
  defaultSeriesScope,
  describeScope,
  legacyOccurrenceKey,
  occurrenceKey,
  originalDateOf,
  scopeLabels,
  seriesOperationMatrix,
  seriesOperations,
  seriesScopes,
  type OccurrenceInput,
  type SeriesOperation,
  type SeriesScope,
} from "../../src/shared/series-scope.js";

// Almaty is UTC+5. "Today" below is 2026-10-29 local time.
const now = "2026-10-29T05:00:00Z";
const future: OccurrenceInput = {
  seriesId: "43",
  originalDate: "2026-11-05",
  startsAt: "2026-11-05T05:00:00Z",
  endsAt: "2026-11-05T06:00:00Z",
};
const decide = (
  operation: SeriesOperation,
  scope: SeriesScope,
  occurrence: OccurrenceInput = future,
  more: { newStartsAt?: string; newEndsAt?: string; now?: string } = {},
) => decideSeriesOperation({ operation, scope, occurrence, now, ...more });
const move = {
  newStartsAt: "2026-11-05T07:00:00Z",
  newEndsAt: "2026-11-05T08:00:00Z",
};

test("the default scope is a single occurrence and both scopes are explicit", () => {
  assert.equal(defaultSeriesScope, "occurrence");
  assert.deepEqual([...seriesScopes], ["occurrence", "following"]);
  assert.equal(scopeLabels.occurrence, "Только это вхождение");
  assert.equal(scopeLabels.following, "Это и последующие");
});

test("the occurrence key stays the same after a move while the legacy key changes", () => {
  const original = occurrenceKey(future);
  const moved = occurrenceKey({
    ...future,
    startsAt: "2026-11-06T09:00:00Z",
  } as OccurrenceInput);
  assert.equal(original, "series:43:2026-11-05");
  assert.equal(moved, original);
  assert.notEqual(
    legacyOccurrenceKey("43", future.startsAt),
    legacyOccurrenceKey("43", "2026-11-06T09:00:00Z"),
  );
  assert.equal(
    legacyOccurrenceKey("43", future.startsAt),
    `series:43:${Date.parse(future.startsAt)}`,
  );
  assert.notEqual(
    occurrenceKey({ seriesId: "43", originalDate: "2026-11-12" }),
    original,
  );
  assert.notEqual(
    occurrenceKey({ seriesId: "44", originalDate: "2026-11-05" }),
    original,
  );
  assert.equal(originalDateOf("2026-11-05T19:30:00Z"), "2026-11-06");
});

test("malformed series ids and dates are rejected", () => {
  for (const ref of [
    { seriesId: "", originalDate: "2026-11-05" },
    { seriesId: "a/b", originalDate: "2026-11-05" },
    { seriesId: "x".repeat(129), originalDate: "2026-11-05" },
    { seriesId: "43", originalDate: "2026-02-30" },
    { seriesId: "43", originalDate: "05.11.2026" },
  ])
    assert.throws(() => occurrenceKey(ref));
  const result = decide("rename", "occurrence", {
    ...future,
    seriesId: "a/b",
  });
  assert.ok(!result.allowed && result.reason === "unknown-identity");
});

test("every supported combination is allowed and the matrix matches the decisions", () => {
  assert.equal(
    seriesOperationMatrix.length,
    seriesOperations.length * seriesScopes.length,
  );
  for (const row of seriesOperationMatrix) {
    const result = decide(
      row.operation,
      row.scope,
      future,
      row.operation === "move" ? move : {},
    );
    assert.equal(
      result.allowed,
      row.supported,
      `${row.operation}/${row.scope}`,
    );
    if (!result.allowed) assert.equal(result.reason, "unsupported-scope");
  }
  const refused = decide("delete", "following");
  assert.ok(!refused.allowed && refused.reason === "unsupported-scope");
});

test("virtual occurrences need materialization and extra server facts", () => {
  const virtual = decide("rename", "occurrence");
  assert.ok(virtual.allowed && virtual.materialize);
  assert.deepEqual(virtual.requires, ["A2", "A3", "A4", "A8"]);
  const own = decide("rename", "occurrence", { ...future, eventId: "900" });
  assert.ok(own.allowed && !own.materialize);
  assert.deepEqual(own.requires, ["A3", "A4", "A8"]);
  const following = decide("move", "following", future, move);
  assert.ok(following.allowed);
  assert.deepEqual(following.requires, ["A2", "A3", "A4", "A8", "A5", "A6"]);
  const removal = decide("delete", "occurrence", { ...future, eventId: "900" });
  assert.ok(removal.allowed);
  assert.deepEqual(removal.requires, ["A7", "A9"]);
});

test("following starts at the selected date and never includes the past", () => {
  for (const operation of ["rename", "move"] as const) {
    const result = decide(
      operation,
      "following",
      future,
      operation === "move" ? move : {},
    );
    assert.ok(result.allowed);
    assert.deepEqual(result.affects, {
      from: "2026-11-05",
      includesPast: false,
    });
  }
});

test("past occurrences are never changed, by original date or by current time", () => {
  const past: OccurrenceInput = {
    seriesId: "43",
    originalDate: "2026-10-28",
    startsAt: "2026-10-28T05:00:00Z",
    endsAt: "2026-10-28T06:00:00Z",
  };
  for (const operation of ["rename", "delete"] as const) {
    for (const scope of seriesScopes) {
      if (operation === "delete" && scope === "following") continue;
      const result = decide(operation, scope, past);
      assert.ok(!result.allowed && result.reason === "past");
    }
  }
  const movedEarlier: OccurrenceInput = {
    ...future,
    startsAt: "2026-10-20T05:00:00Z",
    endsAt: "2026-10-20T06:00:00Z",
  };
  const early = decide("rename", "occurrence", movedEarlier);
  assert.ok(!early.allowed && early.reason === "past");
  const movedBack = { ...future, originalDate: "2026-10-20" };
  const result = decide("rename", "occurrence", movedBack);
  assert.ok(!result.allowed && result.reason === "past");
  const today = decide("rename", "occurrence", {
    ...future,
    originalDate: "2026-10-29",
    startsAt: "2026-10-29T10:00:00Z",
    endsAt: "2026-10-29T11:00:00Z",
  });
  assert.ok(today.allowed);
});

test("the past is decided by the Almaty calendar day, not UTC", () => {
  // 2026-10-29T19:30Z is already 2026-10-30 00:30 in Almaty.
  const late = "2026-10-29T19:30:00Z";
  const thatDay: OccurrenceInput = {
    seriesId: "43",
    originalDate: "2026-10-29",
    startsAt: "2026-10-29T10:00:00Z",
    endsAt: "2026-10-29T11:00:00Z",
  };
  const result = decide("rename", "occurrence", thatDay, { now: late });
  assert.ok(!result.allowed && result.reason === "past");
  const sameDay = decide("rename", "occurrence", thatDay, {
    now: "2026-10-29T18:30:00Z",
  });
  assert.ok(sameDay.allowed);
});

test("a move needs a valid interval and cannot land in the past", () => {
  for (const patch of [
    {},
    { newStartsAt: move.newStartsAt },
    { newStartsAt: move.newEndsAt, newEndsAt: move.newStartsAt },
    { newStartsAt: move.newStartsAt, newEndsAt: move.newStartsAt },
    { newStartsAt: "garbage", newEndsAt: "garbage" },
  ]) {
    const result = decide("move", "occurrence", future, patch);
    assert.ok(!result.allowed && result.reason === "invalid-interval");
  }
  const toPast = decide("move", "occurrence", future, {
    newStartsAt: "2026-10-28T05:00:00Z",
    newEndsAt: "2026-10-28T06:00:00Z",
  });
  assert.ok(!toPast.allowed && toPast.reason === "move-to-past");
  assert.ok(decide("move", "occurrence", future, move).allowed);
  const broken = decide("rename", "occurrence", {
    ...future,
    endsAt: future.startsAt,
  });
  assert.ok(!broken.allowed && broken.reason === "invalid-interval");
});

test("the confirmation text states the scope, the date and what stays untouched", () => {
  assert.match(
    describeScope("occurrence", "2026-11-05"),
    /Только это вхождение: 2026-11-05/,
  );
  assert.match(
    describeScope("occurrence", "2026-11-05"),
    /Остальные встречи серии не изменятся/,
  );
  assert.match(
    describeScope("following", "2026-11-05"),
    /Это и последующие: с 2026-11-05/,
  );
  assert.match(
    describeScope("following", "2026-11-05"),
    /Прошедшие встречи не изменятся/,
  );
  assert.throws(() => describeScope("following", "not-a-date"));
});
