import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { ReminderReply, ReminderState } from "../shared/reminders.js";
import { calendarTimeZone } from "../shared/calendar-time.js";
export function Reminders({ close }: { close: () => void }) {
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
        if (mounted.current) setError("Не удалось загрузить напоминания.");
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
  const format = (date: string) =>
    new Intl.DateTimeFormat("ru", {
      timeZone: calendarTimeZone,
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(date));
  return (
    <dialog
      ref={dialog}
      className="modal reminders-dialog"
      aria-labelledby="reminders-title"
      onCancel={close}
      onClose={close}
    >
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
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!state ? (
        <p role="status">Загружаю напоминания…</p>
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
          <p className="reminder-help">
            Системные уведомления требуют подписанной сборки и разрешения в
            настройках macOS → Уведомления → Small Calendar. Режим фокусирования
            может скрывать баннеры.
          </p>
          {state.warning && <p role="status">{state.warning}</p>}
          <div className="reminder-heading">
            <h3>Текущие напоминания</h3>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void action(() => window.smallDesktop.reminders.read())
              }
            >
              Обновить напоминания
            </button>
          </div>
          {!state.items.length && <p>Сейчас напоминаний нет.</p>}
          {state.items.map((item) => (
            <article className="reminder-item" key={item.id}>
              <h3>{item.event.title}</h3>
              <p>
                {format(item.event.startsAt)} — {format(item.event.endsAt)} ·{" "}
                {calendarTimeZone}
              </p>
              <p>Организатор: {item.event.organizer || "не указан"}</p>
              {item.canJoin ? (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void action(() =>
                      window.smallDesktop.reminders.join(item.id),
                    )
                  }
                >
                  Подключиться
                </button>
              ) : (
                <p>Ссылка на встречу отсутствует</p>
              )}
            </article>
          ))}
        </>
      )}
    </dialog>
  );
}
