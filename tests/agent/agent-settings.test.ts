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
    assert.equal(original.settings.skills.length, 7);
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
    assert.equal(migrated.settings.version, 6);
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

test("version 2 gains schedule while preserving customized and disabled skills", async () => {
  const dir = await mkdtemp(join(tmpdir(), "schedule-migration-"));
  try {
    const store = new AgentSettingsStore(dir);
    const { settings } = await store.read();
    settings.version = 2;
    settings.skills = settings.skills.filter(
      (s) =>
        s.id !== "schedule" &&
        s.id !== "analytics" &&
        s.id !== "meeting-delete" &&
        s.id !== "event-list",
    );
    settings.skills[0]!.enabled = false;
    settings.skills[0]!.content = "My custom instructions";
    await writeFile(join(dir, "agent-settings.json"), JSON.stringify(settings));
    const migrated = await store.read();
    assert.deepEqual(migrated.settings.skills.slice(0, 3), settings.skills);
    assert.equal(migrated.settings.skills[3]!.id, "schedule");
    assert.equal(migrated.settings.skills[3]!.enabled, true);
    assert.equal(migrated.settings.skills[4]!.id, "analytics");
    assert.equal(migrated.settings.version, 6);
    await store.save(migrated.settings);
    assert.deepEqual((await store.read()).settings, migrated.settings);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("version 3 settings gain the analytics skill without touching existing skills", async () => {
  const dir = await mkdtemp(join(tmpdir(), "analytics-migration-"));
  try {
    const store = new AgentSettingsStore(dir);
    const { settings } = await store.read();
    settings.version = 3;
    settings.instructions = "Пиши коротко";
    settings.skills = settings.skills.filter(
      (s) =>
        s.id !== "analytics" &&
        s.id !== "meeting-delete" &&
        s.id !== "event-list",
    );
    settings.skills[3]!.enabled = false;
    settings.skills[0]!.content = "# Мой навык";
    await writeFile(join(dir, "agent-settings.json"), JSON.stringify(settings));
    const migrated = await store.read();
    assert.deepEqual(migrated.settings.skills.slice(0, 4), settings.skills);
    assert.equal(migrated.settings.skills[4]!.id, "analytics");
    assert.equal(migrated.settings.skills[4]!.enabled, true);
    assert.match(migrated.settings.skills[4]!.content, /meetingAnalytics/);
    assert.equal(migrated.settings.instructions, "Пиши коротко");
    assert.equal(migrated.settings.version, 6);
    await store.save(migrated.settings);
    assert.deepEqual((await store.read()).settings, migrated.settings);
    const incomplete = {
      ...migrated.settings,
      skills: settings.skills,
    };
    await assert.rejects(() => store.save(incomplete));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("prompt templates persist, allow empty lists and reject more than five or blank entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "prompt-templates-"));
  try {
    const store = new AgentSettingsStore(dir);
    const { settings } = await store.read();
    const prompts = ["Какие встречи сегодня?", "Подготовь встречу завтра"];
    await store.save({ ...settings, promptTemplates: prompts });
    assert.deepEqual(
      (await new AgentSettingsStore(dir).read()).settings.promptTemplates,
      prompts,
    );
    for (const promptTemplates of [
      Array(6).fill("Тест"),
      [" "],
      ["x".repeat(2001)],
    ])
      await assert.rejects(() => store.save({ ...settings, promptTemplates }));
    assert.deepEqual((await store.read()).settings.promptTemplates, prompts);
    await store.save({ ...settings, promptTemplates: [] });
    assert.deepEqual((await store.read()).settings.promptTemplates, []);
    const legacy = { ...settings };
    delete legacy.promptTemplates;
    await writeFile(join(dir, "agent-settings.json"), JSON.stringify(legacy));
    assert.equal((await store.read()).settings.promptTemplates?.length, 4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("saved original suggestions upgrade without replacing edited or empty templates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "prompt-upgrade-"));
  const old = [
    "Найди 30 минут завтра после обеда",
    "Подготовь встречу по развитию календаря",
    "Помоги выбрать участников встречи",
  ];
  try {
    const store = new AgentSettingsStore(dir);
    const { settings } = await store.read();
    await writeFile(
      join(dir, "agent-settings.json"),
      JSON.stringify({
        ...settings,
        promptTemplates: old,
        instructions: "Мои инструкции",
      }),
    );
    const updated = await store.read();
    assert.deepEqual(
      updated.settings.promptTemplates,
      settings.promptTemplates,
    );
    assert.equal(updated.settings.instructions, "Мои инструкции");
    for (const promptTemplates of [[...old.slice(0, 2), "Мой запрос"], []]) {
      await writeFile(
        join(dir, "agent-settings.json"),
        JSON.stringify({ ...settings, promptTemplates }),
      );
      assert.deepEqual(
        (await store.read()).settings.promptTemplates,
        promptTemplates,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("version 4 gains deletion and personal defaults while preserving custom and disabled skills", async () => {
  const dir = await mkdtemp(join(tmpdir(), "personal-delete-migration-"));
  try {
    const store = new AgentSettingsStore(dir);
    const { settings } = await store.read();
    settings.version = 4;
    settings.skills = settings.skills.filter((s) => s.id !== "meeting-delete");
    const availability = settings.skills.find((s) => s.id === "availability")!;
    availability.enabled = false;
    availability.content = await readFile(
      new URL(
        "../../src/agent/content/legacy/availability-v4.md",
        import.meta.url,
      ),
      "utf8",
    );
    const draft = settings.skills.find((s) => s.id === "meeting-draft")!;
    draft.content = "Мой сценарий встречи";
    await writeFile(join(dir, "agent-settings.json"), JSON.stringify(settings));
    const migrated = (await store.read()).settings;
    assert.equal(migrated.version, 6);
    assert.equal(
      migrated.skills.find((s) => s.id === "availability")!.enabled,
      false,
    );
    assert.match(
      migrated.skills.find((s) => s.id === "availability")!.content,
      /participantIds: \[\]/,
    );
    assert.equal(
      migrated.skills.find((s) => s.id === "meeting-draft")!.content,
      draft.content,
    );
    assert.equal(
      migrated.skills.find((s) => s.id === "meeting-delete")!.enabled,
      true,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
