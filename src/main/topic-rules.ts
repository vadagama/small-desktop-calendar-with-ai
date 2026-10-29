import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { topicRulesSchema, type TopicRule } from "../shared/analytics.js";

const fileSchema = z.strictObject({ rules: topicRulesSchema });

/** Local keyword rules for report topics; contains no meeting content. */
export class TopicRuleStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}
  async read(): Promise<TopicRule[]> {
    await this.pending;
    try {
      return fileSchema.parse(
        JSON.parse(
          await readFile(join(this.directory, "topic-rules.json"), "utf8"),
        ),
      ).rules;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error("Не удалось прочитать правила тем.");
    }
  }
  /** Replaces the whole list; a corrupted file is repaired only by an explicit save. */
  save(input: unknown): Promise<TopicRule[]> {
    const rules = topicRulesSchema.parse(input);
    const operation = this.pending.then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = join(
        this.directory,
        `topic-rules.${crypto.randomUUID()}.tmp`,
      );
      try {
        await writeFile(temporary, JSON.stringify({ rules }), { mode: 0o600 });
        await rename(temporary, join(this.directory, "topic-rules.json"));
      } finally {
        await rm(temporary, { force: true });
      }
      return rules;
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
}
