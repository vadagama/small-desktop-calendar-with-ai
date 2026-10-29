import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAgentDefaults } from "../../src/agent/agent-content.js";

test("file templates override bundled content while preserving required defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "templates-"));
  try {
    await mkdir(join(dir, "assistant-templates"));
    await writeFile(
      join(dir, "assistant-templates", "welcome.md"),
      "# Мой календарь",
    );
    const state = await loadAgentDefaults(dir);
    assert.equal(state.templates.welcome, "# Мой календарь");
    assert.ok(state.templates.slots.includes("{{date}}"));
    assert.equal(state.settings.mood, "neutral");
    assert.ok(
      state.references["scheduling"].toLowerCase().includes("после обеда"),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
