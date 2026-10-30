import type { Dispatch, SetStateAction } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, dateLabel, shiftMonth } from "./calendar";
import { CALENDARS } from "./data";
import type { periodFor, AnalyticsQuery, Period } from "./analytics-model";
import type { CalendarId } from "./types";
export function AnalyticsFilters({
  date,
  range,
  period,
  setPeriod,
  changeDate,
  scope,
  setScope,
  workHours,
  setWorkHours,
  calendars,
  setCalendars,
}: {
  date: string;
  range: ReturnType<typeof periodFor>;
  period: Period;
  setPeriod: (period: Period) => void;
  changeDate: (date: string) => void;
  scope: AnalyticsQuery["scope"];
  setScope: (scope: AnalyticsQuery["scope"]) => void;
  workHours: string;
  setWorkHours: (hours: string) => void;
  calendars: CalendarId[];
  setCalendars: Dispatch<SetStateAction<CalendarId[]>>;
}) {
  return (
    <>
      <div className="insights-filters">
        <div className="insights-period">
          <button
            className="icon-button"
            aria-label="Предыдущий период аналитики"
            onClick={() =>
              changeDate(
                period === "week" ? addDays(date, -7) : shiftMonth(date, -1),
              )
            }
          >
            <ChevronLeft size={15} />
          </button>
          <strong>
            {dateLabel(range.from, { day: "numeric", month: "short" })} —{" "}
            {dateLabel(range.to, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </strong>
          <button
            className="icon-button"
            aria-label="Следующий период аналитики"
            onClick={() =>
              changeDate(
                period === "week" ? addDays(date, 7) : shiftMonth(date, 1),
              )
            }
          >
            <ChevronRight size={15} />
          </button>
        </div>
        <label>
          Период
          <select
            aria-label="Период аналитики"
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
          >
            <option value="week">Неделя</option>
            <option value="month">Месяц</option>
          </select>
        </label>
        <label>
          Источник
          <select
            aria-label="Источник аналитики"
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
          >
            <option value="mine">Моя нагрузка</option>
            <option value="calendars">Доступные календари</option>
          </select>
        </label>
        <label>
          Рабочие часы
          <select
            aria-label="Рабочие часы"
            value={workHours}
            onChange={(e) => setWorkHours(e.target.value)}
          >
            <option value="9-18">09:00–18:00 · пн–пт</option>
            <option value="10-19">10:00–19:00 · пн–пт</option>
            <option value="9-17">09:00–17:00 · пн–пт</option>
          </select>
        </label>
      </div>
      <div className="insights-calendars">
        {CALENDARS.map((c) => (
          <label key={c.id}>
            <input
              type="checkbox"
              checked={calendars.includes(c.id)}
              onChange={() =>
                setCalendars((old) =>
                  old.includes(c.id)
                    ? old.filter((id) => id !== c.id)
                    : [...old, c.id],
                )
              }
            />
            {c.title}
          </label>
        ))}
      </div>
    </>
  );
}
