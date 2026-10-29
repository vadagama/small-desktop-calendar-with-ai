import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TopicRuleStore } from "../../src/main/topic-rules.js";

const rules = [
  { topic: "Процесс", keywords: ["спринт", "daily"] },
  { topic: "Клиенты", keywords: ["демо"] },
];
const withDirectory = async (run: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), "topic-rules-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

test("rules default to empty, survive restart and are stored privately", () =>
  withDirectory(async (dir) => {
    assert.deepEqual(await new TopicRuleStore(dir).read(), []);
    await new TopicRuleStore(dir).save(rules);
    assert.deepEqual(await new TopicRuleStore(dir).read(), rules);
    assert.equal(
      (await stat(join(dir, "topic-rules.json"))).mode & 0o777,
      0o600,
    );
    assert.deepEqual(
      (await readdir(dir)).filter((name) => name.endsWith(".tmp")),
      [],
    );
    const stored = await readFile(join(dir, "topic-rules.json"), "utf8");
    assert.deepEqual(Object.keys(JSON.parse(stored)), ["rules"]);
  }));

test("invalid rules are rejected without replacing the saved list", () =>
  withDirectory(async (dir) => {
    const store = new TopicRuleStore(dir);
    await store.save(rules);
    const word = "я".repeat(61);
    for (const bad of [
      [{ topic: "", keywords: ["a"] }],
      [{ topic: "Тема", keywords: [] }],
      [{ topic: "Тема", keywords: ["  "] }],
      [{ topic: word, keywords: ["a"] }],
      [{ topic: "Тема", keywords: [word] }],
      [{ topic: "Тема", keywords: Array(21).fill("a") }],
      Array.from({ length: 21 }, (_, i) => ({
        topic: `t${i}`,
        keywords: ["a"],
      })),
      [
        { topic: "Тема", keywords: ["a"] },
        { topic: "тема", keywords: ["b"] },
      ],
      [{ topic: "Тема", keywords: ["a"], extra: true }],
      "not an array",
    ])
      assert.throws(() => store.save(bad));
    assert.deepEqual(await store.read(), rules);
  }));

test("rules are trimmed and concurrent saves leave one valid last write", () =>
  withDirectory(async (dir) => {
    const store = new TopicRuleStore(dir);
    const first = store.save([{ topic: " Один ", keywords: [" слово "] }]);
    const second = store.save([{ topic: "Два", keywords: ["слово"] }]);
    assert.deepEqual(await first, [{ topic: "Один", keywords: ["слово"] }]);
    await second;
    assert.deepEqual(await store.read(), [
      { topic: "Два", keywords: ["слово"] },
    ]);
  }));

test("a corrupted file blocks reading but an explicit save repairs it", () =>
  withDirectory(async (dir) => {
    await writeFile(join(dir, "topic-rules.json"), "broken");
    const store = new TopicRuleStore(dir);
    await assert.rejects(() => store.read(), /правила тем/);
    await writeFile(
      join(dir, "topic-rules.json"),
      JSON.stringify({ rules: [], extra: 1 }),
    );
    await assert.rejects(() => store.read());
    await store.save(rules);
    assert.deepEqual(await store.read(), rules);
  }));
