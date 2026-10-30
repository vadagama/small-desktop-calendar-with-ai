import { useEffect, useRef, useState } from "react";
import { GripVertical, RefreshCw, Sparkles, ArrowRight } from "lucide-react";
import { dateLabel, time } from "./calendar";
import { analyze, dashboards, hours, periodFor } from "./analytics-model";
import { DailyChart, Rhythm } from "./AnalyticsCharts";
import { AnalyticsFilters } from "./AnalyticsFilters";
import {
  AnalyticsMetrics,
  OrganizerTable,
  CalendarBreakdown,
  SmartReport,
} from "./AnalyticsSections";
import type { Dashboard, Period } from "./analytics-model";
import type { CalendarId, Meeting } from "./types";
import type { useAnalyticsSnapshot } from "./useAnalyticsSnapshot";

interface Props {
  kind: Dashboard;
  changeKind: (kind: Dashboard) => void;
  date: string;
  linked: boolean;
  sharedPeriod: Period;
  setSharedPeriod: (period: Period) => void;
  setDate: (date: string) => void;
  data: ReturnType<typeof useAnalyticsSnapshot>;
  select: (event: Meeting) => void;
  openCalendar: (event: Meeting) => void;
  explain: (title: string, text: string) => void;
  empty?: boolean;
}
export function Analytics(p: Props) {
  const [ownDate, setOwnDate] = useState(p.date);
  const [ownPeriod, setOwnPeriod] = useState<Period>("week");
  const period = p.linked ? p.sharedPeriod : ownPeriod;
  const setPeriod = p.linked ? p.setSharedPeriod : setOwnPeriod;
  const [scope, setScope] = useState<"mine" | "calendars">(
    p.kind === "calendars" ? "calendars" : "mine",
  );
  useEffect(() => {
    if (p.kind === "calendars") setScope("calendars");
  }, [p.kind]);
  const [calendars, setCalendars] = useState<CalendarId[]>([
    "personal",
    "team",
    "room",
  ]);
  const [workHours, setWorkHours] = useState("9-18");
  const [metric, setMetric] = useState<"minutes" | "count">("minutes");
  const [detail, setDetail] = useState<{
    title: string;
    events: Meeting[];
  } | null>(null);
  const [generated, setGenerated] = useState("");
  const detailRef = useRef<HTMLDivElement>(null);
  const date = p.linked ? p.date : ownDate;
  const changeDate = p.linked ? p.setDate : setOwnDate;
  const range = periodFor(date, period);
  const [workStart, workEnd] = workHours.split("-").map((s) => Number(s) * 60);
  const query = {
    from: range.from,
    to: range.to,
    scope,
    calendars,
    workStart: workStart!,
    workEnd: workEnd!,
  };
  const input = p.empty ? [] : p.data.snapshot.events;
  const report = analyze(input, query);
  const previous = analyze(input, {
    ...query,
    from: range.previousFrom,
    to: range.previousTo,
  });
  const fingerprint = JSON.stringify([query, p.data.snapshot.version, p.empty]);
  useEffect(() => {
    setDetail(null);
    setGenerated("");
  }, [fingerprint]);
  const pick = (title: string, events: Meeting[]) => {
    setDetail({ title, events });
    setTimeout(
      () =>
        detailRef.current?.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        }),
      0,
    );
  };
  const complete = range.from >= "2026-08-31" && range.to <= "2026-11-15";
  const comparisonReady =
    complete &&
    range.previousFrom >= "2026-08-31" &&
    range.previousTo <= "2026-11-15";
  const delta = report.minutes - previous.minutes;
  const comparison = comparisonReady
    ? `${delta >= 0 ? "Больше" : "Меньше"} на ${hours(Math.abs(delta))}, чем за ${dateLabel(range.previousFrom)} — ${dateLabel(range.previousTo)}.`
    : "Для сравнения нет полного покрытия обоих периодов.";
  const scopeLabel =
    scope === "mine" ? "Личная нагрузка" : "Выбранные календари";
  const summary = `${scopeLabel}. ${dateLabel(range.from)} — ${dateLabel(range.to)}, Asia/Almaty. ${report.count} встреч, сумма длительностей ${hours(report.minutes)}, занято без наложений ${hours(report.busy)}. ${comparison} ${complete ? "" : "Данные частичные: часть периода вне демо-покрытия."} Регулярные встречи: ${hours(report.regularMinutes)}. Снимок ${p.data.snapshot.version}. Данные синтетические; фактическое присутствие неизвестно.`;
  const updated = new Intl.DateTimeFormat("ru", {
    timeZone: "Asia/Almaty",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(p.data.snapshot.updatedAt));
  return (
    <section
      className="insights-panel"
      aria-label={`Дэшборд: ${dashboards[p.kind]}`}
    >
      <div
        className="panel-caption"
        draggable
        onDragStart={(e) => e.dataTransfer.setData("text/plain", "analytics")}
      >
        <GripVertical size={14} />
        <select
          aria-label="Дэшборд"
          value={p.kind}
          onChange={(e) => {
            const kind = e.target.value as Dashboard;
            p.changeKind(kind);
            if (kind === "calendars") setScope("calendars");
          }}
        >
          {Object.entries(dashboards).map(([id, label]) => (
            <option value={id} key={id}>
              {label}
            </option>
          ))}
        </select>
        <span className="demo-pill">Демо</span>
      </div>
      <div className="insights-scroll">
        <div className="insights-heading">
          <div>
            <h2>{dashboards[p.kind]}</h2>
            <p>{scopeLabel} · Asia/Almaty</p>
          </div>
          <button
            className="icon-button"
            aria-label="Обновить аналитику"
            disabled={p.data.refreshing}
            onClick={p.data.refresh}
          >
            <RefreshCw
              size={16}
              className={p.data.refreshing ? "insights-spin" : ""}
            />
          </button>
        </div>
        <AnalyticsFilters
          date={date}
          range={range}
          period={period}
          setPeriod={setPeriod}
          changeDate={changeDate}
          scope={scope}
          setScope={setScope}
          workHours={workHours}
          setWorkHours={setWorkHours}
          calendars={calendars}
          setCalendars={setCalendars}
        />
        <div className="insights-freshness" role="status">
          <span className="status-dot" />
          {p.data.refreshing
            ? "Собираем демо-снимок…"
            : `Обновлено ${updated} · снимок ${p.data.snapshot.version}`}
        </div>
        {p.data.error && (
          <div className="insights-error" role="alert">
            {p.data.error}
            <button className="text-button" onClick={p.data.refresh}>
              Повторить обновление
            </button>
          </div>
        )}
        {p.data.storageError && (
          <p className="insights-error" role="status">
            Хранилище браузера недоступно. Снимок сохранится только до закрытия
            страницы.
          </p>
        )}
        {!complete && (
          <div className="insights-warning" role="status">
            <strong>Неполное покрытие периода</strong>
            <p>
              Демо-данные доступны с 31 августа по 15 ноября 2026. Итоги
              предварительные; дни вне этого диапазона неизвестны.
            </p>
          </div>
        )}
        {!calendars.length ? (
          <div className="insights-empty">
            <h3>Выберите календарь</h3>
            <p>Включите хотя бы один источник над графиком.</p>
          </div>
        ) : report.count === 0 ? (
          <div className="insights-empty">
            <h3>
              {complete
                ? "Встреч за период нет"
                : "Нет данных за выбранный период"}
            </h3>
            <p>
              {report.unconfirmed
                ? `${report.unconfirmed} событий без подтверждённого участия исключены из личной нагрузки.`
                : "В демо есть история за сентябрь — начало ноября 2026 года. Выберите другой период или источник."}
            </p>
          </div>
        ) : (
          <>
            <AnalyticsMetrics
              report={report}
              previous={previous}
              comparisonReady={comparisonReady}
              scope={scope}
              workHours={workHours}
              pick={pick}
              changeKind={p.changeKind}
            />
            {(p.kind === "load" || p.kind === "organizers") && (
              <div className="insights-chart-section">
                <div className="insights-section-heading">
                  <h3>
                    {p.kind === "organizers"
                      ? "Встречи по организаторам"
                      : "Динамика встреч"}
                  </h3>
                  <div className="metric-toggle" aria-label="Единица графика">
                    <button
                      aria-pressed={metric === "minutes"}
                      onClick={() => setMetric("minutes")}
                    >
                      Часы
                    </button>
                    <button
                      aria-pressed={metric === "count"}
                      onClick={() => setMetric("count")}
                    >
                      Количество
                    </button>
                  </div>
                </div>
                <div className="insights-chart-scroll">
                  <DailyChart
                    report={report}
                    previous={previous}
                    compare={comparisonReady}
                    metric={metric}
                    stacked={p.kind === "organizers"}
                    pick={pick}
                  />
                </div>
                <p className="chart-help">
                  Нажмите на столбик для детализации. Показан план по
                  расписанию, включая будущие события. Сравнение доступно при
                  полном покрытии обоих периодов.
                </p>
              </div>
            )}
            {p.kind === "organizers" && (
              <OrganizerTable report={report} pick={pick} />
            )}
            {p.kind === "load" && (
              <div className="insights-observations">
                <h3>Что стоит заметить</h3>
                <button
                  onClick={() =>
                    pick("Встречи выбранного периода", report.events)
                  }
                >
                  <span>{comparison}</span>
                  <ArrowRight size={14} />
                </button>
                <button onClick={() => p.changeKind("rhythm")}>
                  <span>
                    {report.windows.length} свободных окон от 60 минут в рабочих
                    часах.
                  </span>
                  <ArrowRight size={14} />
                </button>
                <p>
                  {report.overlap > 0
                    ? `Разница суммы длительностей и занятого времени: ${hours(report.overlap)} из-за наложений.`
                    : "Учтённые встречи не накладываются друг на друга."}
                </p>
              </div>
            )}
            {p.kind === "rhythm" && <Rhythm report={report} pick={pick} />}
            {p.kind === "calendars" && (
              <CalendarBreakdown
                report={report}
                input={input}
                query={query}
                pick={pick}
              />
            )}
            {p.kind === "report" && (
              <SmartReport
                report={report}
                generated={generated}
                generate={() => setGenerated(summary)}
                pick={pick}
              />
            )}
            <button
              className="insights-explain"
              onClick={() =>
                p.explain(
                  dashboards[p.kind],
                  detail
                    ? `${summary}\nВыбрано: ${detail.title}. ${detail.events.length} событий. ${detail.events.map((e) => `${e.title}: ${dateLabel(e.date)}, ${time(e.start)}, ${e.duration} мин`).join("; ")}`
                    : summary,
                )
              }
            >
              <Sparkles size={15} />
              Объяснить в ассистенте
              <ArrowRight size={14} />
            </button>
          </>
        )}
        {detail && (
          <div className="insights-detail" ref={detailRef}>
            <div className="insights-section-heading">
              <h3>{detail.title}</h3>
              <button className="text-button" onClick={() => setDetail(null)}>
                Скрыть
              </button>
            </div>
            <p className="chart-help">
              {detail.events.length} встреч в выбранной части отчёта
            </p>
            {detail.events.map((e) => (
              <div className="insights-event-row" key={e.id}>
                <button className="insights-event" onClick={() => p.select(e)}>
                  <span>
                    {dateLabel(e.date, { day: "numeric", month: "short" })} ·{" "}
                    {time(e.start)}
                  </span>
                  <strong>{e.title}</strong>
                  <span>
                    {e.organizer} · {e.duration} мин
                  </span>
                </button>
                <button
                  className="text-button insights-jump"
                  aria-label={`Открыть в календаре: ${e.title}`}
                  onClick={() => p.openCalendar(e)}
                >
                  В календаре <ArrowRight size={13} />
                </button>
              </div>
            ))}
            {!detail.events.length && <p>В этой части периода встреч нет.</p>}
          </div>
        )}
        <details className="insights-rules">
          <summary>Данные и правила подсчёта</summary>
          <p>
            Только синтетические события. Встречи и отдельные блоки фокуса
            размечены в демо-наборе; блоки фокуса и события от 24 часов
            исключены из метрик встреч. Регулярность задана явно.
          </p>
          <p>
            Личная нагрузка: вы организатор либо приняли приглашение.{" "}
            {report.unconfirmed} событий без подтверждённого участия исключены.
            Загрузка — объединение интервалов в рабочих часах. Фактическое
            присутствие, отмены и результативность неизвестны.
          </p>
          <p>
            Каждый день после 07:00 Asia/Almaty, пока страница открыта; после
            возвращения — догоняющее обновление. Снимок хранится локально в
            браузере. При закрытом браузере сбор не выполняется. Изменения
            демо-встреч попадут в аналитику после обновления.
          </p>
          <p>
            История в демо: 31 августа — 15 ноября 2026. Столбцы дней считают
            пересекающие день события, итог периода — уникальные встречи.
            Сравнение полного месяца — с предшествующим интервалом такой же
            длины.
          </p>
        </details>
      </div>
    </section>
  );
}
