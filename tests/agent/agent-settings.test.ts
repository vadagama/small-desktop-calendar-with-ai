import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSettingsStore } from "../../src/main/agent-settings.js";

test("agent customization survives restart and reset restores bundled skills", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-settings-"));
  try {
    const store = new AgentSettingsStore(dir);
    const original = await store.read();
    assert.ok(original.system.includes("Small"));
    assert.equal(original.settings.skills.length, 3);
    const settings = structuredClone(original.settings);
    settings.instructions = "Отвечай кратко.";
    settings.skills[0]!.enabled = false;
    settings.skills[1]!.content =
      "# Подбор времени\nПредлагай утренние варианты.";
    await store.save(settings);
    assert.deepEqual(
      (await new AgentSettingsStore(dir).read()).settings,
      settings,
    );
    assert.equal((await store.read()).system, original.system);
    assert.deepEqual((await store.reset()).settings, original.settings);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("invalid settings cannot replace the last valid configuration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-settings-"));
  try {
    const store = new AgentSettingsStore(dir);
    const { settings } = await store.read();
    await store.save(settings);
    for (const bad of [
      { ...settings, system: "override" },
      { ...settings, instructions: "x".repeat(8001) },
      { ...settings, skills: [{ ...settings.skills[0], id: "../../secrets" }] },
      {
        ...settings,
        skills: [settings.skills[0], settings.skills[0], settings.skills[0]],
      },
    ])
      await assert.rejects(() => store.save(bad));
    assert.deepEqual((await store.read()).settings, settings);
    await writeFile(join(dir, "agent-settings.json"), "broken");
    await assert.rejects(() => store.read());
    assert.equal(
      await readFile(join(dir, "agent-settings.json"), "utf8"),
      "broken",
    );
    assert.deepEqual((await store.reset()).settings, settings);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("legacy bundled skill migrates without overwriting custom instructions or disabled state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-migration-"));
  try {
    const store = new AgentSettingsStore(dir);
    const original = await store.read();
    const settings = structuredClone(original.settings);
    settings.version = 1;
    settings.instructions = "Пиши коротко";
    settings.skills[0]!.content = await readFile(
      new URL(
        "../../src/agent/content/legacy/people-search.md",
        import.meta.url,
      ),
      "utf8",
    );
    settings.skills[0]!.enabled = false;
    settings.skills[1]!.content = "# Мой навык";
    await writeFile(join(dir, "agent-settings.json"), JSON.stringify(settings));
    const migrated = await store.read();
    assert.equal(migrated.settings.version, 2);
    assert.equal(
      migrated.settings.skills[0]!.content,
      original.settings.skills[0]!.content,
    );
    assert.equal(migrated.settings.skills[0]!.enabled, false);
    assert.equal(migrated.settings.skills[1]!.content, "# Мой навык");
    assert.equal(migrated.settings.instructions, "Пиши коротко");
    migrated.settings.mood = "technical";
    await store.save(migrated.settings);
    assert.equal(
      (await new AgentSettingsStore(dir).read()).settings.mood,
      "technical",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
