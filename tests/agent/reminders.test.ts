import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { occurrenceAliases } from "../../src/shared/occurrence-key.js";
import { legacyOccurrenceKey } from "../../src/shared/series-scope.js";
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

const hashOf = (key: string, account = "a") =>
  createHash("sha256")
    .update(JSON.stringify([account, key]))
    .digest("hex");
const series = (
  id: string | null,
  startsAt: string,
  extra: Partial<CalendarEvent> = {},
): CalendarEvent => ({
  key: id ? `event:${id}` : legacyOccurrenceKey("43", startsAt),
  lookup: id ? { id } : { originalEventId: "43", date: startsAt.slice(0, 10) },
  originalEventId: "43",
  recurring: true,
  title: "Серия",
  startsAt,
  endsAt: new Date(Date.parse(startsAt) + 1800000).toISOString(),
  organizer: "Organizer",
  calendarIds: ["1"],
  description: "",
  location: "https://meet.example.test/series",
  aliases: occurrenceAliases({ seriesId: "43", id, startsAt }),
  ...extra,
});
const first = "2026-10-29T05:00:00Z";
const sentHashes = async (dir: string) =>
  Object.keys(
    (
      JSON.parse(await readFile(join(dir, "reminders.json"), "utf8")) as {
        sent: Record<string, number>;
      }
    ).sent,
  ).sort();

test("a virtual occurrence delivered once is not announced again after it is materialized, even moved within the day", async () => {
  for (const movedStart of [first, "2026-10-29T09:00:00Z"]) {
    const f = await fixture();
    try {
      const r = f.create();
      f.events(() => [series(null, first)]);
      f.time("2026-10-29T04:55:00Z");
      await r.tick();
      assert.equal(f.sent.length, 1);
      f.events(() => [series("900", movedStart)]);
      f.time(
        movedStart === first ? "2026-10-29T04:56:00Z" : "2026-10-29T08:56:00Z",
      );
      await r.tick();
      assert.equal(f.sent.length, 1, movedStart);
      const items = (await r.state()).items;
      assert.equal(items.length, 1);
      assert.equal(items[0]?.event.key, "event:900");
      // Restart keeps the link.
      await f.create().tick();
      assert.equal(f.sent.length, 1);
    } finally {
      await f.cleanup();
    }
  }
});

test("a delivery recorded before aliases existed (old virtual key) is still recognised", async () => {
  const f = await fixture();
  try {
    await f.store.claim(
      hashOf(legacyOccurrenceKey("43", first)),
      Date.parse("2026-10-29T05:30:00Z"),
      Date.parse("2026-10-29T04:55:00Z"),
    );
    f.events(() => [series("900", first)]);
    f.time("2026-10-29T04:56:00Z");
    await f.create().tick();
    assert.equal(f.sent.length, 0);
    assert.ok((await sentHashes(f.dir)).includes(hashOf("event:900")));
  } finally {
    await f.cleanup();
  }
});

test("separate events of one series on one day each get their reminder", async () => {
  const f = await fixture();
  try {
    f.events(() => [series("900", first), series("901", first)]);
    f.time("2026-10-29T04:55:00Z");
    await f.create().tick();
    assert.equal(f.sent.length, 2);
    // Neither of them records the date alias.
    assert.deepEqual(
      await sentHashes(f.dir),
      [hashOf("event:900"), hashOf("event:901")].sort(),
    );
    await f.create().tick();
    assert.equal(f.sent.length, 2);
  } finally {
    await f.cleanup();
  }
});

test("a virtual delivery records its key and date alias; a materialized one only its own key", async () => {
  const virtual = await fixture();
  try {
    virtual.events(() => [series(null, first)]);
    virtual.time("2026-10-29T04:55:00Z");
    await virtual.create().tick();
    assert.deepEqual(
      await sentHashes(virtual.dir),
      [
        hashOf(legacyOccurrenceKey("43", first)),
        hashOf("series:43:2026-10-29"),
      ].sort(),
    );
    const disk = await readFile(join(virtual.dir, "reminders.json"), "utf8");
    assert.ok(!disk.includes("Серия") && !disk.includes("series:43"));
  } finally {
    await virtual.cleanup();
  }
  const own = await fixture();
  try {
    own.events(() => [series("900", first)]);
    own.time("2026-10-29T04:55:00Z");
    await own.create().tick();
    assert.deepEqual(await sentHashes(own.dir), [hashOf("event:900")]);
  } finally {
    await own.cleanup();
  }
});

test("an occurrence moved to another day is announced again; cancellation still retracts the card", async () => {
  const f = await fixture();
  try {
    const r = f.create();
    f.events(() => [series(null, first)]);
    f.time("2026-10-29T04:55:00Z");
    await r.tick();
    assert.equal(f.sent.length, 1);
    // The original date is unknown after a move to another day (assumption A4).
    f.events(() => [series("900", "2026-10-30T05:00:00Z")]);
    f.time("2026-10-30T04:55:00Z");
    await r.tick();
    assert.equal(f.sent.length, 2);
    f.events(() => []);
    await r.tick();
    assert.equal((await r.state()).items.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("another account does not share delivery records", async () => {
  const f = await fixture();
  try {
    f.events(() => [series(null, first)]);
    f.time("2026-10-29T04:55:00Z");
    await f.create().tick();
    f.account("b");
    await f.create().tick();
    assert.equal(f.sent.length, 2);
  } finally {
    await f.cleanup();
  }
});

test("claim marks linked ids, refreshes seen entries and rejects malformed hashes", async () => {
  const f = await fixture();
  try {
    const [a, b, c] = ["a", "b", "c"].map((k) => hashOf(k));
    const now = Date.parse("2026-10-29T04:55:00Z");
    const end = now + 1800000;
    assert.equal(await f.store.claim(a!, end, now, { also: [b!] }), true);
    assert.deepEqual(await sentHashes(f.dir), [a!, b!].sort());
    // Seen through the alias: not claimed, but the primary id is recorded.
    assert.equal(
      await f.store.claim(c!, end + 1000, now, { seen: [b!] }),
      false,
    );
    assert.deepEqual(await sentHashes(f.dir), [a!, b!, c!].sort());
    const stored = (
      JSON.parse(await readFile(join(f.dir, "reminders.json"), "utf8")) as {
        sent: Record<string, number>;
      }
    ).sent;
    assert.equal(stored[b!], end + 1000);
    assert.equal(stored[c!], end + 1000);
    assert.equal(await f.store.claim(c!, end, now), false);
    for (const bad of [
      () => f.store.claim("not-a-hash", end, now),
      () => f.store.claim(a!, end, now, { seen: ["x"] }),
      () => f.store.claim(a!, end, now, { also: ["../x"] }),
    ])
      await assert.rejects(bad());
    // Expired records disappear after thirty days.
    assert.equal(await f.store.claim(a!, end, now + 31 * 86400000), true);
  } finally {
    await f.cleanup();
  }
});
