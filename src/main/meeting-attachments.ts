import { dialog } from "electron";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { z } from "zod";
import { calendarJson } from "./calendar.js";
import { SmallAuthError, type SmallAuth } from "./small-auth.js";
import { maxAttachmentBytes } from "./attachment-request.js";
export class MeetingAttachments {
  private uploaded = new Map<string, number>();
  constructor(private auth: SmallAuth) {}
  owns(ids: string[], revision: number) {
    return ids.every((id) => this.uploaded.get(id) === revision);
  }
  async choose(assertCurrent: () => void, remaining: number) {
    if (!Number.isInteger(remaining) || remaining < 1 || remaining > 5)
      throw new SmallAuthError("Достигнут лимит 5 файлов.");
    const revision = this.auth.sessionRevision;
    const state = await this.auth.read();
    assertCurrent();
    if (state.status !== "signed-in")
      throw new SmallAuthError("Войдите в Small.", "auth");
    const choice = await dialog.showOpenDialog({
      title: "Прикрепить файлы к встрече",
      properties: ["openFile", "multiSelections"],
    });
    assertCurrent();
    if (choice.canceled) return [];
    if (choice.filePaths.length > remaining)
      throw new SmallAuthError(
        "Выбранные файлы превышают оставшийся лимит. Уберите лишние файлы.",
      );
    for (const path of choice.filePaths) {
      const info = await stat(path);
      if (!info.isFile() || info.size === 0 || info.size > maxAttachmentBytes)
        throw new SmallAuthError(
          "Каждый файл должен быть от 1 байта до 10 МБ.",
        );
    }
    const files = [];
    for (const path of choice.filePaths) {
      assertCurrent();
      const bytes = await readFile(path);
      const name = basename(path);
      const form = new FormData();
      form.set("file", new Blob([new Uint8Array(bytes)]), name);
      form.set("is_public", "true");
      const result = z
        .object({
          data: z.object({
            id: z
              .union([
                z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
                z.number().int().positive(),
              ])
              .transform(String),
          }),
        })
        .parse(
          await calendarJson(
            await this.auth.uploadAttachment(state.profile.id, form),
          ),
        );
      assertCurrent();
      this.uploaded.set(result.data.id, revision);
      files.push({ id: result.data.id, name });
    }
    return files;
  }
}
