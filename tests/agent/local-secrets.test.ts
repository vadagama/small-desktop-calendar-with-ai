import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalCipher, LocalSecrets } from "../../src/main/local-secrets.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "local-vault-"));
  const directory = join(root, "vault");
  const cipher = new LocalCipher(directory);
  return {
    root,
    directory,
    cipher,
    store: new LocalSecrets(directory, cipher),
    clean: () => rm(root, { recursive: true, force: true }),
  };
}

test("credentials survive restart as authenticated ciphertext in private files", async () => {
  const f = await fixture();
  try {
    await f.store.set("model:test", "synthetic-api-key");
    await f.store.set("small-auth-session-v1", "synthetic-cookie");
    const again = new LocalSecrets(f.directory, new LocalCipher(f.directory));
    assert.equal(await again.get("model:test"), "synthetic-api-key");
    assert.equal(await again.get("small-auth-session-v1"), "synthetic-cookie");
    assert.equal((await stat(f.directory)).mode & 0o777, 0o700);
    assert.equal(
      (await stat(join(f.directory, "master.key"))).mode & 0o777,
      0o600,
    );
    for (const name of await readdir(join(f.directory, "secrets"))) {
      assert.match(name, /^[a-f0-9]{64}\.enc$/);
      const path = join(f.directory, "secrets", name);
      assert.equal((await stat(path)).mode & 0o777, 0o600);
      const bytes = await readFile(path);
      assert.equal(bytes.includes(Buffer.from("synthetic")), false);
      assert.equal(bytes.includes(Buffer.from("model:test")), false);
    }
    await again.remove("model:test");
    assert.equal(
      await new LocalSecrets(f.directory, new LocalCipher(f.directory)).get(
        "model:test",
      ),
      null,
    );
    assert.equal(await again.get("small-auth-session-v1"), "synthetic-cookie");
  } finally {
    await f.clean();
  }
});

test("cipher uses random nonces and binds ciphertext to purpose and account", async () => {
  const f = await fixture();
  const other = await fixture();
  try {
    const first = await f.cipher.seal("synthetic", "secret:a");
    const second = await f.cipher.seal("synthetic", "secret:a");
    assert.notDeepEqual(first, second);
    assert.equal(await f.cipher.open(first, "secret:a"), "synthetic");
    await assert.rejects(f.cipher.open(first, "secret:b"));
    await assert.rejects(f.cipher.decrypt(first));
    await assert.rejects(other.cipher.open(first, "secret:a"));
    const corrupt = Buffer.from(first);
    corrupt[corrupt.length - 1]! ^= 1;
    await assert.rejects(f.cipher.open(corrupt, "secret:a"));
    await assert.rejects(f.cipher.open(Buffer.from("plaintext"), "secret:a"));
    const cached = await f.cipher.encrypt("synthetic-cache");
    assert.deepEqual(await f.cipher.decrypt(cached), {
      result: "synthetic-cache",
      shouldReEncrypt: false,
    });
  } finally {
    await f.clean();
    await other.clean();
  }
});

test("parallel initialization and queued writes do not replace the key or lose credentials", async () => {
  const f = await fixture();
  try {
    const ciphers = Array.from(
      { length: 10 },
      () => new LocalCipher(f.directory),
    );
    const values = await Promise.all(
      ciphers.map((c) => c.seal("synthetic", "same")),
    );
    for (const value of values)
      assert.equal(await f.cipher.open(value, "same"), "synthetic");
    await Promise.all(
      Array.from({ length: 20 }, (_, n) =>
        f.store.set(`account-${n}`, `synthetic-${n}`),
      ),
    );
    const again = new LocalSecrets(f.directory, new LocalCipher(f.directory));
    for (let n = 0; n < 20; n++)
      assert.equal(await again.get(`account-${n}`), `synthetic-${n}`);
    const operations = [
      f.store.set("one", "first"),
      f.store.remove("one"),
      f.store.set("one", "last"),
      f.store.get("one"),
    ];
    assert.equal((await Promise.all(operations)).at(-1), "last");
  } finally {
    await f.clean();
  }
});

test("corrupt ciphertext or a missing or corrupt key fails closed without overwriting stored data", async () => {
  const f = await fixture();
  try {
    await f.store.set("a", "synthetic-key");
    const path = join(
      f.directory,
      "secrets",
      (await readdir(join(f.directory, "secrets")))[0]!,
    );
    const original = await readFile(path);
    await rm(join(f.directory, "master.key"));
    const missing = new LocalSecrets(f.directory, new LocalCipher(f.directory));
    await assert.rejects(missing.get("a"));
    await assert.rejects(missing.set("b", "synthetic-new"));
    assert.deepEqual(await readFile(path), original);
    await writeFile(join(f.directory, "master.key"), "bad", { mode: 0o600 });
    await assert.rejects(
      new LocalSecrets(f.directory, new LocalCipher(f.directory)).get("a"),
    );
  } finally {
    await f.clean();
  }
});

test("symlinked key files are refused and cancelled requests cannot mutate storage", async () => {
  const f = await fixture();
  try {
    await f.cipher.encrypt("synthetic");
    const key = join(f.directory, "master.key");
    const external = join(f.root, "external-key");
    await writeFile(external, await readFile(key));
    await rm(key);
    await symlink(external, key);
    await assert.rejects(new LocalCipher(f.directory).encrypt("synthetic"));
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(f.store.get("a", controller.signal), {
      name: "AbortError",
    });
  } finally {
    await f.clean();
  }
});
