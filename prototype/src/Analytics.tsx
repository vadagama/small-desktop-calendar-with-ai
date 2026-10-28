import { ArrowLeft, ChartNoAxesCombined, Clock3 } from "lucide-react";
import { addDays, dateLabel, time, weekStart } from "./calendar";
import { CALENDARS } from "./data";
import type { Meeting } from "./types";
export function Analytics({
  events,
  date,
  back,
}: {
  events: Meeting[];
  date: string;
  back: () => void;
}) {
  const start = weekStart(date);
  const list = events.filter(
    (e) => e.date >= start && e.date <= addDays(start, 6),
  );
  const minutes = list.reduce((sum, e) => sum + e.duration, 0);
  return (
    <section className="analytics-panel">
      <div className="panel-caption">
        <span>
          <ChartNoAxesCombined size={15} />
          Обзор недели
        </span>
        <button className="text-button" onClick={back}>
          <ArrowLeft size={14} />К календарю
        </button>
      </div>
      <div className="analytics-content">
        <h2>На что запланировано время</h2>
        <p>
          {dateLabel(start)} — {dateLabel(addDays(start, 6))} · Asia/Almaty
        </p>
        <div className="analytics-total">
          <Clock3 size={24} />
          <strong>
            {Math.floor(minutes / 60)} ч {minutes % 60} мин
          </strong>
          <span>{list.length} событий в демо-календаре</span>
        </div>
        <h3>По календарям</h3>
        {CALENDARS.map((c) => {
          const sum = list
            .filter((e) => e.calendar === c.id)
            .reduce((s, e) => s + e.duration, 0);
          return (
            <div className="analytics-row" key={c.id}>
              <span>{c.title}</span>
              <strong>
                {Math.floor(sum / 60)} ч {sum % 60} мин
              </strong>
              <div className="analytics-track">
                <div
                  className={c.color}
                  style={{ width: `${minutes ? (sum / minutes) * 100 : 0}%` }}
                />
              </div>
            </div>
          );
        })}
        <p className="analytics-disclaimer">
          Сумма длительностей синтетических событий, включая фокус-время.
          Пересечения суммируются. Фактическое присутствие не учитывается.
        </p>
        <h3>События в расчёте</h3>
        {list.map((e) => (
          <div className="analytics-event" key={e.id}>
            <span>
              {dateLabel(e.date)} · {time(e.start)}
            </span>
            <strong>{e.title}</strong>
            <span>{e.duration} мин</span>
          </div>
        ))}
      </div>
    </section>
  );
}
