import assert from "node:assert/strict";
import { test } from "node:test";
import { KeychainSecrets } from "../../src/main/keychain.js";

function fixture() {
  const values = new Map([["model", "synthetic-key"]]);
  let reads = 0;
  let writes = 0;
  let failRead = false;
  let release: (() => void) | undefined;
  let wait: Promise<void> | undefined;
  const store = new KeychainSecrets("/synthetic", () => ({
    getPassword: async () => {
      reads++;
      await wait;
      if (failRead) throw new Error("denied");
      return values.get("model") ?? null;
    },
    setPassword: async (value: string) => {
      writes++;
      values.set("model", value);
    },
    deleteCredential: async () => values.delete("model"),
  }));
  return {
    store,
    values,
    reads: () => reads,
    writes: () => writes,
    deny: (value: boolean) => {
      failRead = value;
    },
    pause: () => {
      wait = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    release: () => release?.(),
  };
}

test("four concurrent and subsequent reads request Keychain access only once", async () => {
  const f = fixture();
  f.pause();
  const pending = Promise.all(
    Array.from({ length: 4 }, () => f.store.get("model")),
  );
  f.release();
  assert.deepEqual(await pending, Array(4).fill("synthetic-key"));
  assert.equal(await f.store.get("model"), "synthetic-key");
  assert.equal(f.reads(), 1);
});

test("cancelled caller does not cancel shared access or prompt again", async () => {
  const f = fixture();
  f.pause();
  const controller = new AbortController();
  const cancelled = f.store.get("model", controller.signal);
  const other = f.store.get("model");
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  f.release();
  assert.equal(await other, "synthetic-key");
  assert.equal(f.reads(), 1);
});

test("writes update cached values, identical saves skip Keychain, removal clears the secret", async () => {
  const f = fixture();
  await f.store.get("model");
  await f.store.set("model", "synthetic-key");
  assert.equal(f.writes(), 0);
  await f.store.set("model", "synthetic-new");
  assert.equal(await f.store.get("model"), "synthetic-new");
  await f.store.remove("model");
  assert.equal(await f.store.get("model"), null);
  assert.equal(f.reads(), 1);
});

test("failed reads are shared but can be explicitly retried on the next call", async () => {
  const f = fixture();
  f.pause();
  f.deny(true);
  const pending = Promise.allSettled(
    Array.from({ length: 4 }, () => f.store.get("model")),
  );
  f.release();
  assert.ok((await pending).every((result) => result.status === "rejected"));
  assert.equal(f.reads(), 1);
  f.deny(false);
  assert.equal(await f.store.get("model"), "synthetic-key");
  assert.equal(f.reads(), 2);
});

test("a write queued during a pending read wins for subsequent readers", async () => {
  const f = fixture();
  f.pause();
  const first = f.store.get("model");
  const write = f.store.set("model", "replacement");
  const after = f.store.get("model");
  f.release();
  await first;
  await write;
  assert.equal(await after, "replacement");
  assert.equal(f.reads(), 1);
});

test("a failed mutation invalidates cached credentials and accounts remain isolated", async () => {
  let failed = false;
  const store = new KeychainSecrets("/synthetic", (_service, account) => ({
    getPassword: async () => `${account}-key`,
    setPassword: async () => {
      if (failed) throw Error("denied");
    },
    deleteCredential: async () => {
      if (failed) throw Error("denied");
      return true;
    },
  }));
  assert.equal(await store.get("a"), "a-key");
  assert.equal(await store.get("b"), "b-key");
  await store.set("a", "new-a");
  failed = true;
  await assert.rejects(store.remove("a"));
  assert.equal(await store.get("a"), "a-key");
  await assert.rejects(store.set("a", "failed-a"));
  assert.equal(await store.get("a"), "a-key");
  assert.equal(await store.get("b"), "b-key");
});
