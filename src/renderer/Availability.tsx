import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { calendarToday } from "../shared/calendar-time.js";
import { AvailabilityPeople } from "./AvailabilityPeople";
import { useAvailability } from "./useAvailability";

const time = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
export function Availability({
  accountId,
  initialDate,
  close,
  expired,
}: {
  accountId: string;
  initialDate: string;
  close: () => void;
  expired: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [date, setDate] = useState(
    initialDate < calendarToday() ? calendarToday() : initialDate,
  );
  const [duration, setDuration] = useState(30);
  const data = useAvailability(accountId, expired);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    if (!dialog.current?.open) dialog.current?.showModal();
    return () => before?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal availability"
      aria-label="Общее время"
      onCancel={close}
    >
      <div className="modal-header">
        <h2>Общее время</h2>
        <button
          className="icon-button"
          aria-label="Закрыть подбор времени"
          onClick={close}
        >
          <X size={19} />
        </button>
      </div>
      <p className="modal-description">
        Выберите всех участников, включая себя. Время — Алматы (UTC+5). Поиск
        полного состава команды пока недоступен.
      </p>
      <form
        className="meeting-form"
        onSubmit={(e) => {
          e.preventDefault();
          void data.search(query);
        }}
      >
        <label>
          Имя сотрудника
          <input
            value={query}
            maxLength={200}
            required
            onChange={(e) => {
              setQuery(e.target.value);
              data.resetSearch();
            }}
          />
        </label>
        <button
          className="secondary"
          disabled={data.searching || !query.trim()}
        >
          Найти сотрудников
        </button>
      </form>
      {data.searching && <p role="status">Поиск сотрудников…</p>}
      {data.searchError && (
        <p role="alert" className="form-error">
          {data.searchError}
        </p>
      )}
      <AvailabilityPeople data={data} query={query} />
      <form
        className="meeting-form"
        onSubmit={(e) => {
          e.preventDefault();
          void data.find(date, duration);
        }}
      >
        <div className="form-two">
          <label>
            Дата встречи
            <input
              type="date"
              required
              value={date}
              min={calendarToday()}
              onChange={(e) => {
                setDate(e.target.value);
                data.invalidate();
              }}
            />
          </label>
          <label>
            Длительность
            <select
              value={duration}
              onChange={(e) => {
                setDuration(Number(e.target.value));
                data.invalidate();
              }}
            >
              {[15, 30, 45, 60, 90, 120].map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} мин
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="form-note">
          Подбор на выбранный день, без выходных. Участники не исключаются
          автоматически.
        </p>
        <button
          className="primary"
          disabled={data.loading || !data.selected.length || !date}
        >
          Найти общее время
        </button>
      </form>
      {data.loading && (
        <p role="status">Проверяю слоты и занятость всех участников…</p>
      )}
      {data.error && (
        <p className="form-error" role="alert">
          {data.error}
        </p>
      )}
      {data.slots && (
        <section
          className="availability-section"
          aria-label="Результаты подбора"
          aria-live="polite"
        >
          <h3>
            Варианты на{" "}
            {new Intl.DateTimeFormat("ru-RU", {
              timeZone: "Asia/Almaty",
              day: "numeric",
              month: "long",
              year: "numeric",
            }).format(new Date(`${data.slots.date}T12:00:00+05:00`))}
          </h3>
          {data.slots.slots.length ? (
            <>
              <p className="form-note">
                Проверена занятость {data.slots.participantIds.length}{" "}
                участников · {data.slots.durationMinutes} мин · Алматы
              </p>
              <ul className="available-slots">
                {data.slots.slots.map((slot) => (
                  <li key={slot.start}>
                    {time(slot.start)} – {time(slot.end)}
                  </li>
                ))}
              </ul>
              <p className="form-note">
                Встреча ещё не создана. Перед созданием занятость нужно
                проверить повторно.
              </p>
            </>
          ) : (
            <p role="status">
              Small не предложил подходящих слотов на этот день. Попробуйте
              другую дату или длительность.
            </p>
          )}
        </section>
      )}
    </dialog>
  );
}
