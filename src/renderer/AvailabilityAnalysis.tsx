import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type {
  AvailabilityOpening,
  AvailabilityAnalysis,
  AnalysisQuery,
} from "../shared/availability-analysis.js";
import { analysisQuery } from "../shared/availability-analysis.js";
import type { CalendarPerson } from "../shared/calendar.js";
import {
  addDateDays,
  calendarDateAt,
  calendarRange,
} from "../shared/calendar-time.js";
import { useAvailability } from "./useAvailability";
import { MeetingPeoplePicker } from "./MeetingPeoplePicker";
import {
  AvailabilityWeekGrid,
  availabilityTime,
  availabilityDateLabel,
  type AvailabilityChoice,
} from "./AvailabilityWeekGrid";
import "./availability-analysis.css";
export function AvailabilityAnalysisPanel({
  opening,
  visible = true,
  selectedDate,
  onDateChange,
  refreshKey = 0,
  expired,
  draft,
  context,
  organizer,
}: {
  opening: AvailabilityOpening;
  visible?: boolean;
  selectedDate?: string;
  onDateChange?: (date: string) => void;
  refreshKey?: number;
  expired: () => void;
  draft: (choice: AvailabilityChoice, duration: number) => void;
  context?: (query: AnalysisQuery, people: CalendarPerson[]) => void;
  organizer?: CalendarPerson;
}) {
  const picker = useAvailability(
    opening.query.accountId,
    expired,
    opening.people,
    organizer ? [organizer] : [],
  );
  const [filters, setParams] = useState({
      ...opening.query,
      ...(organizer ? { organizerParticipantId: organizer.participantId } : {}),
    }),
    [commonOnly, setCommonOnly] = useState(false);
  const params = { ...filters, date: selectedDate ?? filters.date };
  const [data, setData] = useState<AvailabilityAnalysis | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(false),
    [refresh, setRefresh] = useState(0);
  const version = useRef(0),
    active = useRef(true);
  const preparationVersion = useRef(0),
    preparationRunning = useRef(false);
  const cancelSelection = useCallback(() => {
    preparationVersion.current++;
    preparationRunning.current = false;
    setPreparing(false);
  }, []);
  useEffect(() => {
    if (!visible) cancelSelection();
  }, [visible, cancelSelection]);
  const refreshAnalysis = useCallback(() => {
    cancelSelection();
    setRefresh((n) => n + 1);
  }, [cancelSelection]);
  const ids = picker.selected.map((p) => p.participantId);
  const signature = JSON.stringify({ ...params, participantIds: ids });
  const current = useRef(signature);
  current.current = signature;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      version.current++;
      preparationVersion.current++;
      preparationRunning.current = false;
    };
  }, []);
  useEffect(
    () =>
      window.smallDesktop.calendar.subscribe(() => {
        refreshAnalysis();
      }),
    [],
  );
  useEffect(() => {
    const sequence = ++version.current;
    cancelSelection();
    if (!visible) {
      setLoading(false);
      return;
    }
    setError("");
    if (!organizer) {
      setData(null);
      setError(
        "Не удалось определить организатора. Выполните вход в Small заново.",
      );
      setLoading(false);
      return;
    }
    if (!ids.length) {
      setData(null);
      setLoading(false);
      void window.smallDesktop.calendar.updateAvailabilityContext(null);
      return;
    }
    const parsed = analysisQuery.safeParse({ ...params, participantIds: ids });
    if (!parsed.success) {
      setError("Проверьте начало и окончание окна поиска.");
      setLoading(false);
      return;
    }
    setLoading(true);
    context?.(parsed.data, picker.selected);
    let disposed = false;
    const timer = setTimeout(
      () =>
        void window.smallDesktop.calendar
          .availabilityAnalysis(parsed.data)
          .then((reply) => {
            if (disposed || sequence !== version.current) return;
            if (reply.ok) setData(reply.data);
            else {
              setError(reply.error);
              if (reply.kind === "auth") expired();
            }
          })
          .catch(() => {
            if (!disposed && sequence === version.current)
              setError(
                "Не удалось проверить доступность. Повторите обновление.",
              );
          })
          .finally(() => {
            if (!disposed && sequence === version.current) setLoading(false);
          }),
      150,
    );
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [signature, refresh, refreshKey, visible]);
  const update = (value: Partial<AnalysisQuery>) => {
    cancelSelection();
    setParams((q) => ({ ...q, ...value }));
  };
  function choose(value: AvailabilityChoice) {
    void prepare(value);
  }
  async function prepare(selection: AvailabilityChoice) {
    if (preparationRunning.current || loading || error) return;
    const operation = ++preparationVersion.current;
    preparationRunning.current = true;
    const dataVersion = version.current;
    const captured = current.current;
    setPreparing(true);
    setError("");
    const effectivePeople =
      organizer &&
      !selection.people.some((p) => p.participantId === organizer.participantId)
        ? [organizer, ...selection.people]
        : selection.people;
    const end = new Date(
      Date.parse(selection.start) + params.durationMinutes * 60000,
    ).toISOString();
    try {
      const reply = await window.smallDesktop.calendar.slots({
        accountId: params.accountId,
        participantIds: effectivePeople.map((p) => p.participantId),
        date: calendarDateAt(selection.start),
        durationMinutes: params.durationMinutes,
        includeWeekends: params.includeWeekends,
        exactInterval: { start: selection.start, end },
        bufferMinutes: params.bufferMinutes,
        ...(organizer?.participantId || params.organizerParticipantId
          ? {
              organizerParticipantId:
                organizer?.participantId ?? params.organizerParticipantId!,
            }
          : {}),
      });
      if (
        !active.current ||
        captured !== current.current ||
        dataVersion !== version.current ||
        operation !== preparationVersion.current
      )
        return;
      if (!reply.ok) {
        setError(reply.error);
        if (reply.kind === "auth") expired();
        return;
      }
      if (
        !reply.data.slots.some(
          (s) =>
            Date.parse(s.start) === Date.parse(selection.start) &&
            Date.parse(s.end) >= Date.parse(end),
        )
      ) {
        setError(
          "Это время уже занято или не подтверждено. Обновите доступность.",
        );
        return;
      }
      draft({ ...selection, people: effectivePeople }, params.durationMinutes);
    } catch {
      if (active.current && operation === preparationVersion.current)
        setError("Не удалось перепроверить выбранное время.");
    } finally {
      if (active.current && operation === preparationVersion.current) {
        preparationRunning.current = false;
        setPreparing(false);
      }
    }
  }
  const periodRange = calendarRange(params.date, params.period);
  const firstDate = calendarDateAt(periodRange.start);
  const lastDate = addDateDays(calendarDateAt(periodRange.end), -1);
  const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    ...(firstDate.slice(0, 4) !== lastDate.slice(0, 4)
      ? { year: "numeric" as const }
      : {}),
  });
  const formatDate = (date: string) =>
    dateFormatter.format(new Date(`${date}T12:00:00Z`));
  const periodLabel =
    params.period === "day"
      ? formatDate(firstDate)
      : `${formatDate(firstDate)} — ${formatDate(lastDate)}`;
  function navigatePeriod(direction: number) {
    const next = addDateDays(
      params.date,
      direction * (params.period === "week" ? 7 : 1),
    );
    cancelSelection();
    if (onDateChange) onDateChange(next);
    else update({ date: next });
  }
  const windows = data?.days.flatMap((d) => d.commonWindows) ?? [];
  const available = Boolean(data) && !loading && !error;
  return (
    <section
      className="availability-panel"
      aria-label="Свободные слоты"
      aria-busy={loading || preparing}
      onKeyDown={(e) => {
        if (e.key === "Escape") cancelSelection();
      }}
    >
      <div className="calendar-toolbar analysis-period-heading">
        <div>
          <div className="inline period-controls">
            <button
              type="button"
              className="icon-button"
              aria-label="Предыдущий период доступности"
              onClick={() => navigatePeriod(-1)}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Следующий период доступности"
              onClick={() => navigatePeriod(1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <h2 aria-live="polite">{periodLabel}</h2>
        </div>
      </div>
      <div className="demo-filters">
        <label>
          Период
          <select
            aria-label="Период доступности"
            value={params.period}
            onChange={(e) =>
              update({ period: e.target.value as "day" | "week" })
            }
          >
            <option value="week">Неделя</option>
            <option value="day">День</option>
          </select>
        </label>
        <label>
          Длительность
          <select
            aria-label="Длительность встречи"
            value={params.durationMinutes}
            onChange={(e) =>
              update({ durationMinutes: Number(e.target.value) })
            }
          >
            {[...new Set([30, 60, 90, params.durationMinutes])]
              .sort((a, b) => a - b)
              .map((n) => (
                <option key={n} value={n}>
                  {n} мин
                </option>
              ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={params.includeWeekends}
            onChange={(e) => update({ includeWeekends: e.target.checked })}
          />
          Выходные
        </label>
        <div className="demo-mode">
          <button
            aria-pressed={!commonOnly}
            onClick={() => setCommonOnly(false)}
          >
            Сотрудники
          </button>
          <button aria-pressed={commonOnly} onClick={() => setCommonOnly(true)}>
            Общие окна
          </button>
        </div>
      </div>
      <div className="analysis-time-window">
        <label>
          Окно поиска с{" "}
          <input
            type="time"
            value={params.timeFrom}
            onChange={(e) => update({ timeFrom: e.target.value })}
          />
        </label>
        <label>
          до{" "}
          <input
            type="time"
            value={params.timeTo}
            onChange={(e) => update({ timeTo: e.target.value })}
          />
        </label>
      </div>
      <div className="analysis-people">
        <label>Участники</label>
        <MeetingPeoplePicker data={picker} label="участников" />
      </div>
      <div className="demo-summary">
        <span>
          <strong>{available ? windows.length : "—"}</strong> общих окон
        </span>
        <span>
          <strong>
            {available
              ? `${windows.reduce((n, w) => n + (Date.parse(w.end) - Date.parse(w.start)) / 3600000, 0).toLocaleString("ru-RU")} ч`
              : "—"}
          </strong>{" "}
          доступны всем
        </span>
        {available && windows[0] && (
          <p>
            Ближайшее:{" "}
            <strong>
              {availabilityDateLabel(calendarDateAt(windows[0].start))} ·{" "}
              {availabilityTime(windows[0].start)}–
              {availabilityTime(windows[0].end)}
            </strong>
          </p>
        )}
      </div>
      {!ids.length && (
        <p className="analysis-feedback" role="status">
          Выберите хотя бы одного сотрудника для анализа.
        </p>
      )}
      {loading && (
        <p className="analysis-feedback" role="status">
          Проверяем доступность сотрудников…
        </p>
      )}
      {error && (
        <p className="analysis-feedback" role="alert">
          {error} {data && "Данные неактуальны; выбор времени недоступен."}{" "}
          <button onClick={refreshAnalysis}>Повторить</button>
        </p>
      )}
      {data?.days.some((d) => d.participants.some((p) => p.issue)) && (
        <p className="analysis-feedback" role="status">
          Данные части сотрудников неполные. Неизвестные интервалы не
          подтверждают доступность.
        </p>
      )}
      {available && !windows.length && (
        <p className="analysis-feedback" role="status">
          Общих окон нужной длительности нет. Измените период, состав или
          длительность.
        </p>
      )}
      {data && ids.length > 0 && (
        <AvailabilityWeekGrid
          data={data}
          people={picker.selected}
          commonOnly={commonOnly}
          choose={choose}
          disabled={!available || preparing}
        />
      )}
      <div className="demo-bottom">
        <div className="demo-legend">
          <span>
            <i className="free" />
            Свободен
          </span>
          <span>
            <i className="busy" />
            Занят
          </span>
          <span>
            <i className="common" />
            Общее окно
          </span>
          <span>
            <i className="unknown" />
            Нет данных
          </span>
          <span>
            <i className="outside-hours" />
            Вне рабочего времени / окна
          </span>
        </div>
        <span>
          Шкала 00–24{data ? ` · ${availabilityTime(data.fetchedAt)}` : ""}
        </span>
      </div>
    </section>
  );
}
