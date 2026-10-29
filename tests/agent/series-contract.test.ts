import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import {
  assertApproval,
  gateSeriesOperation,
  isSeriesApproval,
  seriesContractEvidence,
} from "../../src/main/series-contract.js";
import {
  seriesOperationMatrix,
  type ContractAssumption,
  type OccurrenceInput,
} from "../../src/shared/series-scope.js";

const now = "2026-10-29T05:00:00Z";
const virtual: OccurrenceInput = {
  seriesId: "43",
  originalDate: "2026-11-05",
  startsAt: "2026-11-05T05:00:00Z",
  endsAt: "2026-11-05T06:00:00Z",
};
const own: OccurrenceInput = { ...virtual, eventId: "900" };
const move = {
  newStartsAt: "2026-11-05T07:00:00Z",
  newEndsAt: "2026-11-05T08:00:00Z",
};
const evidence = (...assumptions: ContractAssumption[]) =>
  Object.fromEntries(assumptions.map((a) => [a, { verifiedOn: "2026-11-01" }]));

test("with the shipped evidence every supported series operation is closed with an explanation", () => {
  for (const row of seriesOperationMatrix.filter((r) => r.supported)) {
    const gate = gateSeriesOperation({
      operation: row.operation,
      scope: row.scope,
      occurrence: virtual,
      ...(row.operation === "move" ? move : {}),
      now,
    });
    assert.equal(gate.open, false, `${row.operation}/${row.scope}`);
    if (gate.open) continue;
    assert.equal(gate.reason, "contract-unverified");
    assert.ok(gate.missing.length > 0);
    assert.match(gate.message, /не подтверждено проверкой на тестовой среде/);
    assert.match(gate.message, /Обычные встречи работают как раньше/);
    assert.ok(!/\bA\d\b/.test(gate.message), "no internal codes for the user");
  }
});

test("the message names the blocked operation and scope, not the whole calendar", () => {
  const rename = gateSeriesOperation({
    operation: "rename",
    scope: "occurrence",
    occurrence: virtual,
    now,
  });
  const following = gateSeriesOperation({
    operation: "move",
    scope: "following",
    occurrence: virtual,
    ...move,
    now,
  });
  assert.ok(
    !rename.open &&
      /^Переименование \(только это вхождение\)/.test(rename.message),
  );
  assert.ok(
    !following.open && /^Перенос \(это и последующие\)/.test(following.message),
  );
});

test("policy refusals are reported as such, before the contract", () => {
  const past = gateSeriesOperation({
    operation: "rename",
    scope: "occurrence",
    occurrence: { ...virtual, originalDate: "2026-10-01" },
    now,
  });
  assert.ok(!past.open && past.reason === "past" && past.missing.length === 0);
  const unsupported = gateSeriesOperation({
    operation: "delete",
    scope: "following",
    occurrence: virtual,
    now,
  });
  assert.ok(!unsupported.open && unsupported.reason === "unsupported-scope");
  const toPast = gateSeriesOperation({
    operation: "move",
    scope: "occurrence",
    occurrence: virtual,
    newStartsAt: "2026-10-01T05:00:00Z",
    newEndsAt: "2026-10-01T06:00:00Z",
    now,
  });
  assert.ok(!toPast.open && toPast.reason === "move-to-past");
  // Even full evidence cannot open a refused combination.
  const all = evidence("A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9");
  const stillClosed = gateSeriesOperation(
    {
      operation: "delete",
      scope: "following",
      occurrence: virtual,
      now,
    },
    all,
  );
  assert.equal(stillClosed.open, false);
});

test("evidence opens exactly the operations whose assumptions are all confirmed", () => {
  const base = evidence("A3", "A4", "A8");
  const gate = (
    operation: "rename" | "move" | "delete",
    scope: "occurrence" | "following",
    occurrence: OccurrenceInput,
    ev = base,
  ) =>
    gateSeriesOperation(
      {
        operation,
        scope,
        occurrence,
        ...(operation === "move" ? move : {}),
        now,
      },
      ev,
    );
  assert.equal(gate("rename", "occurrence", own).open, true);
  assert.equal(gate("move", "occurrence", own).open, true);
  const needsMaterialization = gate("rename", "occurrence", virtual);
  assert.ok(!needsMaterialization.open);
  assert.deepEqual(needsMaterialization.missing, ["A2"]);
  assert.equal(
    gate("rename", "occurrence", virtual, evidence("A2", "A3", "A4", "A8"))
      .open,
    true,
  );
  const following = gate("rename", "following", own);
  assert.ok(!following.open);
  assert.deepEqual(following.missing, ["A5", "A6"]);
  assert.equal(
    gate("rename", "following", own, evidence("A3", "A4", "A8", "A5", "A6"))
      .open,
    true,
  );
  const removal = gate("delete", "occurrence", own);
  assert.ok(!removal.open);
  assert.deepEqual(removal.missing, ["A7", "A9"]);
  assert.equal(
    gate("delete", "occurrence", own, evidence("A7", "A9")).open,
    true,
  );
});

test("an approval is immutable, recognised only when issued by the gate and bound to its operation", () => {
  const gate = gateSeriesOperation(
    {
      operation: "move",
      scope: "occurrence",
      occurrence: own,
      ...move,
      now,
    },
    evidence("A3", "A4", "A8"),
  );
  assert.ok(gate.open);
  const { approval } = gate;
  assert.equal(approval.key, "series:43:2026-11-05");
  assert.equal(approval.decision.materialize, false);
  assert.equal(approval.newStartsAt, move.newStartsAt);
  assert.ok(Object.isFrozen(approval) && Object.isFrozen(approval.occurrence));
  assert.throws(() => {
    (approval as { scope: string }).scope = "following";
  });
  assert.equal(isSeriesApproval(approval), true);
  assert.equal(isSeriesApproval({ ...approval }), false);
  assert.equal(isSeriesApproval(null), false);
  assertApproval(approval, { operation: "move", scope: "occurrence" });
  assert.throws(
    () =>
      assertApproval(approval, { operation: "delete", scope: "occurrence" }),
    /не одобрена/,
  );
  assert.throws(
    () => assertApproval(approval, { operation: "move", scope: "following" }),
    /не одобрена/,
  );
  assert.throws(
    () =>
      assertApproval(
        { ...approval },
        { operation: "move", scope: "occurrence" },
      ),
    /не одобрена/,
  );
});

test("shipped evidence is allowed only together with a recorded results document", () => {
  const confirmed = Object.keys(seriesContractEvidence);
  if (!confirmed.length) return;
  const path = new URL(
    "../../docs/research/series-contract-results.md",
    import.meta.url,
  );
  assert.ok(
    existsSync(path),
    "docs/research/series-contract-results.md is missing",
  );
  const results = readFileSync(path, "utf8");
  for (const code of confirmed)
    assert.match(results, new RegExp(`${code}: подтверждено`));
  for (const entry of Object.values(seriesContractEvidence))
    assert.match(entry!.verifiedOn, /^20\d{2}-\d{2}-\d{2}$/);
});
