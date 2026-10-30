import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CalendarWriteNotStarted } from "../../src/main/calendar-write-error.js";
import {
  MeetingOperations,
  type MeetingWriter,
} from "../../src/main/meeting-operations.js";
import { MeetingJournal } from "../../src/main/meeting-journal.js";
import type { MeetingDraft } from "../../src/shared/meeting-draft.js";
function draft(): MeetingDraft {
  return {
    kind: "meeting-draft",
    status: "preview",
    id: randomUUID(),
    revision: 1,
    title: "Synthetic",
    agenda: "Plan",
    organizer: { id: "a", name: "A" },
    participantIds: ["p"],
    startsAt: "2099-10-29T04:30:00.000Z",
    endsAt: "2099-10-29T05:00:00.000Z",
    durationMinutes: 30,
    timezone: "Asia/Almaty",
    location: "",
    conferenceUrl: "https://meet.small.kz/test",
    recurrence: "none",
    visibility: "private",
    availabilityCheckedAt: "2026-10-29T00:00:00.000Z",
  };
}
async function fixture(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "small-operation-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const writer = (create: MeetingWriter["create"]): MeetingWriter => ({
  preflight: async () => {},
  create,
  verify: async () => true,
});
test("a failed cache barrier releases the create claim before any request was sent", async () =>
  fixture(async (dir) => {
    let calls = 0;
    const service = new MeetingOperations(
      new MeetingJournal(dir),
      writer(async () => {
        if (++calls === 1) throw new CalendarWriteNotStarted();
        return "42";
      }),
    );
    const d = service.register(draft());
    const failed = await service.confirm("a", d.id, 1);
    assert.equal(failed.phase, "preview");
    assert.match(failed.message, /не отправлены/);
    assert.equal((await service.confirm("a", d.id, 1)).phase, "succeeded");
  }));
test("three adjacent drafts create independently and remain idempotent after restart", async () =>
  fixture(async (dir) => {
    let calls = 0;
    const port = writer(async () => String(++calls));
    const service = new MeetingOperations(new MeetingJournal(dir), port);
    const drafts = [0, 1, 2].map((offset) => {
      const base = draft();
      return service.register({
        ...base,
        title: `Synthetic ${offset + 1}`,
        startsAt: new Date(
          Date.parse(base.startsAt) + offset * 1800000,
        ).toISOString(),
        endsAt: new Date(
          Date.parse(base.endsAt) + offset * 1800000,
        ).toISOString(),
      });
    });
    const results = await Promise.all(
      drafts.map((d) => service.confirm("a", d.id, 1)),
    );
    assert.deepEqual(
      results.map((r) => r.phase),
      ["succeeded", "succeeded", "succeeded"],
    );
    assert.equal(new Set(results.map((r) => r.eventId)).size, 3);
    assert.equal(calls, 3);
    const restarted = new MeetingOperations(new MeetingJournal(dir), port);
    for (const d of drafts) {
      const restored = restarted.register(d);
      assert.equal(
        (await restarted.confirm("a", restored.id, 1)).phase,
        "succeeded",
      );
    }
    assert.equal(calls, 3);
  }));
test("only explicit current-version confirmation creates once under simultaneous requests", async () =>
  fixture(async (dir) => {
    let calls = 0;
    const service = new MeetingOperations(
      new MeetingJournal(dir),
      writer(async () => {
        calls++;
        return "42";
      }),
    );
    const d = service.register(draft());
    assert.equal(calls, 0);
    await assert.rejects(service.confirm("other", d.id, 1));
    const edited = await service.edit("a", {
      id: d.id,
      revision: 1,
      title: "Changed",
      agenda: "New",
    });
    assert.equal(edited.draft.conferenceUrl, d.conferenceUrl);
    await assert.rejects(service.confirm("a", d.id, 1), /Версия/);
    const results = await Promise.all([
      service.confirm("a", d.id, 2),
      service.confirm("a", d.id, 2),
    ]);
    assert.ok(results.some((result) => result.phase === "succeeded"));
    assert.equal(calls, 1);
    await service.confirm("a", d.id, 2);
    assert.equal(calls, 1);
    await assert.rejects(
      service.edit("a", { id: d.id, revision: 2, title: "Again", agenda: "" }),
    );
  }));
test("timeout reconciles by reading and never repeats, even for a new draft after restart", async () =>
  fixture(async (dir) => {
    let writes = 0,
      reads = 0;
    const port: MeetingWriter = {
      preflight: async () => {},
      create: async () => {
        writes++;
        throw new Error("timeout");
      },
      verify: async () => {
        reads++;
        return false;
      },
    };
    const service = new MeetingOperations(new MeetingJournal(dir), port);
    const d = service.register(draft());
    assert.equal((await service.confirm("a", d.id, 1)).phase, "unknown");
    await service.confirm("a", d.id, 1);
    await service.reconcile("a", d.id, 1);
    assert.equal(writes, 1);
    assert.ok(reads >= 2);
    const restarted = new MeetingOperations(new MeetingJournal(dir), {
      ...port,
      preflight: async () => {
        throw new Error("now conflicts");
      },
    });
    const next = restarted.register({
      ...d,
      id: randomUUID(),
      conferenceUrl: "https://meet.small.kz/new",
    });
    assert.equal((await restarted.confirm("a", next.id, 1)).phase, "blocked");
    assert.equal(writes, 1);
  }));
