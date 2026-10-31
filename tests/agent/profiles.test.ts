import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore, type SecretStore } from "../../src/main/profiles.js";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "small-profiles-"));
  const values = new Map<string, string>();
  const secrets: SecretStore = {
    get: async (id) => values.get(id) ?? null,
    set: async (id, value) => {
      values.set(id, value);
    },
    remove: async (id) => {
      values.delete(id);
    },
  };
  return {
    directory,
    values,
    secrets,
    store: new ProfileStore(directory, secrets),
    clean: () => rm(directory, { recursive: true, force: true }),
  };
}
const profile = {
  id: "small" as const,
  baseURL: "https://example.invalid/v1",
  modelId: "synthetic-model",
};

test("stores only profile metadata on disk and never returns a key to the UI", async () => {
  const f = await fixture();
  const key = `synthetic-${crypto.randomUUID()}`;
  try {
    const state = await f.store.save({ ...profile, apiKey: key });
    assert.equal(state.active, "small");
    assert.equal(state.profiles[0]?.keySuffix, key.slice(-4));
    assert.ok(!JSON.stringify(state).includes(key));
    assert.ok(
      !(
        await readFile(join(f.directory, "llm-profiles.json"), "utf8")
      ).includes(key),
    );
    const reloaded = new ProfileStore(f.directory, f.secrets);
    assert.equal((await reloaded.resolveActive())?.apiKey, key);
    assert.deepEqual(await reloaded.state(), state);
  } finally {
    await f.clean();
  }
});

test("a changed origin requires a new key and leaves the old configuration intact on rejection", async () => {
  const f = await fixture();
  try {
    await f.store.save({ ...profile, apiKey: "synthetic-old" });
    await assert.rejects(
      f.store.save({ ...profile, baseURL: "https://other.invalid/v1" }),
    );
    assert.equal((await f.store.resolveActive())?.baseURL, profile.baseURL);
    await f.store.save({
      ...profile,
      baseURL: "https://other.invalid/v1",
      apiKey: "synthetic-new",
    });
    assert.equal((await f.store.resolveActive())?.apiKey, "synthetic-new");
    assert.deepEqual([...f.values.values()], ["synthetic-new"]);
  } finally {
    await f.clean();
  }
});

test("changing only model ID preserves the key for the same origin", async () => {
  const f = await fixture();
  try {
    await f.store.save({ ...profile, apiKey: "synthetic-key" });
    await f.store.save({ ...profile, modelId: "synthetic-model-2" });
    assert.equal((await f.store.resolveActive())?.modelId, "synthetic-model-2");
    assert.equal(f.values.size, 1);
  } finally {
    await f.clean();
  }
});

test("local storage refusal never activates a new profile or falls back from a configured profile", async () => {
  const f = await fixture();
  try {
    const denied = new ProfileStore(f.directory, {
      ...f.secrets,
      set: async () => {
        throw new Error("synthetic refusal");
      },
    });
    await assert.rejects(denied.save({ ...profile, apiKey: "synthetic-key" }));
    assert.equal((await f.store.state()).active, "synthetic");
    await f.store.save({ ...profile, apiKey: "synthetic-key" });
    f.values.clear();
    await assert.rejects(f.store.resolveActive());
    assert.equal((await f.store.state()).active, "small");
  } finally {
    await f.clean();
  }
});

test("explicit removal clears the profile and its local storage entry", async () => {
  const f = await fixture();
  try {
    await f.store.save({ ...profile, apiKey: "synthetic-key" });
    const state = await f.store.remove("small");
    assert.equal(state.active, "synthetic");
    assert.equal(state.profiles.length, 0);
    assert.equal(f.values.size, 0);
  } finally {
    await f.clean();
  }
});

test("invalid URLs, empty model IDs and extra fields are rejected before storing a key", async () => {
  const f = await fixture();
  try {
    for (const input of [
      { ...profile, baseURL: "http://example.invalid/v1" },
      { ...profile, baseURL: "https://user:pass@example.invalid/v1" },
      { ...profile, baseURL: "https://example.invalid/v1?key=synthetic" },
      { ...profile, modelId: "" },
      { ...profile, unexpected: true },
    ])
      await assert.rejects(f.store.save({ ...input, apiKey: "synthetic-key" }));
    assert.equal(f.values.size, 0);
  } finally {
    await f.clean();
  }
});

test("corrupt metadata fails closed rather than choosing the local model", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.directory, "llm-profiles.json"), "{");
    await assert.rejects(f.store.state());
    await assert.rejects(f.store.resolveActive());
  } finally {
    await f.clean();
  }
});

