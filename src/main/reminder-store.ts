import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
export const reminderSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  minutes: z.number().int().min(0).max(60),
});
const schema = z.strictObject({
  settings: reminderSettingsSchema,
  sent: z.record(z.string().regex(/^[a-f0-9]{64}$/), z.number().finite()),
});
export class ReminderStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}
  private async load() {
    try {
      return schema.parse(
        JSON.parse(
          await readFile(join(this.directory, "reminders.json"), "utf8"),
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return {
          settings: { enabled: true, minutes: 5 },
          sent: {} as Record<string, number>,
        };
      throw new Error("Не удалось прочитать настройки напоминаний.");
    }
  }
  async read() {
    await this.pending;
    return this.load();
  }
  private change<T>(action: (data: z.infer<typeof schema>) => T) {
    const operation = this.pending.then(async () => {
      const data = await this.load();
      const result = action(data);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const path = join(this.directory, "reminders.json");
      await writeFile(path + ".tmp", JSON.stringify(data), { mode: 0o600 });
      await rename(path + ".tmp", path);
      return result;
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
  save(input: unknown) {
    const settings = reminderSettingsSchema.parse(input);
    return this.change((data) => {
      data.settings = settings;
    });
  }
  claim(id: string, endsAt: number, now: number) {
    return this.change((data) => {
      for (const [key, end] of Object.entries(data.sent))
        if (end < now - 30 * 86400000) delete data.sent[key];
      if (data.sent[id] !== undefined) {
        data.sent[id] = Math.max(data.sent[id]!, endsAt);
        return false;
      }
      data.sent[id] = endsAt;
      return true;
    });
  }
}
