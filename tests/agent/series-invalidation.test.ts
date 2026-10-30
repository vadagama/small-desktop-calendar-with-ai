import assert from "node:assert/strict";
import { test } from "node:test";
import { invalidatingSeries } from "../../src/main/series-invalidation.js";
import type { SeriesController } from "../../src/main/series-controller.js";

function setup(apply: () => Promise<unknown>) {
  const calls: string[] = [];
  const series = {
    gate: async () => {
      calls.push("gate");
      return { open: false };
    },
    apply: async () => {
      calls.push("apply");
      return apply();
    },
  } as unknown as Pick<SeriesController, "gate" | "apply">;
  const sync = {
    write: async <T>(action: () => Promise<T>, target?: unknown) => {
      try {
        return await action();
      } finally {
        calls.push(
          target === undefined ? "invalidate-all" : "invalidate-target",
        );
      }
    },
  };
  return { wrapped: invalidatingSeries(series, sync), calls };
}

test("a series write drops every cached range after it, whether it worked or not", async () => {
  const worked = setup(async () => ({ ok: true }));
  assert.deepEqual(await worked.wrapped.apply({}), { ok: true });
  assert.deepEqual(worked.calls, ["apply", "invalidate-all"]);
  const failed = setup(async () => {
    throw new Error("unknown outcome");
  });
  await assert.rejects(failed.wrapped.apply({}), /unknown outcome/);
  assert.deepEqual(failed.calls, ["apply", "invalidate-all"]);
});

test("reading the gate leaves the cache alone", async () => {
  const { wrapped, calls } = setup(async () => ({}));
  await wrapped.gate({});
  assert.deepEqual(calls, ["gate"]);
});
