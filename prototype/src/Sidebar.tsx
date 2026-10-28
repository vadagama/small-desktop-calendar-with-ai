import { ChevronLeft, ChevronRight, Check, FlaskConical } from "lucide-react";
import { dateLabel, monthDays, shiftMonth, TODAY } from "./calendar";
import { CALENDARS } from "./data";
import type { CalendarId } from "./types";
interface Props {
  date: string;
  setDate: (date: string) => void;
  miniMonth: string;
  setMiniMonth: (date: string) => void;
  enabled: CalendarId[];
  toggle: (id: CalendarId) => void;
  create: () => void;
  section: string;
  setSection: (section: string) => void;
  showRooms: () => void;
  showAll: () => void;
}
export function Sidebar(p: Props) {
  return (
    <aside className="sidebar" aria-label="Навигация">
      <div className="sidebar-tabs">
        <button
          className={
            p.enabled.length !== 1 || p.enabled[0] !== "room" ? "selected" : ""
          }
          onClick={p.showAll}
        >
          Календарь
        </button>
        <button
          className={
            p.enabled.length === 1 && p.enabled[0] === "room" ? "selected" : ""
          }
          onClick={p.showRooms}
        >
          Переговорные
        </button>
      </div>
      <section className="mini-calendar" aria-label="Выбор даты">
        <div className="mini-heading">
          <strong>
            {dateLabel(p.miniMonth, { month: "long", year: "numeric" }).replace(
              " г.",
              "",
            )}
          </strong>
          <div className="inline">
            <button
              className="icon-button"
              aria-label="Предыдущий месяц"
              onClick={() => p.setMiniMonth(shiftMonth(p.miniMonth, -1))}
            >
              <ChevronLeft size={15} />
            </button>
            <button
              className="icon-button"
              aria-label="Следующий месяц"
              onClick={() => p.setMiniMonth(shiftMonth(p.miniMonth, 1))}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
        <div className="mini-grid">
          {["П", "В", "С", "Ч", "П", "С", "В"].map((d, i) => (
            <span className="weekday" key={i}>
              {d}
            </span>
          ))}
          {monthDays(p.miniMonth).map((day) => (
            <button
              key={day}
              aria-label={dateLabel(day, {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              aria-pressed={day === p.date}
              className={`${day === p.date ? "selected" : ""} ${day === TODAY ? "today" : ""} ${day.slice(0, 7) !== p.miniMonth.slice(0, 7) ? "muted-day" : ""}`}
              onClick={() => {
                p.setDate(day);
                p.setSection("calendar");
              }}
            >
              {Number(day.slice(-2))}
            </button>
          ))}
        </div>
      </section>
      <section className="calendar-filters">
        <h2>Мои календари</h2>
        {CALENDARS.map((c) => (
          <label key={c.id}>
            <input
              type="checkbox"
              checked={p.enabled.includes(c.id)}
              onChange={() => p.toggle(c.id)}
            />
            <span
              className={`custom-check calendar-${c.id} ${p.enabled.includes(c.id) ? "checked" : ""}`}
            >
              <Check size={11} />
            </span>
            {c.title}
          </label>
        ))}
      </section>
      <div className="sidebar-bottom">
        <div className="demo-note">
          <FlaskConical size={16} />
          <div>
            <strong>Пространство для проверки</strong>
            <span>Все встречи и люди — демо</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
