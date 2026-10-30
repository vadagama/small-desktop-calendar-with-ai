import { Check, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { dateLabel, monthDays, shiftMonth } from "../../prototype/src/calendar";
import { calendarToday } from "../shared/calendar-time.js";
import type { useSmallCalendar } from "./useSmallCalendar";

export const participationFilters = [
  { id: "organizer", label: "Мои встречи" },
  { id: "invited", label: "Я участник" },
  { id: "informed", label: "Я информирован" },
] as const;
export type ParticipationFilter = (typeof participationFilters)[number]["id"];

export function CalendarFilters({
  calendar,
  enabled,
  date,
  setDate,
  participation,
  toggleParticipation,
}: {
  calendar: ReturnType<typeof useSmallCalendar>;
  enabled: boolean;
  date: string;
  setDate: (date: string) => void;
  participation: Record<ParticipationFilter, boolean>;
  toggleParticipation: (type: ParticipationFilter) => void;
}) {
  const [month, setMonth] = useState(date);
  const [refreshFeedback, setRefreshFeedback] = useState(false);
  useEffect(() => {
    if (!refreshFeedback) return;
    const timer = window.setTimeout(() => setRefreshFeedback(false), 700);
    return () => window.clearTimeout(timer);
  }, [refreshFeedback]);
  const refreshing = refreshFeedback || calendar.refreshing;
  useEffect(() => setMonth(date), [date]);
  const today = calendarToday();
  return (
    <aside
      id="small-calendar-filters"
      className="sidebar"
      aria-label="Календари Small"
    >
      <div className="sidebar-tabs">
        <button
          className={calendar.my ? "selected" : ""}
          aria-pressed={calendar.my}
          onClick={() => calendar.setMy(true)}
        >
          Календарь
        </button>
        <button
          className={!calendar.my ? "selected" : ""}
          aria-pressed={!calendar.my}
          onClick={() => calendar.setMy(false)}
          title="Фильтр переговорных"
        >
          Переговорные
        </button>
      </div>
      <div className="small-sidebar-scroll">
        <section className="mini-calendar" aria-label="Выбор даты">
          <div className="mini-heading">
            <strong>
              {dateLabel(month, { month: "long", year: "numeric" }).replace(
                " г.",
                "",
              )}
            </strong>
            <div className="inline">
              <button
                className="icon-button"
                aria-label="Предыдущий месяц"
                onClick={() => setMonth(shiftMonth(month, -1))}
              >
                <ChevronLeft size={15} />
              </button>
              <button
                className="icon-button"
                aria-label="Следующий месяц"
                onClick={() => setMonth(shiftMonth(month, 1))}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
          <div className="mini-grid">
            {["П", "В", "С", "Ч", "П", "С", "В"].map((day, index) => (
              <span className="weekday" key={index}>
                {day}
              </span>
            ))}
            {monthDays(month).map((day) => (
              <button
                key={day}
                aria-label={dateLabel(day, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
                aria-pressed={day === date}
                aria-current={day === today ? "date" : undefined}
                className={`${day === date ? "selected" : ""} ${day === today ? "today" : ""} ${day.slice(0, 7) !== month.slice(0, 7) ? "muted-day" : ""}`}
                onClick={() => setDate(day)}
              >
                {Number(day.slice(-2))}
              </button>
            ))}
          </div>
        </section>
        <section className="calendar-filters" aria-label="Выбор календарей">
          <h2>{calendar.my ? "Мои календари" : "Переговорные"}</h2>
          {calendar.my &&
            participationFilters.map((filter) => (
              <label key={filter.id}>
                <input
                  type="checkbox"
                  checked={participation[filter.id]}
                  onChange={() => toggleParticipation(filter.id)}
                />
                <span
                  className={`custom-check participation-${filter.id} ${participation[filter.id] ? "checked" : ""}`}
                  aria-hidden="true"
                >
                  <Check size={11} />
                </span>
                {filter.label}
              </label>
            ))}
          {!calendar.my &&
            calendar.calendars.map((entry) => {
              const checked = !calendar.my && calendar.ids.includes(entry.id);
              return (
                <label key={entry.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={
                      !calendar.ids.includes(entry.id) &&
                      calendar.ids.length >= 8
                    }
                    onChange={() => {
                      if (calendar.my && calendar.ids.includes(entry.id))
                        calendar.setMy(false);
                      else calendar.toggle(entry.id);
                    }}
                  />
                  <span
                    className={`custom-check calendar-team ${checked ? "checked" : ""}`}
                    aria-hidden="true"
                  >
                    <Check size={11} />
                  </span>
                  {entry.name}
                </label>
              );
            })}
          {!calendar.my && (
            <p className="form-note">Выберите до 8 переговорных.</p>
          )}
          {!calendar.my && calendar.catalogError && (
            <p className="form-error" role="alert">
              {calendar.catalogError}
            </p>
          )}
        </section>
      </div>
      <div className="small-sidebar-footer">
        <button
          className="settings-link"
          disabled={!enabled || refreshing}
          aria-busy={refreshing}
          onClick={() => {
            setRefreshFeedback(true);
            calendar.refresh();
          }}
        >
          <RefreshCw
            size={14}
            className={refreshing ? "spinning" : undefined}
          />
          {refreshing ? "Обновление…" : "Обновить"}
        </button>
      </div>
    </aside>
  );
}