test("a receipt is successful only after verification, with read-only reconciliation later", async () =>
  fixture(async (dir) => {
    let verified = false,
      calls = 0;
    const port = {
      ...writer(async () => {
        calls++;
        return "42";
      }),
      verify: async () => verified,
    };
    const service = new MeetingOperations(new MeetingJournal(dir), port);
    const d = service.register(draft());
    assert.equal((await service.confirm("a", d.id, 1)).phase, "unknown");
    verified = true;
    assert.equal((await service.reconcile("a", d.id, 1)).phase, "succeeded");
    assert.equal(calls, 1);
  }));
test("conflict, account change and journal failure prevent network writes", async () =>
  fixture(async (dir) => {
    let calls = 0;
    const service = new MeetingOperations(new MeetingJournal(dir), {
      ...writer(async () => {
        calls++;
        return "42";
      }),
      preflight: async () => {
        throw new Error("conflict");
      },
    });
    const d = service.register(draft());
    assert.equal((await service.confirm("a", d.id, 1)).phase, "preview");
    const other = new MeetingOperations(
      new MeetingJournal("/dev/null/invalid"),
      writer(async () => {
        calls++;
        return "42";
      }),
    );
    const e = other.register(draft());
    await other.confirm("a", e.id, 1);
    await other.confirm("a", e.id, 1, () => {
      throw new Error("account changed");
    });
    assert.equal(calls, 0);
  }));

test("a definitive rejection releases the claim, but never retries automatically", async () =>
  fixture(async (dir) => {
    const { MeetingCreateRejected } =
      await import("../../src/main/meeting-create-error.js");
    let calls = 0;
    const service = new MeetingOperations(
      new MeetingJournal(dir),
      writer(async () => {
        calls++;
        if (calls === 1) throw new MeetingCreateRejected(409);
        return "42";
      }),
    );
    const d = service.register(draft());
    const rejected = await service.confirm("a", d.id, 1);
    assert.equal(rejected.phase, "preview");
    assert.match(rejected.message, /конфликт/);
    assert.equal(calls, 1);
    assert.equal((await service.read("a", d.id, 1)).phase, "preview");
    assert.equal((await service.confirm("a", d.id, 1)).phase, "succeeded");
    assert.equal(calls, 2);
  }));

test("a fresh draft can reuse a slot after the previously verified event was deleted", async () =>
  fixture(async (dir) => {
    let calls = 0;
    let deleted = false;
    const port = {
      ...writer(async () => String(++calls)),
      wasDeleted: async () => deleted,
    };
    const service = new MeetingOperations(new MeetingJournal(dir), port);
    const first = service.register(draft());
    assert.equal((await service.confirm("a", first.id, 1)).phase, "succeeded");
    deleted = true;
    const restarted = new MeetingOperations(new MeetingJournal(dir), port);
    const second = restarted.register({
      ...first,
      id: randomUUID(),
      title: "New meeting",
    });
    assert.equal((await restarted.read("a", second.id, 1)).phase, "preview");
    assert.equal(calls, 1);
    const sameSlot = restarted.register({ ...second, id: randomUUID() });
    const results = await Promise.all([
      restarted.confirm("a", second.id, 1),
      restarted.confirm("a", sameSlot.id, 1),
    ]);
    assert.ok(results.some((r) => r.phase === "succeeded"));
    assert.equal(calls, 2);
    // Re-confirming an old card must never create the deleted meeting again.
    await service.confirm("a", first.id, 1);
    assert.equal(calls, 2);
  }));

test("deletion checks never release a previous attempt with an unknown outcome", async () =>
  fixture(async (dir) => {
    let calls = 0;
    const port = {
      ...writer(async () => {
        calls++;
        throw new Error("timeout");
      }),
      verify: async () => false,
      wasDeleted: async () => true,
    };
    const service = new MeetingOperations(new MeetingJournal(dir), port);
    const first = service.register(draft());
    assert.equal((await service.confirm("a", first.id, 1)).phase, "unknown");
    const restarted = new MeetingOperations(new MeetingJournal(dir), port);
    const second = restarted.register({
      ...first,
      id: randomUUID(),
      title: "Changed",
    });
    assert.equal((await restarted.confirm("a", second.id, 1)).phase, "blocked");
    assert.equal(calls, 1);
  }));
