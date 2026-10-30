import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
} from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { CalendarEvent, CalendarQuery } from "../shared/calendar.js";
import type { CalendarSnapshot } from "../shared/calendar-diff.js";
import { calendarRange } from "../shared/calendar-time.js";
import {
  invalidationAffects,
  type EventInvalidation,
  type TimeWindow,
} from "../shared/calendar-invalidation.js";

/** Encrypts cache files. a local authenticated cipher in the app, a fake in tests. */
export interface CacheCipher {
  isAvailable(): Promise<boolean>;
  encrypt(text: string): Promise<Buffer>;
  decrypt(data: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}
export interface EventCacheOptions {
  now?: () => number;
  eventsMaxAgeMs?: number;
  catalogMaxAgeMs?: number;
  /** Disk entries kept per account; the least recently written or read go first. */
  maxEntries?: number;
}
export interface CachedCatalog<T> {
  value: T;
  fetchedAt: number;
}

const DAY = 24 * 60 * 60 * 1000;
const MAX_VALUE_BYTES = 4 * 1024 * 1024;
const MAX_MEMORY_ENTRIES = 64;
const ORPHAN_AGE_MS = 5 * 60 * 1000;

const participant = z.strictObject({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  organizer: z.boolean(),
});
const calendarEvent = z.strictObject({
  attachments: z
    .array(
      z.strictObject({
        id: z.string(),
        name: z.string(),
        size: z.number().optional(),
        url: z.string().optional(),
      }),
    )
    .optional(),
  notificationRecipients: z
    .array(
      z.strictObject({
        id: z.string(),
        name: z.string(),
      }),
    )
    .optional(),
  recurrenceRule: z
    .strictObject({
      FREQ: z.string(),
      INTERVAL: z.number().int().positive().optional(),
      BYDAY: z.array(z.string()).optional(),
      UNTIL: z.string().optional(),
    })
    .optional(),
  participants: z.array(participant).optional(),
  recurring: z.boolean().optional(),
  originalEventId: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  key: z.string(),
  lookup: z.union([
    z.strictObject({ id: z.string() }),
    z.strictObject({ originalEventId: z.string(), date: z.string() }),
  ]),
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  calendarIds: z.array(z.string()),
  participation: z
    .enum(["organizer", "invited", "informed", "unknown"])
    .optional(),
  accepted: z.boolean().optional(),
  organizer: z.string(),
  description: z.string(),
  location: z.string(),
});
const eventsValue = z.strictObject({
  events: z.array(calendarEvent),
  issues: z.array(
    z.strictObject({
      source: z.string(),
      kind: z.enum(["auth", "denied", "network", "invalid", "not-found"]),
      message: z.string(),
    }),
  ),
});
const kind = z.enum(["events", "catalog"]);
type Kind = z.infer<typeof kind>;
const payload = z.strictObject({
  version: z.literal(1),
  kind,
  accountId: z.string(),
  key: z.string(),
  fetchedAt: z.number().int().nonnegative(),
  value: z.unknown(),
});
const envelope = z.strictObject({ v: z.literal(1), data: z.string() });

interface Entry {
  fetchedAt: number;
  json: string;
}
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/**
 * Key of one cached query: the real range (so any date inside one week shares an
 * entry), the calendar selection, never the account.
 */
export function eventRangeKey(
  query: Pick<CalendarQuery, "date" | "view" | "myCalendar" | "calendarIds">,
) {
  const range = calendarRange(query.date, query.view);
  return JSON.stringify([
    range.start,
    range.end,
    query.myCalendar,
    [...new Set(query.calendarIds)].sort(),
  ]);
}

/**
 * Best-effort cache of calendar data. Disk files exist only when the cipher is
 * available, hold ciphertext only and live in a per-account directory; without a
 * cipher everything stays in memory. A damaged, expired, foreign or stale-key file
 * is a miss and is deleted, never an error: the cache can always be rebuilt from Small.
 */
export class EventCache {
  private memory = new Map<string, Entry>();
  // Grows on every clear or invalidation; a write that began earlier must not land after it.
  private epoch = 0;
  private now: () => number;
  private eventsMaxAgeMs: number;
  private catalogMaxAgeMs: number;
  private maxEntries: number;
  constructor(
    private directory: string,
    private cipher: CacheCipher,
    options: EventCacheOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.eventsMaxAgeMs = options.eventsMaxAgeMs ?? 7 * DAY;
    this.catalogMaxAgeMs = options.catalogMaxAgeMs ?? DAY;
    this.maxEntries = options.maxEntries ?? 40;
  }
  private accountDirectory(account: string) {
    return join(this.directory, digest(account).slice(0, 32));
  }
  private path(kind: Kind, account: string, key: string) {
    return join(
      this.accountDirectory(account),
      digest(kind + "\0" + key) + ".json",
    );
  }
  private memoryKey(kind: Kind, account: string, key: string) {
    return [account, kind, key].join("\0");
  }
  private async load(
    kind: Kind,
    account: string,
    key: string,
    maxAgeMs: number,
  ): Promise<Entry | null> {
    const id = this.memoryKey(kind, account, key);
    const cached = this.memory.get(id);
    if (cached) {
      if (this.now() - cached.fetchedAt <= maxAgeMs) {
        this.memory.delete(id);
        this.memory.set(id, cached);
        return cached;
      }
      this.memory.delete(id);
    }
    const path = this.path(kind, account, key);
    const drop = () => rm(path, { force: true });
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      return null;
    }
    try {
      if (!(await this.cipher.isAvailable())) return null;
      const file = envelope.parse(JSON.parse(text));
      const plain = await this.cipher.decrypt(Buffer.from(file.data, "base64"));
      if (plain.shouldReEncrypt) throw new Error("Key was rotated");
      const body = payload.parse(JSON.parse(plain.result));
      if (
        body.kind !== kind ||
        body.accountId !== account ||
        body.key !== key ||
        this.now() - body.fetchedAt > maxAgeMs
      )
        throw new Error("Foreign or expired entry");
      if (kind === "events") eventsValue.parse(body.value);
      const entry = {
        fetchedAt: body.fetchedAt,
        json: JSON.stringify(body.value),
      };
      this.remember(id, entry);
      const stamp = this.now() / 1000;
      await utimes(path, stamp, stamp).catch(() => {});
      return entry;
    } catch {
      await drop();
      return null;
    }
  }
  private remember(id: string, entry: Entry) {
    this.memory.delete(id);
    this.memory.set(id, entry);
    if (this.memory.size > MAX_MEMORY_ENTRIES)
      this.memory.delete(this.memory.keys().next().value as string);
  }
  private async store(
    kind: Kind,
    account: string,
    key: string,
    value: unknown,
  ): Promise<boolean> {
    const json = JSON.stringify(value);
    if (json === undefined || Buffer.byteLength(json) > MAX_VALUE_BYTES)
      return false;
    const entry = { fetchedAt: this.now(), json };
    this.remember(this.memoryKey(kind, account, key), entry);
    await this.persist(kind, account, key, entry).catch(() => {});
    return true;
  }
  private async persist(
    kind: Kind,
    account: string,
    key: string,
    entry: Entry,
  ) {
    const epoch = this.epoch;
    if (!(await this.cipher.isAvailable())) return;
    if (epoch !== this.epoch) return;
    const directory = this.accountDirectory(account);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    // mkdir only sets the mode of directories it creates, and subject to the umask.
    await chmod(this.directory, 0o700).catch(() => {});
    await chmod(directory, 0o700).catch(() => {});
    const encrypted = await this.cipher.encrypt(
      JSON.stringify({
        version: 1,
        kind,
        accountId: account,
        key,
        fetchedAt: entry.fetchedAt,
        value: JSON.parse(entry.json),
      }),
    );
    if (epoch !== this.epoch) return;
    const path = this.path(kind, account, key);
    const temporary = path + "." + randomUUID() + ".tmp";
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(
          JSON.stringify({ v: 1, data: encrypted.toString("base64") }),
        );
        await file.sync();
      } finally {
        await file.close();
      }
      if (epoch !== this.epoch) return;
      await rename(temporary, path);
      if (epoch !== this.epoch) {
        await rm(path, { force: true });
        return;
      }
      const stamp = this.now() / 1000;
      await utimes(path, stamp, stamp);
      const folder = await open(directory, "r");
      try {
        await folder.sync();
      } finally {
        await folder.close();
      }
    } finally {
      await rm(temporary, { force: true });
    }
    await this.evict(directory);
  }
  private async evict(directory: string) {
    try {
      const all = await readdir(directory);
      // A crash between creating and renaming a file leaves its temporary copy behind.
      for (const name of all.filter((entry) => entry.endsWith(".tmp"))) {
        const age = this.now() - (await stat(join(directory, name))).mtimeMs;
        if (age > ORPHAN_AGE_MS)
          await rm(join(directory, name), { force: true });
      }
      const names = all.filter((name) => name.endsWith(".json"));
      if (names.length <= this.maxEntries) return;
      const stamped = await Promise.all(
        names.map(async (name) => ({
          name,
          time: (await stat(join(directory, name))).mtimeMs,
        })),
      );
      stamped.sort((a, b) => b.time - a.time || (a.name < b.name ? -1 : 1));
      for (const { name } of stamped.slice(this.maxEntries))
        await rm(join(directory, name), { force: true });
    } catch {
      // Eviction is housekeeping; a failure only leaves extra files for the next pass.
    }
  }

  async getEvents(
    account: string,
    key: string,
  ): Promise<CalendarSnapshot | null> {
    const entry = await this.load("events", account, key, this.eventsMaxAgeMs);
    if (!entry) return null;
    const value = eventsValue.parse(JSON.parse(entry.json));
    return {
      events: value.events as CalendarEvent[],
      issues: value.issues,
      fetchedAt: entry.fetchedAt,
    };
  }
  /** Incomplete results (any issue) are refused: a partial list must not look complete. */
  putEvents(
    account: string,
    key: string,
    snapshot: Pick<CalendarSnapshot, "events" | "issues">,
  ) {
    const value = { events: snapshot.events, issues: [] };
    if (snapshot.issues.length || !eventsValue.safeParse(value).success)
      return Promise.resolve(false);
    return this.store("events", account, key, value);
  }
  async getCatalog<T = unknown>(
    account: string,
    key: string,
  ): Promise<CachedCatalog<T> | null> {
    const entry = await this.load(
      "catalog",
      account,
      key,
      this.catalogMaxAgeMs,
    );
    return entry
      ? { value: JSON.parse(entry.json) as T, fetchedAt: entry.fetchedAt }
      : null;
  }
  /** Slowly changing data such as the calendar list or a people search page. */
  putCatalog(account: string, key: string, value: unknown) {
    return this.store("catalog", account, key, value);
  }
  /**
   * Drops only the cached ranges a write may have changed: those that overlap one of
   * its time windows or hold one of its events. Catalogs stay. A file that cannot be
   * read cannot prove its range untouched, so it goes too.
   */
  async invalidateEvents(account: string, match: EventInvalidation) {
    this.epoch++;
    const affected = (key: string, value: unknown) => {
      const events = eventsValue.safeParse(value);
      if (!events.success) return true;
      let range: TimeWindow | null = null;
      try {
        const [start, end] = JSON.parse(key) as unknown[];
        if (typeof start === "string" && typeof end === "string")
          range = { start, end };
      } catch {
        // An unreadable key leaves the range unknown, which counts as affected.
      }
      // zod reports optional fields as `| undefined`, which the shared type forbids.
      return invalidationAffects(
        range,
        events.data.events as CalendarEvent[],
        match,
      );
    };
    for (const [id, entry] of [...this.memory]) {
      const [owner, kind, key] = id.split("\0");
      if (
        owner === account &&
        kind === "events" &&
        affected(key!, JSON.parse(entry.json))
      )
        this.memory.delete(id);
    }
    const directory = this.accountDirectory(account);
    let names: string[];
    try {
      names = (await readdir(directory)).filter((name) =>
        name.endsWith(".json"),
      );
    } catch {
      return;
    }
    const readable = await this.cipher.isAvailable().catch(() => false);
    for (const name of names) {
      const path = join(directory, name);
      try {
        if (!readable) throw new Error("Cannot read without a cipher");
        const file = envelope.parse(JSON.parse(await readFile(path, "utf8")));
        const plain = await this.cipher.decrypt(
          Buffer.from(file.data, "base64"),
        );
        if (plain.shouldReEncrypt) throw new Error("Key was rotated");
        const body = payload.parse(JSON.parse(plain.result));
        if (
          body.kind === "events" &&
          body.accountId === account &&
          !affected(body.key, body.value)
        )
          continue;
        if (body.kind === "catalog" && body.accountId === account) continue;
      } catch {
        // Fall through: unreadable, foreign or rotated files are dropped.
      }
      await rm(path, { force: true });
    }
  }
  async clear(account: string) {
    this.epoch++;
    for (const id of [...this.memory.keys()])
      if (id.startsWith(account + "\0")) this.memory.delete(id);
    await rm(this.accountDirectory(account), {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
  async clearAll() {
    this.epoch++;
    this.memory.clear();
    await rm(this.directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
}
