import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { CalendarEvent, EventLookup } from "../shared/calendar.js";
import { calendarTimeZone } from "../shared/calendar-time.js";

export function EventDetails({
  accountId,
  lookup,
  close,
  expired,
}: {
  accountId: string;
  lookup: EventLookup;
  close: () => void;
  expired: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let active = true;
    setEvent(null);
    setError("");
    void window.smallDesktop.calendar
      .detail({ accountId, lookup })
      .then((reply) => {
        if (!active) return;
        if (reply.ok) setEvent(reply.data);
        else {
          setError(reply.error);
          if (reply.kind === "auth") expired();
        }
      })
      .catch(() => {
        if (active) setError("Не удалось прочитать карточку Small.");
      });
    return () => {
      active = false;
    };
  }, [accountId, lookup, retry, expired]);
  const format = (date: string) =>
    new Intl.DateTimeFormat("ru", {
      timeZone: calendarTimeZone,
      dateStyle: "long",
      timeStyle: "medium",
    }).format(new Date(date));
  return (
    <dialog
      ref={dialog}
      className="modal small-event-details"
      aria-labelledby="event-details-title"
      onCancel={close}
      onClose={close}
    >
      <div className="modal-header">
        <h2 id="event-details-title">{event?.title ?? "Событие Small"}</h2>
        <button
          className="icon-button"
          aria-label="Закрыть событие"
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      {!event && !error && <p role="status">Загружаю карточку Small…</p>}
      {error && (
        <>
          <p className="form-error" role="alert">
            {error}
          </p>
          <button
            className="secondary"
            onClick={() => setRetry((value) => value + 1)}
          >
            Повторить чтение
          </button>
        </>
      )}
      {event && (
        <dl className="event-details-fields">
          <dt>Начало</dt>
          <dd>{format(event.startsAt)}</dd>
          <dt>Окончание</dt>
          <dd>{format(event.endsAt)}</dd>
          <dt>Часовой пояс</dt>
          <dd>{calendarTimeZone}</dd>
          <dt>Организатор</dt>
          <dd>{event.organizer || "Не указан в ответе Small"}</dd>
          <dt>Место</dt>
          <dd>{event.location || "Не указано в ответе Small"}</dd>
          <dt>Описание</dt>
          <dd>{event.description || "Нет описания"}</dd>
        </dl>
      )}
      <p className="form-note">
        Просмотр данных Small. Изменение встречи пока недоступно.
      </p>
    </dialog>
  );
}
