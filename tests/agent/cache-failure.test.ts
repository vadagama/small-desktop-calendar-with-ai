import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fsPromises from "node:fs/promises";
import { chmod, mkdtemp, readdir, rm, unlink } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CalendarError } from "../../src/main/calendar.js";
import { CalendarSync } from "../../src/main/calendar-sync.js";
import { EventCache, eventRangeKey } from "../../src/main/event-cache.js";
import { invalidatingSeries } from "../../src/main/series-invalidation.js";
import type { SeriesController } from "../../src/main/series-controller.js";
import type {
  CalendarEvent,
  CalendarQuery,
} from "../../src/shared/calendar.js";

const query: CalendarQuery = {
  accountId: "synthetic-account",
  date: "2026-10-29",
  view: "week",
  myCalendar: true,
  calendarIds: [],
};
const oldEvent: CalendarEvent = {
  key: "event:42",
  lookup: { id: "42" },
  title: "Synthetic old meeting",
  startsAt: "2026-10-29T04:00:00Z",
  endsAt: "2026-10-29T05:00:00Z",
  calendarIds: [],
  organizer: "Synthetic organizer",
  description: "",
  location: "",
};

/** A real deletion failure, with a writable parent for durable invalidation metadata. */
async function withLockedCache(
  run: (
    cache: EventCache,
    reopen: () => EventCache,
    lock: (wholeCache?: boolean) => Promise<void>,
  ) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "small-cache-failure-"));
  const directory = join(root, "cache");
  const accountDirectory = join(
    directory,
    createHash("sha256").update(query.accountId).digest("hex").slice(0, 32),
  );
  const cipher = {
    isAvailable: async () => true,
    encrypt: async (text: string) => Buffer.from(text),
    decrypt: async (bytes: Buffer) => ({
      result: bytes.toString(),
      shouldReEncrypt: false,
    }),
  };
  const reopen = () => new EventCache(directory, cipher);
  const cache = reopen();
  try {
    await cache.putEvents(query.accountId, eventRangeKey(query), {
      events: [oldEvent],
      issues: [],
    });
    const storedFile = (await readdir(accountDirectory)).find((name) =>
      name.endsWith(".json"),
    );
    assert.ok(storedFile, "fixture must reach the real disk cache");
    await run(cache, reopen, async (wholeCache = false) => {
      await chmod(accountDirectory, 0o500);
      await assert.rejects(unlink(join(accountDirectory, storedFile)), {
        code: "EACCES",
      });
      if (wholeCache) await chmod(root, 0o500);
    });
  } finally {
    await chmod(root, 0o700).catch(() => {});
    await chmod(accountDirectory, 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}

function syncFor(cache: EventCache) {
  return new CalendarSync(
    { events: async () => ({ events: [], issues: [] }) },
    cache,
    () => {},
    { schedule: () => () => {} },
  );
}

test("a completed write stays successful when disk cache deletion is denied", async () => {
  await withLockedCache(async (cache, _reopen, lock) => {
    const applied = { status: "applied" };
    const series = {
      gate: async () => ({}),
      apply: async () => {
        await lock();
        return applied;
      },
    } as unknown as Pick<SeriesController, "gate" | "apply">;
    assert.equal(
      await invalidatingSeries(series, syncFor(cache)).apply({}),
      applied,
    );
  });
});

test("cache deletion failure preserves the original unknown write outcome", async () => {
  await withLockedCache(async (cache, _reopen, lock) => {
    const unknown = new CalendarError(
      "network",
      "Synthetic unknown outcome",
      true,
    );
    const series = {
      gate: async () => ({}),
      apply: async () => {
        await lock();
        throw unknown;
      },
    } as unknown as Pick<SeriesController, "gate" | "apply">;
    await assert.rejects(
      invalidatingSeries(series, syncFor(cache)).apply({}),
      (error) => error === unknown,
    );
  });
});

for (const targeted of [false, true]) {
  test(`${targeted ? "targeted" : "full"} failed invalidation cannot resurrect old events after restart`, async () => {
    await withLockedCache(async (cache, reopen, lock) => {
      await syncFor(cache).write(
        async () => lock(),
        targeted
          ? { accountId: query.accountId, eventIds: ["42"], windows: [] }
          : undefined,
      );
      assert.equal(
        await cache.getEvents(query.accountId, eventRangeKey(query)),
        null,
      );
      assert.equal(
        await reopen().getEvents(query.accountId, eventRangeKey(query)),
        null,
      );
    });
  });
}

test("a calendar write does not run when its durable cache barrier cannot be saved", async () => {
  await withLockedCache(async (cache, _reopen, lock) => {
    await lock(true);
    let remoteWrites = 0;
    await assert.rejects(
      syncFor(cache).write(async () => {
        remoteWrites++;
      }),
    );
    assert.equal(remoteWrites, 0);
  });
});

test("one completed write cannot remove another concurrent write's crash guard", async () => {
  await withLockedCache(async (cache, reopen) => {
    await Promise.all([cache.beginWrite(), cache.beginWrite()]);
    // The first write touched another range; this entry could still be affected
    // by the second write, whose process dies before cleanup/endWrite.
    await cache.invalidateEvents(query.accountId, {
      eventIds: ["99"],
      windows: [],
    });
    await cache.endWrite(true);
    assert.equal(
      await reopen().getEvents(query.accountId, eventRangeKey(query)),
      null,
    );
  });
});

test("after both concurrent writes finish, untouched disk entries remain reusable", async () => {
  await withLockedCache(async (cache, reopen) => {
    await Promise.all([cache.beginWrite(), cache.beginWrite()]);
    await cache.invalidateEvents(query.accountId, {
      eventIds: ["99"],
      windows: [],
    });
    await Promise.all([cache.endWrite(true), cache.endWrite(true)]);
    assert.deepEqual(
      (await reopen().getEvents(query.accountId, eventRangeKey(query)))?.events,
      [oldEvent],
    );
  });
});

test("failed disk cleanup still permits freshly fetched data in memory", async () => {
  await withLockedCache(async (cache, reopen, lock) => {
    await syncFor(cache).write(async () => lock());
    await cache.putEvents(query.accountId, eventRangeKey(query), {
      events: [],
      issues: [],
    });
    assert.deepEqual(
      (await cache.getEvents(query.accountId, eventRangeKey(query)))?.events,
      [],
    );
    assert.equal(
      await reopen().getEvents(query.accountId, eventRangeKey(query)),
      null,
    );
  });
});

test("a disk read finishing after a write starts cannot return the old entry", async () => {
  await withLockedCache(async (_cache, reopen) => {
    const reader = reopen();
    let reached!: () => void;
    const touchingFile = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = fsPromises.utimes;
    fsPromises.utimes = async (...args) => {
      reached();
      await held;
      return original(...args);
    };
    syncBuiltinESMExports();
    try {
      const pending = reader.getEvents(query.accountId, eventRangeKey(query));
      await touchingFile;
      await reader.beginWrite();
      release();
      assert.equal(await pending, null);
    } finally {
      release();
      fsPromises.utimes = original;
      syncBuiltinESMExports();
    }
  });
});

test("a calendar mutation waits for an older pending cache rename to finish", async () => {
  await withLockedCache(async (cache, reopen) => {
    let reached!: () => void;
    const renaming = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = fsPromises.rename;
    fsPromises.rename = async (...args) => {
      reached();
      await held;
      return original(...args);
    };
    syncBuiltinESMExports();
    let persisted = false;
    let pending: Promise<unknown> | undefined;
    try {
      pending = cache
        .putEvents(query.accountId, eventRangeKey(query), {
          events: [{ ...oldEvent, title: "Synthetic pending old snapshot" }],
          issues: [],
        })
        .then(() => {
          persisted = true;
        });
      await renaming;
      // Keep the filesystem operation outstanding long enough for an incorrectly
      // unguarded mutation to start. The assertion is about ordering, not elapsed time.
      const timer = setTimeout(release, 100);
      try {
        await syncFor(cache).write(
          async () => {
            assert.equal(
              persisted,
              true,
              "server mutation must wait for cache persistence",
            );
          },
          { accountId: query.accountId, eventIds: ["42"], windows: [] },
        );
      } finally {
        clearTimeout(timer);
        release();
      }
      await pending;
      assert.equal(
        await reopen().getEvents(query.accountId, eventRangeKey(query)),
        null,
      );
    } finally {
      release();
      await pending;
      fsPromises.rename = original;
      syncBuiltinESMExports();
    }
  });
});
