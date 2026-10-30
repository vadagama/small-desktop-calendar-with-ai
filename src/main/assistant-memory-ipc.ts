import { CalendarError } from "./calendar.js";
import { memoryChannels } from "../shared/assistant-memory-channels.js";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import type { SmallAuth } from "./small-auth.js";
import { MemoryError, type AssistantMemoryStore } from "./assistant-memory.js";
import type { MemoryProposals } from "./memory-proposals.js";
import {
  type MemoryReply,
  type MemoryChange,
  memoryWrite,
} from "../shared/assistant-memory.js";

export function registerMemoryHandlers(
  store: AssistantMemoryStore,
  proposals: MemoryProposals,
  auth: SmallAuth,
  trusted: (event: IpcMainInvokeEvent) => boolean,
  validate: (account: string, change: MemoryChange) => Promise<void>,
) {
  for (const action of ["read", "write", "confirm", "reset"] as const) {
    ipcMain.handle(
      memoryChannels[action],
      async (event, input: unknown): Promise<MemoryReply> => {
        const epoch = auth.sessionRevision;
        const check = () => {
          if (!trusted(event) || epoch !== auth.sessionRevision)
            throw new MemoryError(
              "Аккаунт или окно изменились.",
              "unavailable",
            );
        };
        try {
          check();
          const account = await auth.read();
          check();
          if (account.status !== "signed-in")
            return {
              ok: false,
              kind: "denied",
              error: "Войдите в Small, чтобы управлять памятью.",
            };
          const id = account.profile.id;
          if (action === "write") {
            const request = memoryWrite.parse(input);
            await validate(id, request.change);
            check();
            input = request;
          }
          const state =
            action === "read"
              ? await store.read(id)
              : action === "write"
                ? await store.write(id, input, undefined, check)
                : action === "confirm"
                  ? await proposals.confirm(
                      id,
                      z.strictObject({ id: z.uuid() }).parse(input).id,
                      event.sender.id,
                      epoch,
                      check,
                    )
                  : await store.reset(id, check);
          check();
          return { ok: true, accountId: id, state };
        } catch (error) {
          return {
            ok: false,
            kind:
              error instanceof MemoryError
                ? error.kind
                : error instanceof z.ZodError || error instanceof CalendarError
                  ? "invalid"
                  : "unavailable",
            error:
              error instanceof MemoryError || error instanceof CalendarError
                ? error.message
                : error instanceof z.ZodError
                  ? "Проверьте поля памяти и их допустимые значения."
                  : "Не удалось прочитать или сохранить память. Данные не заменены пустыми.",
          };
        }
      },
    );
  }
}
