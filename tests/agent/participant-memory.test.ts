import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ParticipantMemory } from "../../src/main/participant-memory.js";
test("participant aliases survive restart, stay account scoped and can be forgotten", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memory-test-"));
  const person = {
    participantId: "test-v",
    name: "Тестовый Виктор",
    position: "Тест",
  };
  try {
    const memory = new ParticipantMemory(dir);
    await memory.remember("a", person, "Витя");
    await memory.used("a", [person]);
    const reopened = new ParticipantMemory(dir);
    assert.equal((await reopened.read("a"))[0]?.aliases[0], "Витя");
    assert.equal((await reopened.read("a"))[0]?.uses, 1);
    assert.deepEqual(await reopened.read("b"), []);
    await reopened.forget("a", "test-v");
    assert.deepEqual(await reopened.read("a"), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("directory-length names and positions remain readable after persistence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memory-length-"));
  try {
    const memory = new ParticipantMemory(dir);
    const person = {
      participantId: "test-long",
      name: "Н".repeat(500),
      position: "Д".repeat(500),
    };
    await memory.used("a", [person]);
    const reopened = new ParticipantMemory(dir);
    assert.equal((await reopened.read("a"))[0]?.name, person.name);
    assert.equal((await reopened.read("a"))[0]?.position, person.position);
    await assert.rejects(
      memory.used("a", [{ ...person, name: "Н".repeat(501) }]),
    );
    assert.equal((await reopened.read("a"))[0]?.name, person.name);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("clear can recover corrupted participant memory without reading its broken payload", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memory-corrupt-"));
  try {
    const memory = new ParticipantMemory(dir);
    const person = {
      participantId: "test-person",
      name: "Тестовый",
      position: "",
    };
    await memory.used("a", [person]);
    const files = await readdir(join(dir, "participant-memory"));
    assert.equal(files.length, 1);
    await writeFile(join(dir, "participant-memory", files[0]!), "{broken");
    await assert.rejects(memory.read("a"));
    await memory.forget("a");
    assert.deepEqual(await memory.read("a"), []);
    await memory.used("a", [person]);
    assert.equal((await memory.read("a"))[0]?.uses, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
