import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Reminders, meetingUrl } from "../../src/main/reminders.js";
import { ReminderStore } from "../../src/main/reminder-store.js";
import type {
  CalendarEvent,
  CalendarResult,
} from "../../src/shared/calendar.js";
import type { SmallAuthState } from "../../src/shared/small-auth.js";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "small-reminders-"));
  let now = Date.parse("2026-10-29T04:54:00Z");
  let state: SmallAuthState = {
    status: "signed-in",
    profile: { id: "a", name: "User", username: "user" },
  };
  let events: CalendarEvent[] = [
    {
      key: "event:42",
      lookup: { id: "42" },
      title: "Private title",
      startsAt: "2026-10-29T05:00:00Z",
      endsAt: "2026-10-29T05:30:00Z",
      organizer: "Organizer",
      calendarIds: ["1"],
      description: "",
      location: "https://meet.example.test/room",
    },
  ];
  let issues: CalendarResult["issues"] = [];
  let beforeRead: (() => Promise<void>) | undefined;
  const sent: string[] = [],
    opened: string[] = [],
    closed: string[] = [],
    dates: string[] = [];
  const auth = { sessionRevision: 0, read: async () => state };
  const store = new ReminderStore(dir);
  const create = () =>
    new Reminders(store, {
      auth,
      calendar: {
        events: async (input) => {
          dates.push(input.date);
          await beforeRead?.();
          return { events: [...events], issues };
        },
        detail: async () => {
          if (!events[0]) throw new Error("404");
          return events[0];
        },
      },
      now: () => now,
      notify: (item) => {
        sent.push(item.id);
        return () => {
          closed.push(item.id);
        };
      },
      open: async (url) => {
        opened.push(url);
      },
    });
  return {
    dir,
    store,
    create,
    sent,
    opened,
    closed,
    dates,
    auth,
    time: (value: string) => {
      now = Date.parse(value);
    },
    events: (change: (events: CalendarEvent[]) => CalendarEvent[]) => {
      events = change(events);
    },
    issues: (value: CalendarResult["issues"]) => {
      issues = value;
    },
    account: (id: string | null) => {
      auth.sessionRevision++;
      state = id
        ? { status: "signed-in", profile: { id, name: id, username: id } }
        : { status: "signed-out" };
    },
    block: (action: () => Promise<void>) => {
      beforeRead = action;
    },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
test("default five minutes, concurrent polls and restart deliver once without storing event text", async () => {
  const f = await fixture();
  try {
    const r = f.create();
    await r.tick();
    assert.equal(f.sent.length, 0);
    f.time("2026-10-29T04:55:00Z");
    await Promise.all([r.tick(), r.tick()]);
    assert.equal(f.sent.length, 1);
    await f.create().tick();
    assert.equal(f.sent.length, 1);
    assert.equal((await r.state()).items.length, 1);
    const disk = await readFile(join(f.dir, "reminders.json"), "utf8");
    assert.ok(
      !disk.includes("Private title") && !disk.includes("meet.example"),
    );
  } finally {
    await f.cleanup();
  }
});
test("move before delivery reschedules; move after delivery and cancellation retract without duplicates", async () => {
  const f = await fixture();
  try {
    const r = f.create();
    f.events((es) =>
      es.map((e) => ({ ...e, startsAt: "2026-10-29T05:10:00Z" })),
    );
    f.time("2026-10-29T04:55:00Z");
    await r.tick();
    assert.equal(f.sent.length, 0);
    f.time("2026-10-29T05:05:00Z");
    await r.tick();
    assert.equal(f.sent.length, 1);
    f.events((es) =>
      es.map((e) => ({ ...e, startsAt: "2026-10-29T05:20:00Z" })),
    );
    await r.tick();
    assert.equal((await r.state()).items.length, 0);
    assert.equal(f.closed.length, 1);
    f.time("2026-10-29T05:15:00Z");
    await r.tick();
    assert.equal(f.sent.length, 1);
    assert.equal(
      (await r.state()).items[0]?.event.startsAt,
      "2026-10-29T05:20:00Z",
    );
    f.events(() => []);
    await r.tick();
    assert.equal((await r.state()).items.length, 0);
  } finally {
    await f.cleanup();
  }
});
test("wake-up catches ongoing meetings once and skips finished meetings; incomplete data fails closed", async () => {
  const f = await fixture();
  try {
    const r = f.create();
    f.time("2026-10-29T05:10:00Z");
    f.issues([{ source: "my", kind: "network", message: "offline" }]);
    await r.tick();
    assert.equal(f.sent.length, 0);
    assert.ok((await r.state()).warning);
    f.issues([]);
    await r.tick();
    assert.equal(f.sent.length, 1);
    f.time("2026-10-29T05:30:00Z");
    await r.tick();
    assert.equal((await r.state()).items.length, 0);
    f.events((es) => es.map((e) => ({ ...e, key: "event:43" })));
    await r.tick();
    assert.equal(f.sent.length, 1);
  } finally {
    await f.cleanup();
  }
});
test("account switching during fetch cannot deliver old data; logout clears notifications", async () => {
  const f = await fixture();
  try {
    const r = f.create();
    f.time("2026-10-29T04:55:00Z");
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.block(async () => {
      entered();
      await gate;
    });
    const work = r.tick();
    await started;
    f.account("b");
    r.invalidate();
    release();
    await work;
    assert.equal(f.sent.length, 0);
    await r.tick();
    assert.equal(f.sent.length, 1);
    f.account(null);
    await r.tick();
    assert.equal((await r.state()).items.length, 0);
    assert.equal(f.closed.length, 1);
  } finally {
    await f.cleanup();
  }
});
test("settings persist, enforce range, disable delivery, and check next local day", async () => {
  const f = await fixture();
  try {
    const r = f.create();
    await assert.rejects(r.save({ enabled: true, minutes: -1 }));
    await assert.rejects(r.save({ enabled: true, minutes: 61 }));
    await r.save({ enabled: false, minutes: 0 });
    f.time("2026-10-29T05:00:00Z");
    await r.tick();
    assert.equal(f.sent.length, 0);
    assert.deepEqual((await new ReminderStore(f.dir).read()).settings, {
      enabled: false,
      minutes: 0,
    });
    await r.save({ enabled: true, minutes: 0 });
    assert.equal(f.sent.length, 1);
    assert.ok(f.dates.includes("2026-10-30"));
  } finally {
    await f.cleanup();
  }
});
test("join rechecks event and account; only credential-free HTTP(S) URLs leave the app", async () => {
  const f = await fixture();
  try {
    const r = f.create();
    f.time("2026-10-29T04:55:00Z");
    await r.tick();
    const id = (await r.state()).items[0]!.id;
    await r.join(id);
    assert.deepEqual(f.opened, ["https://meet.example.test/room"]);
    f.events((es) => es.map((e) => ({ ...e, location: "file:///tmp/test" })));
    await assert.rejects(r.join(id));
    assert.equal(f.opened.length, 1);
    f.events(() => []);
    await assert.rejects(r.join(id));
    f.account("b");
    await assert.rejects(r.join(id));
    for (const url of [
      "javascript:alert(1)",
      "file:///tmp/test",
      "https://user:password@example.com",
      "https://example.com\n",
      "Room 2",
      "zoommtg://example",
    ])
      assert.equal(meetingUrl(url), null);
  } finally {
    await f.cleanup();
  }
});
