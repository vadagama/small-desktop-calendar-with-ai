import { calendarToday } from "../shared/calendar-time.js";
import { MeetingTimePicker } from "./MeetingTimePicker";
import { endAfterDuration } from "../shared/meeting-time.js";
import { Clock } from "lucide-react";
import type { useNewMeeting } from "./useNewMeeting";
import { Checkbox } from "./ui/shadcn/checkbox";
import { MeetingRecurrenceDate } from "./MeetingRecurrenceDate";
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
  disabled,
  overlayRoot,
}: {
  data: ReturnType<typeof useNewMeeting>;
  disabled: boolean;
  overlayRoot: HTMLDivElement | null;
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
    recurrenceEndLimit,
    recurrenceEndInvalid,
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
          <MeetingTimePicker label="Начало" value={start} onChange={setStart} />
          <span>–</span>
          <MeetingTimePicker label="Окончание" value={end} onChange={setEnd} />
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
        <div
          className="meeting-duration-helpers"
          role="group"
          aria-label="Длительность встречи"
        >
          {(
            [
              [15, "15 мин"],
              [30, "Полчаса"],
              [60, "Час"],
              [90, "Полтора"],
              [120, "2 часа"],
            ] as const
          ).map(([duration, label]) => (
            <button
              key={duration}
              type="button"
              aria-pressed={data.durationMinutes === duration}
              disabled={!endAfterDuration(start, duration)}
              onClick={() => setEnd(endAfterDuration(start, duration)!)}
            >
              {label}
            </button>
          ))}
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
          <fieldset className="recurrence-weekdays">
            <legend>Еженедельно</legend>
            <div className="recurrence-days">
              {weekdays.map(([id, label]) => (
                <label key={id}>
                  <Checkbox
                    checked={days.includes(id)}
                    disabled={disabled}
                    onCheckedChange={(checked) =>
                      setDays((old) =>
                        checked === true
                          ? [...old, id]
                          : old.filter((d) => d !== id),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <MeetingRecurrenceDate
            value={until}
            min={recurrenceEndLimit ? date : undefined}
            max={recurrenceEndLimit}
            invalid={recurrenceEndInvalid}
            disabled={disabled}
            overlayRoot={overlayRoot}
            onChange={setUntil}
          />
          <small id="meeting-recurrence-note">
            До 32 встреч за 90 дней. Занятость проверяется для каждого
            повторения.
          </small>
        </div>
      )}
    </>
  );
}
