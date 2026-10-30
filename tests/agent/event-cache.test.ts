import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  chmod,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CalendarEvent } from "../../src/shared/calendar.js";
import {
  EventCache,
  eventRangeKey,
  type CacheCipher,
} from "../../src/main/event-cache.js";

/** Reversible and not human-readable, so a plaintext leak is visible to the tests. */
class FakeCipher implements CacheCipher {
  available = true;
  rotated = false;
  /** While set, encryption waits for it, so a test can interleave a clear with a write. */
  hold: Promise<void> | null = null;
  /** Same for the availability check, which comes before any directory is created. */
  holdAvailability: Promise<void> | null = null;
  async isAvailable() {
    await this.holdAvailability;
    return this.available;
  }
  async encrypt(text: string) {
    await this.hold;
    return Buffer.from(
      Buffer.from("fake:" + text, "utf8").map((byte) => byte ^ 0x5a),
    );
  }
  async decrypt(data: Buffer) {
    const text = Buffer.from(data.map((byte) => byte ^ 0x5a)).toString("utf8");
    if (!text.startsWith("fake:")) throw new Error("Cannot decrypt");
    return { result: text.slice(5), shouldReEncrypt: this.rotated };
  }
}
const event = (key = "event:42", title = "SECRET-TITLE"): CalendarEvent => ({
  key,
  lookup: { id: key.slice(6) },
  title,
  startsAt: "2026-10-29T04:00:00Z",
  endsAt: "2026-10-29T05:00:00Z",
  calendarIds: ["7"],
  participation: "organizer",
  organizer: "Synthetic organizer",
  organizerId: "synthetic-organizer",
  description: "Agenda",
  location: "Room",
  participants: [
    { id: "p-a", name: "Alpha", status: "accepted", organizer: true },
  ],
});
const complete = (...events: CalendarEvent[]) => ({ events, issues: [] });
async function withCache(
  run: (context: {
    dir: string;
    cipher: FakeCipher;
    clock: { time: number };
    open: (options?: ConstructorParameters<typeof EventCache>[2]) => EventCache;
  }) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), "event-cache-"));
  const cipher = new FakeCipher();
  const clock = { time: 1_800_000_000_000 };
  try {
    await run({
      dir,
      cipher,
      clock,
      open: (options) =>
        new EventCache(dir, cipher, { now: () => clock.time, ...options }),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function files(dir: string) {
  const result: string[] = [];
  // A cleared cache has no directory at all.
  const entries = await readdir(dir, { recursive: true }).catch(() => []);
  for (const entry of entries)
    if (entry.endsWith(".json")) result.push(join(dir, entry));
  return result;
}

test("events survive a restart", async () => {
  await withCache(async ({ open, clock }) => {
    const written = clock.time;
    assert.equal(
      await open().putEvents("a", "week-1", complete(event())),
      true,
    );
    clock.time += 60_000;
    const reopened = open();
    assert.deepEqual(await reopened.getEvents("a", "week-1"), {
      events: [event()],
      issues: [],
      fetchedAt: written,
    });
  });
});

test("event attachments, notification recipients and recurrence survive a restart", async () => {
  await withCache(async ({ open }) => {
    const enriched: CalendarEvent = {
      ...event(),
      attachments: [
        {
          id: "attachment-1",
          name: "agenda.pdf",
          size: 128,
          url: "https://team.small.kz/agenda.pdf",
        },
      ],
      notificationRecipients: [{ id: "p-b", name: "Beta" }],
      recurrenceRule: {
        FREQ: "WEEKLY",
        INTERVAL: 2,
        BYDAY: ["MO"],
        UNTIL: "2026-12-31",
      },
    };
    assert.equal(
      await open().putEvents("a", "week-1", complete(enriched)),
      true,
    );
    assert.deepEqual((await open().getEvents("a", "week-1"))?.events, [
      enriched,
    ]);
  });
});

test("disk holds ciphertext only and no account, key or title in names or bytes", async () => {
  await withCache(async ({ dir, open }) => {
    await open().putEvents("account-secret", "range-secret", complete(event()));
    await open().putCatalog("account-secret", "calendars", [
      { id: "1", name: "SECRET-CALENDAR" },
    ]);
    const all = await files(dir);
    assert.equal(all.length, 2);
    for (const path of all) {
      const text = await readFile(path, "utf8");
      for (const secret of [
        "SECRET-TITLE",
        "SECRET-CALENDAR",
        "account-secret",
        "range-secret",
        "event:42",
        "Synthetic organizer",
      ])
        assert.ok(!text.includes(secret), secret + " in " + path);
      assert.ok(
        !path.includes("account-secret") && !path.includes("range-secret"),
      );
    }
  });
});

test("directory is 0700 and files are 0600", async () => {
  await withCache(async ({ dir, open }) => {
    await open().putEvents("a", "k", complete(event()));
    const [file] = await files(dir);
    assert.equal((await stat(file!)).mode & 0o777, 0o600);
    const [account] = await readdir(dir);
    assert.equal((await stat(join(dir, account!))).mode & 0o777, 0o700);
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
  });
});

test("accounts are isolated and clear removes only one account", async () => {
  await withCache(async ({ dir, open }) => {
    const cache = open();
    await cache.putEvents("a", "k", complete(event("event:1")));
    await cache.putEvents("b", "k", complete(event("event:2")));
    assert.equal((await cache.getEvents("b", "k"))?.events[0]?.key, "event:2");
    await cache.clear("a");
    assert.equal(await cache.getEvents("a", "k"), null);
    assert.equal(await open().getEvents("a", "k"), null);
    assert.equal((await open().getEvents("b", "k"))?.events[0]?.key, "event:2");
    assert.equal((await files(dir)).length, 1);
    await cache.clearAll();
    assert.equal(await open().getEvents("b", "k"), null);
  });
});

test("incomplete or malformed results are not cached", async () => {
  await withCache(async ({ dir, open }) => {
    const cache = open();
    assert.equal(
      await cache.putEvents("a", "k", {
        events: [event()],
        issues: [{ source: "my", kind: "invalid", message: "partial" }],
      }),
      false,
    );
    assert.equal(
      await cache.putEvents("a", "k", {
        events: [{ ...event(), extra: 1 } as CalendarEvent],
        issues: [],
      }),
      false,
    );
    assert.equal(await cache.getEvents("a", "k"), null);
    assert.equal((await files(dir)).length, 0);
  });
});

test("events expire after a week and catalogs after a day, expired files are removed", async () => {
  await withCache(async ({ dir, open, clock }) => {
    const cache = open();
    await cache.putEvents("a", "k", complete(event()));
    await cache.putCatalog("a", "calendars", [{ id: "1" }]);
    clock.time += 25 * 60 * 60 * 1000;
    assert.equal(await open().getCatalog("a", "calendars"), null);
    assert.ok(await open().getEvents("a", "k"));
    clock.time += (5 * 24 + 22) * 60 * 60 * 1000; // 6 days 23 hours after the write
    assert.ok(await open().getEvents("a", "k"));
    clock.time += 2 * 60 * 60 * 1000;
    assert.equal(await open().getEvents("a", "k"), null);
    assert.equal((await files(dir)).length, 0);
  });
});

test("catalog values round-trip as copies", async () => {
  await withCache(async ({ open }) => {
    const cache = open();
    const value = { people: [{ name: "Alpha" }] };
    await cache.putCatalog("a", "people:alpha", value);
    value.people[0]!.name = "Mutated";
    const first = await open().getCatalog<typeof value>("a", "people:alpha");
    assert.equal(first?.value.people[0]?.name, "Alpha");
    first!.value.people[0]!.name = "Changed";
    assert.equal(
      (await cache.getCatalog<typeof value>("a", "people:alpha"))?.value
        .people[0]?.name,
      "Alpha",
    );
  });
});

test("a damaged, undecryptable or wrongly shaped file is a miss and is deleted", async () => {
  await withCache(async ({ dir, open, cipher }) => {
    const cases: Record<string, (path: string) => Promise<void>> = {
      garbage: (path) => writeFile(path, "not json"),
      "wrong envelope": (path) => writeFile(path, '{"v":2,"data":"x"}'),
      "foreign ciphertext": (path) =>
        writeFile(path, JSON.stringify({ v: 1, data: "AAAA" })),
      "wrong payload": async (path) =>
        writeFile(
          path,
          JSON.stringify({
            v: 1,
            data: (await cipher.encrypt('{"version":1,"oops":true}')).toString(
              "base64",
            ),
          }),
        ),
    };
    for (const [name, damage] of Object.entries(cases)) {
      await rm(dir, { recursive: true, force: true });
      await open().putEvents("a", "k", complete(event()));
      const [path] = await files(dir);
      await damage(path!);
      assert.equal(await open().getEvents("a", "k"), null, name);
      assert.equal((await files(dir)).length, 0, name);
    }
  });
});

test("a file copied over another key or another account is rejected", async () => {
  await withCache(async ({ dir, open }) => {
    const digest = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    const pathFor = (account: string, key: string) =>
      join(
        dir,
        digest(account).slice(0, 32),
        digest("events\0" + key) + ".json",
      );
    const cache = open();
    await cache.putEvents("a", "k1", complete(event("event:1")));
    await cache.putEvents("a", "k2", complete(event("event:2")));
    await cache.putEvents("b", "k1", complete(event("event:3")));
    // Another key of the same account.
    await writeFile(pathFor("a", "k2"), await readFile(pathFor("a", "k1")));
    assert.equal(await open().getEvents("a", "k2"), null);
    assert.equal((await files(dir)).includes(pathFor("a", "k2")), false);
    // Another account, same hashed file name.
    await writeFile(pathFor("b", "k1"), await readFile(pathFor("a", "k1")));
    assert.equal(await open().getEvents("b", "k1"), null);
    assert.equal((await files(dir)).includes(pathFor("b", "k1")), false);
    assert.equal(
      (await open().getEvents("a", "k1"))?.events[0]?.key,
      "event:1",
    );
  });
});

test("a rotated key makes the entry a miss", async () => {
  await withCache(async ({ dir, open, cipher }) => {
    await open().putEvents("a", "k", complete(event()));
    cipher.rotated = true;
    assert.equal(await open().getEvents("a", "k"), null);
    assert.equal((await files(dir)).length, 0);
  });
});

test("without encryption nothing is written and data lives in memory only", async () => {
  await withCache(async ({ dir, open, cipher }) => {
    cipher.available = false;
    const cache = open();
    assert.equal(await cache.putEvents("a", "k", complete(event())), true);
    assert.equal((await cache.getEvents("a", "k"))?.events.length, 1);
    assert.deepEqual(await readdir(dir), []);
    assert.equal(await open().getEvents("a", "k"), null);
    cipher.available = true;
    assert.equal(await open().getEvents("a", "k"), null);
  });
});

test("only the most recent entries of an account stay on disk", async () => {
  await withCache(async ({ dir, open, clock }) => {
    const cache = open({ maxEntries: 3 });
    for (let index = 1; index <= 5; index++) {
      clock.time += 1000;
      await cache.putEvents(
        "a",
        "k" + index,
        complete(event("event:" + index)),
      );
    }
    assert.equal((await files(dir)).length, 3);
    const fresh = open({ maxEntries: 3 });
    assert.equal(await fresh.getEvents("a", "k1"), null);
    assert.equal(await fresh.getEvents("a", "k2"), null);
    for (const key of ["k3", "k4", "k5"])
      assert.ok(await fresh.getEvents("a", key), key);
  });
});

test("oversized values are refused", async () => {
  await withCache(async ({ dir, open }) => {
    assert.equal(
      await open().putCatalog("a", "big", "x".repeat(5 * 1024 * 1024)),
      false,
    );
    assert.equal((await files(dir)).length, 0);
  });
});

test("range key depends on the real range and the calendar selection only", () => {
  const key = (
    date: string,
    view: "day" | "week" | "month",
    ids: string[] = [],
  ) =>
    eventRangeKey({
      date,
      view,
      myCalendar: ids.length === 0,
      calendarIds: ids,
    });
  assert.equal(key("2026-10-27", "week"), key("2026-11-01", "week"));
  assert.notEqual(key("2026-10-27", "week"), key("2026-11-02", "week"));
  assert.notEqual(key("2026-10-29", "day"), key("2026-10-29", "week"));
  assert.equal(
    key("2026-10-29", "week", ["2", "1"]),
    key("2026-10-29", "week", ["1", "2", "1"]),
  );
  assert.notEqual(key("2026-10-29", "week"), key("2026-10-29", "week", ["1"]));
});

const weekKey = (date: string) =>
  eventRangeKey({ date, view: "week", myCalendar: true, calendarIds: [] });
const weekOf = {
  first: weekKey("2026-10-29"),
  second: weekKey("2026-11-05"),
  third: weekKey("2026-11-12"),
};
async function threeWeeks(cache: EventCache, account = "a") {
  await cache.putEvents(account, weekOf.first, complete(event("event:1")));
  await cache.putEvents(account, weekOf.second, complete(event("event:2")));
  await cache.putEvents(account, weekOf.third, complete(event("event:3")));
}
const present = async (cache: EventCache, account = "a") =>
  (
    await Promise.all(
      Object.entries(weekOf).map(async ([name, key]) =>
        (await cache.getEvents(account, key)) ? name : null,
      ),
    )
  ).filter(Boolean);

test("a write drops only the ranges its windows or its event touch, in memory and on disk", async () => {
  await withCache(async ({ dir, open }) => {
    const cache = open();
    await threeWeeks(cache);
    // Event 1 moves from the first week into the second.
    await cache.invalidateEvents("a", {
      eventIds: ["1"],
      windows: [
        { start: "2026-10-29T04:00:00Z", end: "2026-10-29T04:30:00Z" },
        { start: "2026-11-05T04:00:00Z", end: "2026-11-05T04:30:00Z" },
      ],
    });
    assert.deepEqual(await present(cache), ["third"]);
    assert.equal((await files(dir)).length, 1);
    // The survivor is also what a restarted app finds.
    assert.deepEqual(await present(open()), ["third"]);
  });
});

test("an event id alone drops the ranges that hold it", async () => {
  await withCache(async ({ open }) => {
    const cache = open();
    await threeWeeks(cache);
    await cache.invalidateEvents("a", { eventIds: ["3"], windows: [] });
    assert.deepEqual(await present(cache), ["first", "second"]);
    assert.deepEqual(await present(open()), ["first", "second"]);
  });
});

test("nothing to match drops nothing; other accounts and catalogs are never touched", async () => {
  await withCache(async ({ open }) => {
    const cache = open();
    await threeWeeks(cache);
    await threeWeeks(cache, "b");
    await cache.putCatalog("a", "calendars", [{ id: "1" }]);
    await cache.invalidateEvents("a", { eventIds: [], windows: [] });
    assert.deepEqual(await present(cache), ["first", "second", "third"]);
    await cache.invalidateEvents("a", {
      eventIds: ["1", "2", "3"],
      windows: [],
    });
    assert.deepEqual(await present(open()), []);
    assert.deepEqual(await present(open(), "b"), ["first", "second", "third"]);
    assert.deepEqual((await open().getCatalog("a", "calendars"))?.value, [
      { id: "1" },
    ]);
  });
});

test("a file that cannot be read cannot prove its range untouched and is dropped", async () => {
  await withCache(async ({ dir, open, cipher }) => {
    await threeWeeks(open());
    const [broken] = await files(dir);
    await writeFile(broken!, "not json");
    await open().invalidateEvents("a", { eventIds: [], windows: [] });
    assert.equal((await files(dir)).length, 2);
    // Without a cipher nothing on disk can be inspected, so all of it goes.
    cipher.available = false;
    await open().invalidateEvents("a", { eventIds: [], windows: [] });
    assert.equal((await files(dir)).length, 0);
  });
});

const settle = async () => {
  for (let index = 0; index < 20; index++)
    await new Promise((resolve) => setImmediate(resolve));
};
const clears = [
  (cache: EventCache) => cache.clearAll(),
  (cache: EventCache) => cache.clear("a"),
];

test("a write that began before a clear does not recreate the cache after it", async () => {
  for (const clear of clears)
    await withCache(async ({ dir, open, cipher }) => {
      const cache = open();
      let release!: () => void;
      // The write is stopped before it has created any directory.
      cipher.holdAvailability = new Promise<void>(
        (resolve) => (release = resolve),
      );
      const write = cache.putEvents("a", "k", complete(event()));
      await settle();
      await clear(cache);
      cipher.holdAvailability = null;
      release();
      await write;
      assert.equal((await files(dir)).length, 0);
      assert.deepEqual(await readdir(dir).catch(() => []), []);
      assert.equal(await open().getEvents("a", "k"), null);
    });
});

test("an old write cannot land in the directory a newer write recreated after a clear", async () => {
  for (const clear of clears)
    await withCache(async ({ dir, open, cipher }) => {
      const cache = open();
      let release!: () => void;
      // The old write is stopped while encrypting; its directory then disappears.
      cipher.hold = new Promise<void>((resolve) => (release = resolve));
      const old = cache.putEvents("a", "old", complete(event("event:1")));
      await settle();
      await clear(cache);
      cipher.hold = null;
      await cache.putEvents("a", "new", complete(event("event:2")));
      release();
      await old;
      const fresh = open();
      assert.equal(await fresh.getEvents("a", "old"), null);
      assert.ok(await fresh.getEvents("a", "new"));
      assert.equal((await files(dir)).length, 1);
    });
});

test("a write that began before an invalidation does not bring the range back", async () => {
  await withCache(async ({ dir, open, cipher }) => {
    const cache = open();
    let release!: () => void;
    cipher.holdAvailability = new Promise<void>(
      (resolve) => (release = resolve),
    );
    const write = cache.putEvents(
      "a",
      weekOf.first,
      complete(event("event:1")),
    );
    await settle();
    await cache.invalidateEvents("a", { eventIds: ["1"], windows: [] });
    cipher.holdAvailability = null;
    release();
    await write;
    assert.equal((await files(dir)).length, 0);
    assert.deepEqual(await present(open()), []);
  });
});

test("the size limit counts bytes, so Cyrillic text cannot double it", async () => {
  await withCache(async ({ open }) => {
    // 3 million characters are 6 MB in UTF-8: over the 4 MB limit.
    assert.equal(
      await open().putCatalog("a", "big", "ж".repeat(3_000_000)),
      false,
    );
    assert.equal(
      await open().putCatalog("a", "ok", "ж".repeat(1_000_000)),
      true,
    );
  });
});

test("directories that already exist with loose modes are tightened", async () => {
  await withCache(async ({ dir, open }) => {
    await open().putEvents("a", "k", complete(event()));
    const [account] = await readdir(dir);
    await chmod(dir, 0o755);
    await chmod(join(dir, account!), 0o755);
    await open().putEvents("a", "k2", complete(event("event:2")));
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
    assert.equal((await stat(join(dir, account!))).mode & 0o777, 0o700);
  });
});

test("temporary files left by a crash are removed once they are old", async () => {
  await withCache(async ({ dir, open, clock }) => {
    await open().putEvents("a", "k", complete(event()));
    const [account] = await readdir(dir);
    const old = join(dir, account!, "x.json.old.tmp");
    const recent = join(dir, account!, "y.json.recent.tmp");
    await writeFile(old, "ciphertext");
    await writeFile(recent, "ciphertext");
    const stamp = (ageMs: number) => (clock.time - ageMs) / 1000;
    await utimes(old, stamp(10 * 60_000), stamp(10 * 60_000));
    await utimes(recent, stamp(10_000), stamp(10_000));
    await open().putEvents("a", "k2", complete(event("event:2")));
    const left = await readdir(join(dir, account!));
    assert.equal(left.includes("x.json.old.tmp"), false);
    assert.equal(left.includes("y.json.recent.tmp"), true);
  });
});

test("events that carry the series identity the calendar reports are cached, not refused", async () => {
  await withCache(async ({ open }) => {
    const reported: CalendarEvent = {
      ...event("event:50"),
      originalEventId: "9",
      aliases: ["series:9:111", "event:50"],
    };
    const cache = open();
    assert.equal(await cache.putEvents("a", "k", complete(reported)), true);
    assert.deepEqual((await open().getEvents("a", "k"))?.events, [reported]);
    // A range holding an occurrence of series 9 is dropped when series 9 is written.
    await cache.invalidateEvents("a", { eventIds: ["9"], windows: [] });
    assert.equal(await open().getEvents("a", "k"), null);
  });
});
