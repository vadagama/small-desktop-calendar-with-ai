import { MeetingAttachments } from "./meeting-attachments.js";
import { manualMeetingInput } from "../shared/meeting-draft.js";
import { prepareMeetingDraft } from "./meeting-draft.js";
import type { AvailabilityService } from "./availability.js";
import { CalendarError } from "./calendar.js";
import { meetingReference, meetingEdit } from "../shared/meeting-validation.js";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  meetingChannels,
  type MeetingReply,
} from "../shared/meeting-operations.js";
import {
  MeetingOperationError,
  type MeetingOperations,
} from "./meeting-operations.js";
import { SmallAuthError, type SmallAuth } from "./small-auth.js";
export function registerMeetingHandlers(
  service: MeetingOperations,
  auth: SmallAuth,
  trusted: (event: IpcMainInvokeEvent) => boolean,
  availability: AvailabilityService,
) {
  const attachments = new MeetingAttachments(auth);
  ipcMain.handle(meetingChannels.attach, async (event, remaining: number) => {
    const revision = auth.sessionRevision;
    const check = () => {
      if (!trusted(event) || revision !== auth.sessionRevision)
        throw new SmallAuthError(
          "Изменился аккаунт или окно приложения.",
          "auth",
        );
    };
    try {
      check();
      return { ok: true, files: await attachments.choose(check, remaining) };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof SmallAuthError
            ? error.message
            : "Не удалось загрузить файлы. Автоматический повтор не выполнялся.",
      };
    }
  });
  ipcMain.handle(meetingChannels.prepare, async (event, input: unknown) => {
    if (!trusted(event))
      return { ok: false, error: "Доступ к созданию встречи отклонён." };
    const revision = auth.sessionRevision;
    try {
      const state = await auth.read();
      if (state.status !== "signed-in" || revision !== auth.sessionRevision)
        throw new SmallAuthError("Войдите в Small заново.", "auth");
      const parsed = manualMeetingInput.safeParse(input);
      if (
        !parsed.success ||
        !attachments.owns(parsed.data.options.attachmentIds, revision)
      )
        throw new SmallAuthError("Проверьте параметры и прикреплённые файлы.");
      const { options, ...base } = parsed.data;
      const draft = await prepareMeetingDraft(
        state.profile,
        base,
        availability,
        new AbortController().signal,
        true,
      );
      if (revision !== auth.sessionRevision || !trusted(event))
        throw new SmallAuthError(
          "Изменился аккаунт или окно приложения.",
          "auth",
        );
      return {
        ok: true,
        data: service.register({
          ...draft,
          options,
          recurrence: options.recurrence ? "weekly" : "none",
        }),
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof CalendarError ||
          error instanceof SmallAuthError ||
          error instanceof MeetingOperationError
            ? error.message
            : "Не удалось подготовить встречу. Запись не выполнялась.",
      };
    }
  });
  for (const action of ["read", "edit", "confirm", "reconcile"] as const) {
    ipcMain.handle(
      meetingChannels[action],
      async (event, input: unknown): Promise<MeetingReply> => {
        if (!trusted(event))
          return { ok: false, error: "Доступ к операциям встречи отклонён." };
        const parsed = (
          action === "edit" ? meetingEdit : meetingReference
        ).safeParse(input);
        if (!parsed.success)
          return {
            ok: false,
            error: "Некорректная версия или параметры черновика.",
          };
        const revision = auth.sessionRevision;
        const assertCurrent = () => {
          if (auth.sessionRevision !== revision || !trusted(event))
            throw new SmallAuthError(
              "Изменился аккаунт или окно приложения.",
              "auth",
            );
        };
        try {
          const state = await auth.read();
          assertCurrent();
          if (state.status !== "signed-in")
            throw new SmallAuthError("Войдите в Small.", "auth");
          const q = parsed.data;
          const data =
            action === "edit"
              ? await service.edit(state.profile.id, q)
              : action === "confirm"
                ? await service.confirm(
                    state.profile.id,
                    q.id,
                    q.revision,
                    assertCurrent,
                  )
                : await service[action](state.profile.id, q.id, q.revision);
          assertCurrent();
          return { ok: true, data };
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof MeetingOperationError ||
              error instanceof SmallAuthError
                ? error.message
                : "Не удалось проверить операцию. Не повторяйте создание до сверки журнала.",
          };
        }
      },
    );
  }
  return (ids: string[]) => attachments.owns(ids, auth.sessionRevision);
}
