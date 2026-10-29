import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MeetingJournal } from "../../src/main/meeting-journal.js";
const key = "a".repeat(64),
  digest = "b".repeat(64);
test("claims once across instances and restores an uncertain attempt after restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "small-journal-"));
  try {
    const a = new MeetingJournal(dir),
      b = new MeetingJournal(dir);
    const attempts = await Promise.all([
      a.claim(key, digest),
      b.claim(key, digest),
    ]);
    assert.equal(attempts.filter((x) => x).length, 1);
    assert.equal((await new MeetingJournal(dir).read(key))?.phase, "unknown");
    await a.finish(key, { phase: "succeeded", eventId: "42" });
    assert.equal((await b.read(key))?.eventId, "42");
    assert.equal(await b.claim(key, digest), false);
    assert.ok(
      !(await readFile(join(dir, key + ".intent"), "utf8")).includes("title"),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("fails closed on a partial intent and rejects path traversal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "small-journal-"));
  try {
    const journal = new MeetingJournal(dir);
    await writeFile(join(dir, key + ".intent"), "{");
    assert.equal(await journal.claim(key, digest), false);
    await assert.rejects(journal.read(key));
    await assert.rejects(journal.claim("../escape", digest));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
