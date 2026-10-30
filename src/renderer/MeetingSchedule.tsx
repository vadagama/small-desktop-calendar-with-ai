import { calendarToday } from "../shared/calendar-time.js";
import { Clock } from "lucide-react";
import { addDateDays, validCalendarDate } from "../shared/calendar-time.js";
import type { useNewMeeting } from "./useNewMeeting";
const weekdays = [
  ["MO", "Пн"],
  ["TU", "Вт"],
  ["WE", "Ср"],
  ["TH", "Чт"],
  ["FR", "Пт"],
  ["SA", "Сб"],
  ["SU", "Вс"],
] as const;
export function MeetingSchedule({
  data,
}: {
  data: ReturnType<typeof useNewMeeting>;
}) {
  const {
    date,
    setDate,
    start,
    setStart,
    end,
    setEnd,
    people,
    repeat,
    setRepeat,
    days,
    setDays,
    until,
    setUntil,
  } = data;
  return (
    <>
      <div>
        <span className="meeting-field-title">
          Дата и время <span className="required-mark">*</span>
        </span>
        <div className="new-meeting-time">
          <input
            min={calendarToday()}
            aria-label="Дата"
            type="date"
            required
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              people.invalidate();
            }}
          />
          <input
            aria-label="Начало"
            type="time"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <span>–</span>
          <input
            aria-label="Окончание"
            type="time"
            required
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
          <button
            type="button"
            className="secondary"
            aria-label="Подобрать время встречи"
            disabled={!people.selected.length || people.loading}
            onClick={() =>
              void people.find(date, Math.max(1, data.durationMinutes), true)
            }
          >
            <Clock size={20} />
          </button>
        </div>
        <small>
          Asia/Almaty{data.endsNextDay ? " · Окончание на следующий день" : ""}
        </small>
      </div>
      {people.error && (
        <p role="alert" className="form-error">
          {people.error}
        </p>
      )}
      {people.slots && (
        <div className="available-slots">
          {people.slots.slots.map((s) => (
            <button
              className="secondary"
              type="button"
              key={s.start}
              onClick={() => {
                const f = (v: string) =>
                  new Intl.DateTimeFormat("ru", {
                    timeZone: "Asia/Almaty",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(v));
                setStart(f(s.start));
                setEnd(f(s.end));
              }}
            >
              {new Intl.DateTimeFormat("ru", {
                timeZone: "Asia/Almaty",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(s.start))}
            </button>
          ))}
          {!people.slots.slots.length && <span>Свободных слотов нет</span>}
        </div>
      )}
      <label className="repeat-toggle">
        Повторяемость
        <input
          disabled={!!data.editing}
          role="switch"
          type="checkbox"
          checked={repeat}
          onChange={(e) => setRepeat(e.target.checked)}
        />
      </label>
      {data.editing && (
        <small>
          Изменение повторяемости существующего события пока недоступно.
        </small>
      )}
      {repeat && (
        <div className="recurrence-controls">
          <p>Еженедельно</p>
          <div className="recurrence-days">
            {weekdays.map(([id, label]) => (
              <label key={id}>
                <input
                  type="checkbox"
                  checked={days.includes(id)}
                  onChange={() =>
                    setDays((old) =>
                      old.includes(id)
                        ? old.filter((d) => d !== id)
                        : [...old, id],
                    )
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <label>
            Повторять до
            <input
              type="date"
              required
              min={date}
              max={validCalendarDate(date) ? addDateDays(date, 90) : undefined}
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </label>
          <small>
            До 32 встреч за 90 дней. Занятость проверяется для каждого
            повторения.
          </small>
        </div>
      )}
    </>
  );
}
