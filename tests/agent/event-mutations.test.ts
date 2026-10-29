import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventMutations } from "../../src/main/event-mutations.js";
import { MeetingJournal } from "../../src/main/meeting-journal.js";
import { isEventMutation } from "../../src/main/event-mutation-request.js";
const original = {
  id: 42,
  creator_id: "guid-a",
  title: "Before",
  description: null,
  location: "Room",
  starts_at: "2099-10-29T04:00:00Z",
  ends_at: "2099-10-29T04:30:00Z",
  timezone: "Asia/Almaty",
  is_recurring: false,
  is_public: false,
  calendar_ids: [7],
  participants: [{ id: "guid-a" }],
  notification_recipients: [{ id: "guid-b" }],
  attachments: [{ id: "file-a" }],
};
test("confirmed rename preserves fields, prevents concurrent writes and survives restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "event-change-"));
  try {
    let event = { ...original },
      writes = 0;
    const session = {
      readCalendar: async (_a: string, run: any) =>
        run(async () => Response.json({ data: event })),
      mutateCalendarEvent: async (
        _a: string,
        path: string,
        method: "PUT" | "DELETE",
        body: any,
      ) => {
        assert.equal(method, "PUT");
        assert.match(path, /force=false$/);
        writes++;
        assert.equal(body.description, null);
        assert.deepEqual(body.notification_recipient_ids, ["guid-b"]);
        assert.deepEqual(body.attachments, ["file-a"]);
        event = { ...event, title: body.title };
        return Response.json({ data: event });
      },
    };
    const journal = new MeetingJournal(dir);
    const service = new EventMutations(session, journal, async () => "guid-a");
    const op = await service.register("account", original, {
      kind: "rename",
      title: "After",
    });
    const parallel = await service.register("account", original, {
      kind: "rename",
      title: "After",
    });
    assert.equal(writes, 0);
    const q = { accountId: "account", operationId: op };
    await assert.rejects(service.confirm({ ...q, accountId: "other" }));
    await Promise.all([service.confirm(q), service.confirm(q)]);
    assert.equal((await service.reconcile(q)).phase, "succeeded");
    assert.equal(writes, 1);
    const restarted = new EventMutations(
      session,
      journal,
      async () => "guid-a",
    );
    const next = await restarted.register("account", original, {
      kind: "rename",
      title: "After",
    });
    assert.equal(
      (await restarted.confirm({ ...q, operationId: next })).phase,
      "blocked",
    );
    assert.equal(writes, 1);
    for (const title of ["Before", "After"]) {
      const operationId = await restarted.register("account", event, {
        kind: "rename",
        title,
      });
      assert.equal(
        (await restarted.confirm({ accountId: "account", operationId })).phase,
        "succeeded",
      );
      assert.equal(event.title, title);
      if (title === "Before")
        assert.equal(
          (
            await service.confirm({
              accountId: "account",
              operationId: parallel,
            })
          ).phase,
          "blocked",
        );
    }
    assert.equal(writes, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("changed fields, series, changed owner and session block mutation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "event-change-"));
  try {
    let event = { ...original },
      writes = 0;
    const session = {
      readCalendar: async (_a: string, run: any) =>
        run(async () => Response.json({ data: event })),
      mutateCalendarEvent: async () => {
        writes++;
        return Response.json({});
      },
    };
    for (const patch of [
      { title: "External edit" },
      { creator_id: "other" },
      { location: "Other" },
      { is_recurring: true },
    ]) {
      const service = new EventMutations(
        session,
        new MeetingJournal(dir),
        async () => "guid-a",
      );
      const operationId = await service.register("account", original, {
        kind: "cancel",
      });
      event = { ...original, ...patch };
      assert.notEqual(
        (await service.confirm({ accountId: "account", operationId })).phase,
        "succeeded",
      );
    }
    assert.equal(writes, 0);
    const service = new EventMutations(
      session,
      new MeetingJournal(dir),
      async () => "guid-a",
    );
    await assert.rejects(() =>
      service.register(
        "account",
        { ...original, is_recurring: true },
        { kind: "cancel" },
      ),
    );
    const operationId = await service.register("account", original, {
      kind: "cancel",
    });
    event = original;
    await service.confirm({ accountId: "account", operationId }, () => {
      throw Error("session changed");
    });
    assert.equal(writes, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("lost delete response stays unknown; acknowledged delete with 404 succeeds", async () => {
  for (const lost of [true, false]) {
    const dir = await mkdtemp(join(tmpdir(), "event-change-"));
    try {
      let deleted = false,
        writes = 0;
      const service = new EventMutations(
        {
          readCalendar: async (_a, run) =>
            run(async () =>
              deleted
                ? new Response(null, { status: 404 })
                : Response.json({ data: original }),
            ),
          mutateCalendarEvent: async () => {
            writes++;
            deleted = true;
            if (lost) throw Error("lost");
            return new Response(null, { status: 204 });
          },
        },
        new MeetingJournal(dir),
        async () => "guid-a",
      );
      const operationId = await service.register("account", original, {
        kind: "cancel",
      });
      const q = { accountId: "account", operationId };
      assert.equal(
        (await service.confirm(q)).phase,
        lost ? "unknown" : "succeeded",
      );
      assert.equal(
        (await service.reconcile(q)).phase,
        lost ? "unknown" : "succeeded",
      );
      await service.confirm(q);
      assert.equal(writes, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});
test("mutation transport allowlist excludes force, arbitrary paths and bodies", () => {
  assert.equal(
    isEventMutation("/gate/team/api/calendar/events/42", "DELETE"),
    true,
  );
  for (const path of [
    "/gate/team/api/calendar/events/../42",
    "/gate/team/api/calendar/events/42/cancel",
    "/gate/team/api/calendar/events/42?force=true",
  ])
    assert.equal(isEventMutation(path, "DELETE"), false);
  assert.equal(
    isEventMutation("/gate/team/api/calendar/events/42?force=false", "PUT", {
      title: "Only title",
    }),
    false,
  );
  assert.equal(
    isEventMutation("/gate/team/api/calendar/events/42", "DELETE", {}),
    false,
  );
});

test("unknown generation survives restart and blocks a different action on the same event", async () => {
  const dir = await mkdtemp(join(tmpdir(), "event-change-"));
  try {
    let event = { ...original },
      writes = 0,
      readable = true;
    const session = {
      readCalendar: async (_account: string, run: any) =>
        run(async () =>
          readable
            ? Response.json({ data: event })
            : new Response(null, { status: 503 }),
        ),
      mutateCalendarEvent: async () => {
        writes++;
        event = { ...event, title: "After" };
        readable = false;
        throw Error("lost");
      },
    };
    const journal = new MeetingJournal(dir);
    const first = new EventMutations(session, journal, async () => "guid-a");
    const operationId = await first.register("account", original, {
      kind: "rename",
      title: "After",
    });
    assert.equal(
      (await first.confirm({ accountId: "account", operationId })).phase,
      "unknown",
    );
    const restarted = new EventMutations(
      session,
      journal,
      async () => "guid-a",
    );
    const different = await restarted.register("account", event, {
      kind: "cancel",
    });
    assert.equal(
      (
        await restarted.confirm({
          accountId: "account",
          operationId: different,
        })
      ).phase,
      "blocked",
    );
    readable = true;
    assert.equal(
      (await first.reconcile({ accountId: "account", operationId })).phase,
      "succeeded",
    );
    assert.equal(writes, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("restored success is not published before its current-state read completes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "event-change-"));
  try {
    let event = { ...original },
      block = false;
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = new EventMutations(
      {
        readCalendar: async (_account, run) =>
          run(async () => {
            if (block) {
              entered();
              await gate;
            }
            return Response.json({ data: event });
          }),
        mutateCalendarEvent: async () => {
          event = { ...event, title: "After" };
          return Response.json({ status: "success" });
        },
      },
      new MeetingJournal(dir),
      async () => "guid-a",
    );
    const first = await service.register("account", original, {
      kind: "rename",
      title: "After",
    });
    const parallel = await service.register("account", original, {
      kind: "rename",
      title: "After",
    });
    await service.confirm({ accountId: "account", operationId: first });
    block = true;
    const q = { accountId: "account", operationId: parallel };
    const pending = service.confirm(q);
    await waiting;
    const simultaneous = await service.confirm(q);
    event = { ...event, title: "External" };
    release();
    assert.equal((await pending).phase, "blocked");
    assert.notEqual(simultaneous.phase, "succeeded");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
