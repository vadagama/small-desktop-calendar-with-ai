import {
  memoryChange,
  memoryPreferences,
} from "../../src/shared/assistant-memory.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AssistantMemoryStore } from "../../src/main/assistant-memory.js";
import { LocalCipher, LocalSecrets } from "../../src/main/local-secrets.js";
import { ParticipantMemory } from "../../src/main/participant-memory.js";
import { MemoryProposals } from "../../src/main/memory-proposals.js";
import { useMemorySelection } from "../../src/main/memory-tools.js";

test("memory migrates aliases, persists encrypted, isolates accounts and rejects stale writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "assistant-memory-"));
  const make = () =>
    new AssistantMemoryStore(
      dir,
      new LocalSecrets(
        join(dir, "local-vault"),
        new LocalCipher(join(dir, "local-vault")),
      ),
    );
  try {
    await new ParticipantMemory(dir).remember(
      "a",
      { participantId: "test-v", name: "Тест", position: "" },
      "Витя",
    );
    const store = make();
    const initial = await store.read("a");
    assert.equal(initial.entries[0]?.alias, "Витя");
    assert.equal((await store.read("b")).entries.length, 0);
    const request = {
      revision: initial.revision,
      requestId: randomUUID(),
      change: {
        action: "preferences" as const,
        value: { durationMinutes: 45, bufferMinutes: 0 },
      },
    };
    const saved = await store.write("a", request);
    assert.equal((await store.write("a", request)).revision, saved.revision);
    await assert.rejects(
      store.write("a", { ...request, requestId: randomUUID() }),
      /Версия/,
    );
    assert.equal((await make().read("a")).preferences.durationMinutes, 45);
    const files = await readdir(join(dir, "local-vault", "secrets"));
    for (const file of files)
      assert.equal(
        (await readFile(join(dir, "local-vault", "secrets", file))).includes(
          Buffer.from("Витя"),
        ),
        false,
      );
    await store.write("a", {
      revision: saved.revision,
      requestId: randomUUID(),
      change: { action: "clear", category: "all" },
    });
    assert.equal((await make().read("a")).entries.length, 0);
    assert.equal((await make().read("a")).participants.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("proposals require explicit request, owner, session, confirmation and current revision", async () => {
  const data = new Map<string, string>();
  const store = new AssistantMemoryStore("/nonexistent", {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      data.set(key, value);
    },
    remove: async (key) => {
      data.delete(key);
    },
  });
  const proposals = new MemoryProposals(store);
  await assert.rejects(
    proposals.propose(
      "a",
      1,
      1,
      "На полчаса",
      { action: "entry", text: "Тест" },
      "message",
    ),
    /явная/,
  );
  const p = await proposals.propose(
    "a",
    1,
    1,
    "Запомни тест",
    { action: "entry", text: "Тест" },
    "message",
  );
  assert.equal((await store.read("a")).entries.length, 0);
  await assert.rejects(proposals.confirm("b", p.id, 1, 1, () => {}));
  await assert.rejects(proposals.confirm("a", p.id, 2, 1, () => {}));
  await assert.rejects(proposals.confirm("a", p.id, 1, 2, () => {}));
  const saved = await proposals.confirm("a", p.id, 1, 1, () => {});
  assert.equal(saved.entries[0]?.source.messageId, "message");
  assert.equal(
    (await proposals.confirm("a", p.id, 1, 1, () => {})).entries.length,
    1,
  );
  const stale = await proposals.propose(
    "a",
    1,
    1,
    "Запомни ещё",
    { action: "entry", text: "Ещё" },
    "message2",
  );
  await store.write("a", {
    revision: saved.revision,
    requestId: randomUUID(),
    change: {
      action: "preferences",
      value: { timeFrom: "10:00", bufferMinutes: 15 },
    },
  });
  await assert.rejects(
    proposals.confirm("a", stale.id, 1, 1, () => {}),
    /Версия/,
  );
  const current = await store.read("a");
  await store.write("a", {
    revision: current.revision,
    requestId: randomUUID(),
    change: { action: "preferences", value: { durationMinutes: 45 } },
  });
  assert.deepEqual((await store.read("a")).preferences, {
    timeFrom: "10:00",
    bufferMinutes: 15,
    durationMinutes: 45,
  });
});
test("group names are unique, use verifies exact people and deleted group breaks preset", async () => {
  const data = new Map<string, string>();
  const store = new AssistantMemoryStore("/nonexistent", {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      data.set(key, value);
    },
    remove: async (key) => {
      data.delete(key);
    },
  });
  const person = {
    participantId: "test-id",
    name: "Тестовый",
    position: "Тест",
  };
  let s = await store.read("a");
  s = await store.write("a", {
    revision: s.revision,
    requestId: randomUUID(),
    change: {
      action: "group",
      value: {
        name: "Команда",
        participantIds: [person.participantId],
        people: [person],
      },
    },
  });
  const group = s.groups[0]!;
  await assert.rejects(
    store.write("a", {
      revision: s.revision,
      requestId: randomUUID(),
      change: {
        action: "group",
        value: { name: " команда ", participantIds: ["x"] },
      },
    }),
    /название/,
  );
  const signal = new AbortController().signal;
  assert.equal(
    (
      await useMemorySelection(
        group,
        s,
        "a",
        {
          searchPeople: async () => ({
            people: [person],
            page: 1,
            nextPage: null,
          }),
        },
        signal,
      )
    )?.[0]?.participantId,
    "test-id",
  );
  await assert.rejects(
    useMemorySelection(
      group,
      s,
      "a",
      {
        searchPeople: async () => ({
          people: [{ ...person, participantId: "other" }],
          page: 1,
          nextPage: null,
        }),
      },
      signal,
    ),
    /не подтверждён/,
  );
  s = await store.write("a", {
    revision: s.revision,
    requestId: randomUUID(),
    change: {
      action: "preset",
      value: { name: "Синк", groupId: group.id, durationMinutes: 30 },
    },
  });
  s = await store.write("a", {
    revision: s.revision,
    requestId: randomUUID(),
    change: { action: "delete", category: "groups", id: group.id },
  });
  await assert.rejects(
    useMemorySelection(
      s.presets[0]!,
      s,
      "a",
      {
        searchPeople: async () => ({
          people: [person],
          page: 1,
          nextPage: null,
        }),
      },
      signal,
    ),
    /удалена/,
  );
});

test("write failure, corruption and account change never replace saved memory", async () => {
  const values = new Map<string, string>();
  let fail = false;
  const store = new AssistantMemoryStore("/nonexistent", {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      if (fail) throw Error("disk full");
      values.set(key, value);
    },
    remove: async (key) => {
      values.delete(key);
    },
  });
  const initial = await store.read("a");
  const request = {
    revision: initial.revision,
    requestId: randomUUID(),
    change: { action: "entry", text: "Синтетический контекст" },
  };
  fail = true;
  await assert.rejects(store.write("a", request), /disk full/);
  fail = false;
  assert.equal((await store.read("a")).entries.length, 0);
  await assert.rejects(
    store.write("a", request, undefined, () => {
      throw Error("account changed");
    }),
    /account changed/,
  );
  const saved = await store.write("a", request);
  const [key] = [...values.keys()];
  const valid = values.get(key!)!;
  values.set(key!, "invalid json");
  await assert.rejects(store.read("a"), /повреждён/);
  await assert.rejects(
    store.write("a", {
      ...request,
      revision: saved.revision,
      requestId: randomUUID(),
    }),
  );
  assert.equal(values.get(key!), "invalid json");
  values.set(key!, valid);
  assert.equal(
    (await store.read("a")).entries[0]?.text,
    "Синтетический контекст",
  );
});

