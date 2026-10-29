import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const intent = z.strictObject({ payloadHash: hash });
const receipt = z.strictObject({
  phase: z.enum(["unknown", "succeeded"]),
  eventId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .optional(),
});
export type MeetingReceipt = z.infer<typeof receipt>;
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT";

/** Exclusive durable claim survives crashes; no calendar payload or credentials on disk. */
export class MeetingJournal {
  constructor(private directory: string) {}
  private path(key: string, suffix: string) {
    return join(this.directory, hash.parse(key) + suffix);
  }
  private async syncDirectory() {
    const handle = await open(this.directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  async claim(key: string, payloadHash: string) {
    const path = this.path(key, ".intent");
    const data = JSON.stringify(intent.parse({ payloadHash }));
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    let handle;
    try {
      handle = await open(path, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await this.syncDirectory();
    return true;
  }
  async read(
    key: string,
  ): Promise<(MeetingReceipt & { payloadHash: string }) | null> {
    let raw;
    try {
      raw = await readFile(this.path(key, ".intent"), "utf8");
    } catch (e) {
      if (missing(e)) return null;
      throw e;
    }
    const stored = intent.parse(JSON.parse(raw));
    let result: MeetingReceipt = { phase: "unknown" };
    try {
      result = receipt.parse(
        JSON.parse(await readFile(this.path(key, ".result"), "utf8")),
      );
    } catch (e) {
      if (!missing(e)) throw e;
    }
    return { ...stored, ...result };
  }
  async finish(key: string, result: MeetingReceipt) {
    if (!(await this.read(key))) throw new Error("Missing operation intent");
    const path = this.path(key, ".result");
    const temporary = path + "." + randomUUID();
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(receipt.parse(result)));
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, path);
      await this.syncDirectory();
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
}
