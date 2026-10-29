export const events = new EventTarget();
let nextId = 0;
export type Notice = {
  id: number;
  type: "success" | "error" | "info";
  message: string;
};
export function notifySuccess(message: string) {
  events.dispatchEvent(
    new CustomEvent("notice", {
      detail: { id: ++nextId, type: "success", message },
    }),
  );
}
export function notifyInfo(message: string) {
  events.dispatchEvent(
    new CustomEvent("notice", {
      detail: { id: ++nextId, type: "info", message },
    }),
  );
}
export function notifyError(action: string, kind?: string) {
  const message =
    kind === "auth"
      ? "Сессия Small истекла. Войдите снова и повторите действие."
      : kind === "denied"
        ? `Не удалось ${action}: недостаточно прав на эту встречу.`
        : kind === "invalid"
          ? `Не удалось ${action}. Данные встречи изменились или действие недоступно. Обновите календарь и проверьте событие.`
          : `Не удалось подтвердить действие «${action}». Проверьте соединение и обновите календарь перед повтором.`;
  events.dispatchEvent(
    new CustomEvent("notice", {
      detail: { id: ++nextId, type: "error", message },
    }),
  );
}
