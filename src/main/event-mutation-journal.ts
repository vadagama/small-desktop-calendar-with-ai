import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const mutationHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const record = z.strictObject({
  requestHash: hash,
  resultHash: hash,
  kind: z.enum(["update", "delete"]),
  acknowledged: z.boolean(),
});
export type EventMutationRecord = z.infer<typeof record>;

/** Only hashes and operation state are persisted; no meeting contents or secrets. */
export class EventMutationJournal {
  constructor(private directory: string) {}
  private path(account: string, event: string) {
    return join(this.directory, mutationHash([account, event]) + ".json");
  }
  private async sync() {
    const directory = await open(this.directory, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  async read(
    account: string,
    event: string,
  ): Promise<EventMutationRecord | null> {
    try {
      return record.parse(
        JSON.parse(await readFile(this.path(account, event), "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  async claim(account: string, event: string, value: EventMutationRecord) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = await open(this.path(account, event), "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(record.parse(value)));
      await file.sync();
    } finally {
      await file.close();
    }
    await this.sync();
  }
  async acknowledge(account: string, event: string) {
    const value = await this.read(account, event);
    if (!value) throw new Error("Missing mutation intent");
    const path = this.path(account, event);
    const temporary = path + "." + randomUUID();
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify({ ...value, acknowledged: true }));
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await rename(temporary, path);
      await this.sync();
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  async clear(account: string, event: string) {
    await unlink(this.path(account, event));
    await this.sync();
  }
}
