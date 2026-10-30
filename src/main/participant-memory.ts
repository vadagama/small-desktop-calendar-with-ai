import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { CalendarPerson } from "../shared/calendar.js";
const entry = z.object({
  participantId: z.string().min(1).max(128),
  name: z.string().max(500),
  position: z.string().max(500),
  aliases: z.array(z.string().max(100)).max(20),
  uses: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type RememberedParticipant = z.infer<typeof entry>;
export class ParticipantMemory {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private directory: string,
    private store?: {
      read(account: string): Promise<{ participants: RememberedParticipant[] }>;
      updateParticipants(
        account: string,
        change: (people: RememberedParticipant[]) => RememberedParticipant[],
      ): Promise<RememberedParticipant[]>;
    },
  ) {}
  private path(account: string) {
    return join(
      this.directory,
      "participant-memory",
      createHash("sha256").update(account).digest("hex") + ".json",
    );
  }
  private async load(account: string): Promise<RememberedParticipant[]> {
    if (this.store) return (await this.store.read(account)).participants;
    try {
      return z
        .array(entry)
        .max(100)
        .parse(JSON.parse(await readFile(this.path(account), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error("Не удалось прочитать память участников");
    }
  }
  async read(account: string) {
    await this.pending;
    return this.load(account);
  }
  private update(
    account: string,
    change: (items: RememberedParticipant[]) => RememberedParticipant[],
    clear = false,
  ) {
    const operation = this.pending.then(async () => {
      if (this.store)
        return this.store.updateParticipants(account, (items) =>
          change(clear ? [] : items)
            .sort(
              (a, b) =>
                b.uses - a.uses || b.updatedAt.localeCompare(a.updatedAt),
            )
            .slice(0, 100),
        );
      const items = z
        .array(entry)
        .max(100)
        .parse(
          change(clear ? [] : await this.load(account))
            .sort(
              (a, b) =>
                b.uses - a.uses || b.updatedAt.localeCompare(a.updatedAt),
            )
            .slice(0, 100),
        );
      const path = this.path(account),
        temp = path + "." + crypto.randomUUID() + ".tmp";
      await mkdir(join(this.directory, "participant-memory"), {
        recursive: true,
        mode: 0o700,
      });
      try {
        await writeFile(temp, JSON.stringify(items), { mode: 0o600 });
        await rename(temp, path);
      } finally {
        await rm(temp, { force: true });
      }
      return items;
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
  remember(account: string, person: CalendarPerson, alias: string) {
    return this.update(account, (items) => {
      // An explicit correction transfers the alias instead of leaving two meanings.
      for (const item of items)
        item.aliases = item.aliases.filter(
          (a) => a.toLocaleLowerCase() !== alias.toLocaleLowerCase(),
        );
      const existing = items.find(
        (p) => p.participantId === person.participantId,
      );
      const item = existing ?? {
        ...person,
        aliases: [],
        uses: 0,
        updatedAt: "",
      };
      Object.assign(item, person, { updatedAt: new Date().toISOString() });
      item.aliases = [...item.aliases, alias].slice(-20);
      return existing ? items : [...items, item];
    });
  }
  used(account: string, people: CalendarPerson[]) {
    return this.update(account, (items) => {
      for (const person of people) {
        let item = items.find((p) => p.participantId === person.participantId);
        if (!item) {
          item = { ...person, aliases: [], uses: 0, updatedAt: "" };
          items.push(item);
        }
        Object.assign(item, person, {
          uses: item.uses + 1,
          updatedAt: new Date().toISOString(),
        });
      }
      return items;
    });
  }
  forget(account: string, id?: string) {
    return this.update(
      account,
      (items) => (id ? items.filter((p) => p.participantId !== id) : []),
      !id,
    );
  }
}
