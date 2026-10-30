import { ArrowRight, Sparkles } from "lucide-react";
import { CALENDARS } from "./data";
import { analyze, hours } from "./analytics-model";
import { chartColors } from "./AnalyticsCharts";
import type { Report } from "./AnalyticsCharts";
import type { AnalyticsQuery, Dashboard } from "./analytics-model";
import type { Meeting } from "./types";
type PickEvents = (title: string, events: Meeting[]) => void;
export function AnalyticsMetrics({
  report,
  previous,
  comparisonReady,
  scope,
  workHours,
  pick,
  changeKind,
}: {
  report: Report;
  previous: Report;
  comparisonReady: boolean;
  scope: AnalyticsQuery["scope"];
  workHours: string;
  pick: PickEvents;
  changeKind: (kind: Dashboard) => void;
}) {
  return (
    <div className="insights-metrics">
      <button onClick={() => pick("Все встречи периода", report.events)}>
        <span>Встречи</span>
        <strong>{report.count}</strong>
        <small>
          {comparisonReady
            ? `${report.count - previous.count >= 0 ? "+" : ""}${report.count - previous.count} к пред. периоду`
            : "Сравнение недоступно"}
        </small>
      </button>
      <button onClick={() => pick("Занятое время", report.events)}>
        <span>Занято без наложений</span>
        <strong>{hours(report.busy)}</strong>
        <small>Сумма: {hours(report.minutes)}</small>
      </button>
      <button
        onClick={() =>
          pick(
            "Регулярные встречи",
            report.events.filter((e) => e.recurring),
          )
        }
      >
        <span>Регулярные</span>
        <strong>
          {Math.round((report.regularMinutes / report.minutes) * 100)}%
        </strong>
        <small>{hours(report.regularMinutes)} от суммы</small>
      </button>
      <button onClick={() => changeKind("rhythm")}>
        <span>
          {scope === "mine"
            ? "Загрузка рабочих часов"
            : "Покрытие рабочих часов"}
        </span>
        <strong>
          {report.capacity
            ? Math.round((report.workBusy / report.capacity) * 100)
            : 0}
          %
        </strong>
        <small>пн–пт · {workHours.replace("-", "–")}</small>
      </button>
    </div>
  );
}
export function OrganizerTable({
  report,
  pick,
}: {
  report: Report;
  pick: PickEvents;
}) {
  return (
    <div className="organizer-table">
      <div className="organizer-table-head">
        <span>Организатор</span>
        <span>Встречи</span>
        <span>Часы</span>
      </div>
      {report.organizers.map((o, i) => (
        <button
          key={o.name}
          onClick={() => pick(`Организатор: ${o.name}`, o.events)}
        >
          <span>
            <i
              style={{
                background: chartColors[i % chartColors.length],
              }}
            />
            {o.name}
          </span>
          <span>{o.count}</span>
          <strong>{hours(o.minutes)}</strong>
        </button>
      ))}
    </div>
  );
}
export function CalendarBreakdown({
  report,
  input,
  query,
  pick,
}: {
  report: Report;
  input: Meeting[];
  query: AnalyticsQuery;
  pick: PickEvents;
}) {
  const { calendars } = query;
  return (
    <div className="calendar-breakdown">
      <h3>События по календарям</h3>
      {CALENDARS.filter((c) => calendars.includes(c.id)).map((c) => {
        const rows = report.events.filter((e) => e.calendar === c.id);
        const result = analyze(input, {
          ...query,
          calendars: [c.id],
        });
        return (
          <button key={c.id} onClick={() => pick(c.title, rows)}>
            <span>
              {c.title}
              <small>
                {rows.length} встреч · {hours(result.minutes)}
              </small>
            </span>
            <span className={`calendar-bar calendar-${c.id}`}>
              <i
                style={{
                  width: `${report.minutes ? (result.minutes / report.minutes) * 100 : 0}%`,
                  background: "var(--calendar-accent)",
                }}
              />
            </span>
            <ArrowRight size={14} />
          </button>
        );
      })}
      <p className="chart-help">
        Это обзор доступных событий. Он не показывает полную нагрузку других
        сотрудников.
      </p>
    </div>
  );
}
export function SmartReport({
  report,
  generated,
  generate,
  pick,
}: {
  report: Report;
  generated: string;
  generate: () => void;
  pick: PickEvents;
}) {
  const leader = report.organizers[0];
  return (
    <div className="smart-report">
      <div className="insights-section-heading">
        <h3>
          <Sparkles size={16} />
          Объяснение периода
        </h3>
        <span className="demo-pill">Без LLM</span>
      </div>
      <p>
        Демонстрация отчёта по рассчитанным показателям. Модель и внешний
        AI-сервис не подключены.
      </p>
      <button className="primary" onClick={() => generate()}>
        {generated ? "Пересобрать обзор" : "Сформировать демо-обзор"}
      </button>
      {generated && (
        <div className="report-result" role="status">
          <p>{generated}</p>
          {leader && (
            <>
              <h3>Основное взаимодействие</h3>
              <p>
                Встречи организатора {leader.name}: {leader.count},{" "}
                {hours(leader.minutes)}. Из календаря нельзя установить причины
                изменения нагрузки.
              </p>
              <button
                className="text-button"
                onClick={() => pick(`Основание: ${leader.name}`, leader.events)}
              >
                Показать встречи-основания <ArrowRight size={14} />
              </button>
            </>
          )}
          <h3>Что проверить</h3>
          <p>
            Посмотрите регулярные серии и длинные окна перед планированием новых
            встреч. Автоматические изменения расписания не выполняются.
          </p>
        </div>
      )}
    </div>
  );
}
