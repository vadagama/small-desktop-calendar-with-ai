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
) {
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
}