test("failed key deletion remains visible and is retried without losing the active key", async () => {
  const f = await fixture();
  let denied = true;
  const store = new ProfileStore(f.directory, {
    ...f.secrets,
    remove: async (id) => {
      if (denied) throw new Error("synthetic refusal");
      await f.secrets.remove(id);
    },
  });
  try {
    await store.save({ ...profile, apiKey: "synthetic-old" });
    const state = await store.save({ ...profile, apiKey: "synthetic-new" });
    assert.ok(state.warning);
    assert.equal((await store.resolveActive())?.apiKey, "synthetic-new");
    denied = false;
    assert.equal((await store.save(profile)).warning, undefined);
    assert.deepEqual([...f.values.values()], ["synthetic-new"]);
    const unavailable = new ProfileStore(f.directory, {
      ...f.secrets,
      get: async () => {
        throw new Error("synthetic locked store");
      },
    });
    await assert.rejects(unavailable.resolveActive(), /локальн/);
    assert.equal((await unavailable.state()).active, "small");
  } finally {
    await f.clean();
  }
});

test("an inactive saved profile requests activation rather than a new key", async () => {
  const f = await fixture();
  try {
    await f.store.save({ ...profile, apiKey: "synthetic-saved-key" });
    await f.store.activate("synthetic");
    await assert.rejects(
      f.store.resolveActive(),
      /Профиль сохранён.*Сохранить/,
    );
    await f.store.save(profile);
    assert.equal((await f.store.resolveActive())?.id, "small");
    assert.equal(f.values.size, 1);
  } finally {
    await f.clean();
  }
});

test("reading settings does not unlock any local storage entries, including legacy profiles", async () => {
  const f = await fixture();
  try {
    await f.store.save({ ...profile, apiKey: "synthetic-key" });
    let reads = 0;
    const locked = new ProfileStore(f.directory, {
      ...f.secrets,
      get: async () => {
        reads++;
        throw Error("locked");
      },
    });
    const state = await locked.state();
    assert.equal(reads, 0);
    assert.equal(state.profiles[0]?.hasKey, true);
    assert.equal(state.profiles[0]?.keySuffix, "-key");
    const path = join(f.directory, "llm-profiles.json");
    const legacy = JSON.parse(await readFile(path, "utf8"));
    delete legacy.profiles[0].keySuffix;
    await writeFile(path, JSON.stringify(legacy));
    assert.equal((await locked.state()).profiles[0]?.hasKey, true);
    assert.equal(reads, 0);
  } finally {
    await f.clean();
  }
});

test("saving model metadata without a new API key does not rewrite a credential", async () => {
  const f = await fixture();
  try {
    await f.store.save({ ...profile, apiKey: "synthetic-key" });
    let writes = 0;
    const store = new ProfileStore(f.directory, {
      ...f.secrets,
      set: async () => {
        writes++;
        throw Error("unexpected write");
      },
    });
    await store.save({ ...profile, modelId: "updated-model" });
    assert.equal(writes, 0);
    assert.equal((await store.resolveActive())?.apiKey, "synthetic-key");
  } finally {
    await f.clean();
  }
});

test("legacy profile metadata never reads native credentials and requires a new local key", async () => {
  const f = await fixture();
  try {
    await f.store.save({ ...profile, apiKey: "synthetic-key" });
    const path = join(f.directory, "llm-profiles.json");
    const legacy = JSON.parse(await readFile(path, "utf8"));
    delete legacy.profiles[0].storage;
    await writeFile(path, JSON.stringify(legacy));
    let reads = 0;
    const store = new ProfileStore(f.directory, {
      ...f.secrets,
      get: async () => {
        reads++;
        throw Error("native access forbidden");
      },
    });
    const state = await store.state();
    assert.equal(state.profiles[0]?.hasKey, false);
    assert.match(state.warning!, /локальное шифрование/);
    await assert.rejects(store.resolveActive(), /Введите API-ключ заново/);
    await assert.rejects(store.save(profile));
    assert.equal(reads, 0);
    const replacement = await f.store.save({
      ...profile,
      apiKey: "synthetic-local-key",
    });
    assert.equal(replacement.profiles[0]?.hasKey, true);
    assert.equal(
      (await f.store.resolveActive())?.apiKey,
      "synthetic-local-key",
    );
  } finally {
    await f.clean();
  }
});

test("three provider profiles keep independent keys across reload and deletion", async () => {
  const f = await fixture();
  try {
    for (const id of ["small", "deepseek", "personal"] as const) {
      await f.store.save({ ...profile, id, apiKey: `synthetic-${id}` });
    }
    const reloaded = new ProfileStore(f.directory, f.secrets);
    assert.equal((await reloaded.state()).profiles.length, 3);
    for (const id of ["small", "deepseek", "personal"] as const) {
      await reloaded.activate(id);
      assert.equal((await reloaded.resolveActive())?.apiKey, `synthetic-${id}`);
    }
    await reloaded.remove("deepseek");
    assert.equal((await reloaded.state()).profiles.length, 2);
    assert.equal(
      (await reloaded.resolveActive())?.apiKey,
      "synthetic-personal",
    );
  } finally {
    await f.clean();
  }
});