test("memory-only vault refuses to replace a missing encryption key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memory-key-"));
  const vault = join(dir, "local-vault");
  const make = () =>
    new AssistantMemoryStore(
      dir,
      new LocalSecrets(vault, new LocalCipher(vault)),
    );
  try {
    await make().read("a");
    const files = await readdir(vault);
    const key = files.find((f) => f.includes("key"));
    assert.ok(key);
    await rm(join(vault, key));
    await assert.rejects(make().read("a"));
    assert.equal((await readdir(vault)).includes(key), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("memory schemas reject invalid fields, ranges, duplicate participants and oversized context", () => {
  for (const value of [
    { durationMinutes: 0 },
    { durationMinutes: 481 },
    { bufferMinutes: -1 },
    { bufferMinutes: 121 },
    { timeFrom: "24:00" },
    { timeFrom: "11:00", timeTo: "10:00" },
  ])
    assert.equal(memoryPreferences.safeParse(value).success, false);
  for (const change of [
    { action: "entry", text: "   " },
    { action: "entry", text: "т".repeat(2001) },
    { action: "group", value: { name: "Команда", participantIds: ["a", "a"] } },
    {
      action: "preset",
      value: { name: "Синк", groupId: "g", participantIds: ["a"] },
    },
  ])
    assert.equal(memoryChange.safeParse(change).success, false);
  assert.equal(memoryPreferences.safeParse({ bufferMinutes: 0 }).success, true);
});
