import { NotificationCheck } from "./NotificationCheck";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { ReminderReply, ReminderState } from "../shared/reminders.js";
import { SmallAuthNotice } from "./SmallAuthNotice";
export function Reminders({
  close,
  authRequired = false,
}: {
  close: () => void;
  authRequired?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<ReminderState | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [minutes, setMinutes] = useState("5");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mounted = useRef(true);
  const accept = (reply: ReminderReply) => {
    if (!mounted.current) return;
    if (reply.ok) {
      setState(reply.state);
      return reply.state;
    }
    setError(reply.error);
  };
  useEffect(() => {
    mounted.current = true;
    dialog.current?.showModal();
    void window.smallDesktop.reminders
      .read()
      .then((reply) => {
        const next = accept(reply);
        if (next) {
          setEnabled(next.settings.enabled);
          setMinutes(String(next.settings.minutes));
        }
      })
      .catch(() => {
        if (mounted.current)
          setError("Не удалось загрузить настройки напоминаний.");
      });
    return () => {
      mounted.current = false;
    };
  }, []);
  const action = async (
    operation: () => Promise<ReminderReply>,
    saved = false,
  ) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = accept(await operation());
      if (next && saved && mounted.current) setNotice("Настройки сохранены.");
    } catch {
      if (mounted.current) setError("Не удалось выполнить действие.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="modal reminders-dialog"
      aria-labelledby="reminders-title"
      onCancel={close}
      onClose={close}
    >
      {authRequired && <SmallAuthNotice />}
      <div className="modal-header">
        <h2 id="reminders-title">Напоминания</h2>
        <button
          className="icon-button"
          aria-label="Закрыть напоминания"
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      <NotificationCheck />
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!state ? (
        <p role="status">Загружаю настройки напоминаний…</p>
      ) : (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action(
                () =>
                  window.smallDesktop.reminders.save({
                    enabled,
                    minutes: Number(minutes),
                  }),
                true,
              );
            }}
          >
            <label className="reminder-toggle">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                disabled={busy}
              />
              Напоминать о встречах моего календаря
            </label>
            <label className="reminder-minutes">
              За сколько минут до начала
              <input
                type="number"
                min="0"
                max="60"
                required
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
                disabled={busy}
              />
            </label>
            <button className="primary" disabled={busy}>
              Сохранить напоминания
            </button>
          </form>
          <p className="reminder-help">
            После пробуждения напомним об ещё идущих встречах. Закрытие окна не
            отключает напоминания; полный выход из приложения останавливает их.
          </p>
        </>
      )}
    </dialog>
  );
}
