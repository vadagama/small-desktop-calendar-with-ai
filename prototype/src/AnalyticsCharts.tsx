import { dateLabel, time } from "./calendar";
import { hours } from "./analytics-model";
import type { analyze } from "./analytics-model";
import type { Meeting } from "./types";

export type Report = ReturnType<typeof analyze>;
export const chartColors = [
  "#147cb3",
  "#b55332",
  "#68784d",
  "#75648d",
  "#65717c",
];
export function DailyChart({
  report,
  previous,
  metric,
  stacked = false,
  compare = true,
  pick,
}: {
  report: Report;
  previous: Report;
  metric: "minutes" | "count";
  stacked?: boolean;
  compare?: boolean;
  pick: (title: string, events: Meeting[]) => void;
}) {
  const maximum = Math.max(
    1,
    ...report.days.map((d) => d[metric]),
    ...previous.days.map((d) => d[metric]),
  );
  const organizers = report.organizers.map((o) => o.name);
  return (
    <>
      <div className="chart-scale">
        <span>
          {metric === "minutes" ? hours(maximum) : `${maximum} встреч`}
        </span>
        <span>0</span>
      </div>
      <div
        className="daily-chart"
        aria-label={stacked ? "Динамика по организаторам" : "Динамика встреч"}
      >
        {report.days.map((day, index) => (
          <button
            key={day.date}
            className="chart-day"
            onClick={() => pick(dateLabel(day.date), day.events)}
            aria-label={`${dateLabel(day.date)}: ${day.count} встреч, ${hours(day.minutes)}`}
          >
            <span className="chart-value">
              {metric === "minutes" ? hours(day.minutes) : day.count}
            </span>
            <span className="chart-columns">
              {!stacked && compare && (
                <span
                  className="previous-bar"
                  style={{
                    height: `${((previous.days[index]?.[metric] ?? 0) / maximum) * 100}%`,
                  }}
                />
              )}
              <span
                className="current-bar"
                style={{ height: `${(day[metric] / maximum) * 100}%` }}
              >
                {stacked &&
                  organizers.map((name, i) => {
                    const rows = day.segments.filter(
                      (s) => (s.event.organizer || "Не указан") === name,
                    );
                    const amount =
                      metric === "count"
                        ? rows.length
                        : rows.reduce((sum, s) => sum + s.end - s.start, 0);
                    return amount > 0 ? (
                      <span
                        key={name}
                        style={{
                          flex: amount,
                          background: chartColors[i % chartColors.length],
                        }}
                        title={`${name}: ${metric === "count" ? amount : hours(amount)}`}
                      />
                    ) : null;
                  })}
              </span>
            </span>
            <span className="chart-date">
              {dateLabel(day.date, { weekday: "short" })}
              <br />
              {Number(day.date.slice(-2))}
            </span>
          </button>
        ))}
      </div>
      <div className="chart-legend">
        {stacked ? (
          organizers.map((name, i) => (
            <span key={name}>
              <i style={{ background: chartColors[i % chartColors.length] }} />
              {name}
            </span>
          ))
        ) : (
          <>
            <span>
              <i style={{ background: chartColors[0] }} />
              Выбранный период
            </span>
            <span>
              <i className="previous-key" />
              {compare ? "Предыдущий период" : "Нет данных для сравнения"}
            </span>
          </>
        )}
      </div>
    </>
  );
}
export function Rhythm({
  report,
  pick,
}: {
  report: Report;
  pick: (title: string, events: Meeting[]) => void;
}) {
  return (
    <>
      <p className="chart-help">
        Насыщенность — минуты встреч в каждом часу. Нажмите на ячейку, чтобы
        увидеть события.
      </p>
      <div className="heatmap" aria-label="Тепловая карта встреч">
        <div className="heatmap-row">
          <span />
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i}>{i + 9}</span>
          ))}
        </div>
        {report.days.map((day) => (
          <div className="heatmap-row" key={day.date}>
            <span>
              {dateLabel(day.date, { weekday: "short", day: "numeric" })}
            </span>
            {Array.from({ length: 10 }, (_, i) => {
              const start = (i + 9) * 60;
              const parts = day.segments.filter(
                (s) => s.start < start + 60 && s.end > start,
              );
              const events = parts.map((s) => s.event);
              const minutes = Math.min(
                60,
                parts.reduce(
                  (sum, s) =>
                    sum +
                    Math.max(
                      0,
                      Math.min(s.end, start + 60) - Math.max(s.start, start),
                    ),
                  0,
                ),
              );
              return (
                <button
                  key={i}
                  style={{
                    background: minutes
                      ? `rgba(20,124,179,${0.2 + (minutes / 60) * 0.8})`
                      : "#f2f3f4",
                  }}
                  aria-label={`${dateLabel(day.date)}, ${time(start)}: ${minutes} минут`}
                  title={`${minutes} мин`}
                  onClick={() =>
                    pick(`${dateLabel(day.date)}, ${time(start)}`, events)
                  }
                />
              );
            })}
          </div>
        ))}
      </div>
      <h3>Свободные окна от 60 минут</h3>
      <p className="chart-help">
        В пределах рабочих часов. Учитываются зарезервированный фокус и
        неподтверждённые события с вашим участием. Это не измеренное
        фокус-время.
      </p>
      <div className="focus-windows">
        {report.windows.slice(0, 8).map((w) => (
          <div key={`${w.date}:${w.start}`}>
            <span>
              {dateLabel(w.date, { weekday: "short", day: "numeric" })}
            </span>
            <strong>
              {time(w.start)}–{time(w.start + w.duration)}
            </strong>
            <span>{hours(w.duration)}</span>
          </div>
        ))}
      </div>
      {!report.windows.length && (
        <p className="chart-help">Длинных окон в рабочих часах нет.</p>
      )}
    </>
  );
}
