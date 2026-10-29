import { CalendarSlots } from "./CalendarSlots";
import { layoutEvents } from "./event-layout";
import { useEventTooltip } from "./useEventTooltip";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Search,
  GripVertical,
  RefreshCw,
  ShieldAlert,
  WifiOff,
  X,
} from "lucide-react";
import {
  addDays,
  dateLabel,
  monthDays,
  shiftMonth,
  time,
  TODAY,
  weekStart,
} from "./calendar";
import type { DataState, Meeting, View, Slot } from "./types";
import { ViewTransition, useEffect, useRef, useState } from "react";
interface Props {
  date: string;
  setDate: (date: string) => void;
  view: View;
  setView: (view: View) => void;
  events: Meeting[];
  select: (meeting: Meeting) => void;
  change: (meeting: Meeting) => void;
  state: DataState;
  retry: () => void;
  swap: () => void;
  readOnly?: boolean;
  create?: (slot: Slot) => void;
  canChange?: (meeting: Meeting) => boolean;
  revealEventId?: string;
  /** Cards to highlight after a background change, by meeting id. */
  changes?: Record<string, "added" | "changed" | "moved">;
  /** Cards whose new time is not confirmed by the server yet, by meeting id. */
  pending?: Record<string, "saving" | "unknown">;
  today?: string;
  footerLabel?: string;
  hideFooter?: boolean;
  statusContent?: React.ReactNode;
}
export function Calendar(p: Props) {
  const container = useRef<HTMLElement>(null);
  useEffect(() => {
    if (p.revealEventId)
      container.current
        ?.querySelector('[data-new-event="true"]')
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [p.revealEventId]);
  const today = p.today ?? TODAY;
  const hasStatus = Boolean(p.statusContent);
  const tooltip = useEventTooltip();
  const scroll = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 8 * 64;
  }, [p.view, p.state, hasStatus]);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  const currentDate = `${part("year")}-${part("month")}-${part("day")}`;
  const currentMinutes = Number(part("hour")) * 60 + Number(part("minute"));
  const gesture = useRef<{
    event: Meeting;
    mode: string;
    x: number;
    y: number;
    width: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const [preview, setPreview] = useState<{
    id: string;
    start: number;
    duration: number;
    x: number;
  } | null>(null);
  function position(x: number, y: number) {
    const g = gesture.current!;
    const delta = Math.round((y - g.y) / (64 / 60) / 15) * 15;
    let start = g.event.start,
      end = start + g.event.duration;
    if (g.mode === "start")
      start = Math.max(0, Math.min(end - 15, start + delta));
    else if (g.mode === "end")
      end = Math.min(1440, Math.max(start + 15, end + delta));
    else {
      start = Math.max(0, Math.min(1440 - g.event.duration, start + delta));
      end = start + g.event.duration;
    }
    const dayIndex = days.indexOf(g.event.date);
    const offset =
      g.mode === "move"
        ? Math.max(
            -dayIndex,
            Math.min(
              days.length - 1 - dayIndex,
              Math.round((x - g.x) / g.width),
            ),
          )
        : 0;
    return {
      ...g.event,
      date: days[dayIndex + offset],
      start,
      duration: end - start,
      offset,
    };
  }
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const start = weekStart(p.date);
  const days =
    p.view === "day"
      ? [p.date]
      : Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const filtered = p.events.filter((e) =>
    e.title.toLocaleLowerCase("ru").includes(search.toLocaleLowerCase("ru")),
  );
  const navigate = (n: number) =>
    p.setDate(
      p.view === "month"
        ? shiftMonth(p.date, n)
        : addDays(p.date, n * (p.view === "week" ? 7 : 1)),
    );
  const title =
    p.view === "week"
      ? `${dateLabel(start)} — ${dateLabel(addDays(start, 6))}`
      : dateLabel(
          p.date,
          p.view === "month" ? { month: "long", year: "numeric" } : undefined,
        );
  return (
    <section className="calendar-panel" ref={container} aria-label="Календарь">
      <div
        className="panel-caption"
        draggable
        onDragStart={(e) => e.dataTransfer.setData("text/plain", "calendar")}
      >
        <span>
          <GripVertical size={14} />
          Календарь
        </span>
        <span className="subtle">Asia/Almaty · UTC+5</span>
        <button
          className="icon-button"
          aria-label="Поменять панели местами"
          onClick={p.swap}
        >
          <GripVertical size={15} />
        </button>
      </div>
      <div className="calendar-toolbar">
        <div>
          <div className="inline period-controls">
            <button
              className="icon-button"
              aria-label="Предыдущий период"
              onClick={() => navigate(-1)}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              className="icon-button"
              aria-label="Следующий период"
              onClick={() => navigate(1)}
            >
              <ChevronRight size={18} />
            </button>
            <button className="today-button" onClick={() => p.setDate(today)}>
              Сегодня
            </button>
          </div>
          <h2>{title}</h2>
        </div>
        <div className="toolbar-actions">
          <button
            className="icon-button"
            aria-label={searchOpen ? "Закрыть поиск" : "Поиск встреч"}
            onClick={() => {
              setSearchOpen(!searchOpen);
              setSearch("");
            }}
          >
            {searchOpen ? <X size={17} /> : <Search size={17} />}
          </button>
          <div className="view-switch" aria-label="Вид календаря">
            {(
              [
                ["day", "День"],
                ["week", "Неделя"],
                ["month", "Месяц"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                aria-pressed={p.view === id}
                className={p.view === id ? "selected" : ""}
                onClick={() => p.setView(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {searchOpen && (
        <div className="search-row">
          <Search size={16} />
          <input
            autoFocus
            aria-label="Поиск по названию"
            placeholder="Найти встречу…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}
      {p.statusContent ? (
        p.statusContent
      ) : p.state !== "ready" ? (
        <CalendarState state={p.state} retry={p.retry} />
      ) : p.view === "month" ? (
        <div className="month-scroll">
          <div className="month-grid">
            {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
              <div className="month-weekday" key={d}>
                {d}
              </div>
            ))}
            {monthDays(p.date).map((day) => (
              <div
                key={day}
                className={`month-day ${day.slice(0, 7) !== p.date.slice(0, 7) ? "outside" : ""}`}
              >
                <button
                  className={day === today ? "today-number" : ""}
                  onClick={() => {
                    p.setDate(day);
                    p.setView("day");
                  }}
                  aria-label={`Открыть ${dateLabel(day)}`}
                >
                  {Number(day.slice(-2))}
                </button>
                {filtered
                  .filter((e) => e.date === day)
                  .map((e) => (
                    <button
                      {...tooltip.bind(e)}
                      aria-description={
                        e.participation === "organizer"
                          ? "Моя встреча"
                          : e.participation === "informed"
                            ? "Я информируемый"
                            : e.participation === "invited"
                              ? "Я приглашён"
                              : "Роль не указана"
                      }
                      data-new-event={e.id === p.revealEventId || undefined}
                      data-change={p.changes?.[e.id]}
                      data-pending={p.pending?.[e.id]}
                      aria-busy={p.pending?.[e.id] ? true : undefined}
                      className={`month-event calendar-${e.calendar} participation-${e.participation ?? "unknown"} ${e.accepted && e.participation !== "informed" ? "accepted" : ""}`}
                      key={e.id}
                      onClick={() => {
                        tooltip.hide();
                        p.select(e);
                      }}
                    >
                      <span>{time(e.start)}</span> {e.title}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="timeline-scroll" ref={scroll}>
          <div
            className="timeline"
            style={{ "--days": days.length } as React.CSSProperties}
          >
            <div className="day-headings">
              <span className="timezone">GMT+5</span>
              {days.map((day) => (
                <button
                  key={day}
                  className={`day-heading ${day === today ? "current" : ""}`}
                  onClick={() => {
                    p.setDate(day);
                    p.setView("day");
                  }}
                >
                  <span>{dateLabel(day, { weekday: "short" })}</span>
                  <strong>{Number(day.slice(-2))}</strong>
                  {day === today && (
                    <span className="today-caption">Сегодня</span>
                  )}
                </button>
              ))}
            </div>
            <div className="time-body">
              {days.includes(currentDate) && (
                <div
                  className="current-time-line"
                  style={{ top: currentMinutes * (64 / 60) }}
                  aria-label={`Текущее время ${time(currentMinutes)}`}
                >
                  <span>{time(currentMinutes)}</span>
                </div>
              )}
              <div className="hours">
                {Array.from({ length: 25 }, (_, i) => (
                  <span style={{ top: i * 64 }} key={i}>
                    {time(i * 60)}
                  </span>
                ))}
              </div>
              {days.map((day) => (
                <div
                  className={`day-column ${day === today ? "current" : ""}`}
                  key={day}
                >
                  {p.create && !p.readOnly ? (
                    <CalendarSlots
                      date={day}
                      create={p.create}
                      disabled={day < today}
                    />
                  ) : (
                    Array.from({ length: 24 }, (_, i) => (
                      <div className="hour-cell" key={i} />
                    ))
                  )}
                  {layoutEvents(filtered.filter((e) => e.date === day)).map(
                    ({ event: e, column, columns }) => (
                      <ViewTransition
                        key={e.id}
                        default="none"
                        enter="auto"
                        exit="auto"
                        update="auto"
                      >
                        <button
                          {...tooltip.bind(e)}
                          aria-description={
                            e.participation === "organizer"
                              ? "Моя встреча"
                              : e.participation === "informed"
                                ? "Я информируемый"
                                : e.participation === "invited"
                                  ? "Я приглашён"
                                  : "Роль не указана"
                          }
                          data-new-event={e.id === p.revealEventId || undefined}
                          data-change={p.changes?.[e.id]}
                          data-pending={p.pending?.[e.id]}
                          aria-busy={p.pending?.[e.id] ? true : undefined}
                          className={`calendar-event calendar-${e.calendar} participation-${e.participation ?? "unknown"} ${e.accepted && e.participation !== "informed" ? "accepted" : ""} ${e.duration <= 30 ? "compact" : ""}`}
                          style={{
                            left: `calc(${(column * 100) / columns}% + 3px)`,
                            right: "auto",
                            width: `calc(${100 / columns}% - 6px)`,
                            top:
                              (preview?.id === e.id ? preview.start : e.start) *
                              (64 / 60),
                            transform:
                              preview?.id === e.id
                                ? `translateX(${preview.x}px)`
                                : undefined,
                            zIndex: preview?.id === e.id ? 5 : undefined,
                            height:
                              (preview?.id === e.id
                                ? preview.duration
                                : e.duration) *
                                (64 / 60) -
                              3,
                          }}
                          onPointerDown={(event) => {
                            tooltip.hide();
                            suppressClick.current = false;
                            if (
                              p.readOnly ||
                              p.canChange?.(e) === false ||
                              event.button !== 0
                            )
                              return;
                            const mode =
                              (event.target as HTMLElement).dataset.resize ||
                              "move";
                            gesture.current = {
                              event: e,
                              mode,
                              x: event.clientX,
                              y: event.clientY,
                              width:
                                event.currentTarget.parentElement!.getBoundingClientRect()
                                  .width,
                              moved: false,
                            };
                            suppressClick.current = false;
                            event.currentTarget.setPointerCapture(
                              event.pointerId,
                            );
                          }}
                          onPointerMove={(event) => {
                            const g = gesture.current;
                            if (!g || g.event.id !== e.id) return;
                            if (
                              Math.abs(event.clientX - g.x) +
                                Math.abs(event.clientY - g.y) <
                                5 &&
                              !g.moved
                            )
                              return;
                            g.moved = true;
                            const next = position(event.clientX, event.clientY);
                            setPreview({
                              id: e.id,
                              start: next.start,
                              duration: next.duration,
                              x: next.offset * g.width,
                            });
                          }}
                          onPointerUp={(event) => {
                            const g = gesture.current;
                            if (!g) return;
                            if (g.moved) {
                              const { offset: _offset, ...updated } = position(
                                event.clientX,
                                event.clientY,
                              );
                              if (
                                updated.start !== e.start ||
                                updated.duration !== e.duration ||
                                updated.date !== e.date
                              )
                                p.change(updated);
                              suppressClick.current = true;
                            }
                            gesture.current = null;
                            setPreview(null);
                            event.currentTarget.releasePointerCapture(
                              event.pointerId,
                            );
                          }}
                          onLostPointerCapture={() => {
                            gesture.current = null;
                            setPreview(null);
                          }}
                          onPointerCancel={() => {
                            gesture.current = null;
                            setPreview(null);
                          }}
                          onClick={() => {
                            if (suppressClick.current) {
                              suppressClick.current = false;
                              return;
                            }
                            tooltip.hide();
                            p.select(e);
                          }}
                        >
                          {!p.readOnly && p.canChange?.(e) !== false && (
                            <>
                              <span
                                className="event-resize start"
                                aria-hidden="true"
                                data-resize="start"
                                title="Изменить начало"
                              />
                              <span
                                className="event-resize end"
                                aria-hidden="true"
                                data-resize="end"
                                title="Изменить окончание"
                              />
                            </>
                          )}
                          <strong>
                            {e.title}
                            {e.duration <= 30 && (
                              <>
                                {" "}
                                {time(e.start)} - {time(e.start + e.duration)}
                              </>
                            )}
                          </strong>
                          <span className="event-time">
                            {time(e.start)} – {time(e.start + e.duration)}
                          </span>
                          {!p.readOnly && e.duration >= 60 && (
                            <small>
                              {!p.readOnly && e.location === "Онлайн"
                                ? `${e.people.length} участника · Онлайн`
                                : e.location}
                            </small>
                          )}
                        </button>
                      </ViewTransition>
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
          {!filtered.some((e) => days.includes(e.date)) && (
            <div className="empty-period">
              <CalendarDays size={18} />
              <span>
                {search
                  ? "По вашему запросу встреч нет"
                  : "В этом периоде встреч нет"}
              </span>
            </div>
          )}
        </div>
      )}
      {tooltip.tooltip}
      {!p.hideFooter && (
        <div className="calendar-footer">
          <span>
            <span className="status-dot" />
            {p.footerLabel ?? "Демонстрационные данные"}
          </span>
          <span>
            {p.view === "week"
              ? "Неделя · Пн–Вс"
              : p.view === "day"
                ? "День"
                : "Месяц"}
          </span>
        </div>
      )}
    </section>
  );
}
function CalendarState({
  state,
  retry,
}: {
  state: DataState;
  retry: () => void;
}) {
  if (state === "loading")
    return (
      <div className="state-screen" role="status">
        <RefreshCw className="loading-icon" size={27} />
        <h3>Загружаем календарь</h3>
        <p>Подготавливаем демонстрационные события…</p>
      </div>
    );
  const copy =
    state === "error"
      ? [
          "Не удалось загрузить календарь",
          "Проверьте соединение и попробуйте ещё раз. Занятость сейчас неизвестна.",
        ]
      : state === "denied"
        ? [
            "Нет доступа к календарю",
            "В этом сценарии сервер не разрешает просмотр. Занятость неизвестна.",
          ]
        : [
            "Пока никаких встреч",
            "Свободное пространство для новых планов. Создайте первую демо-встречу.",
          ];
  return (
    <div className="state-screen" role="status">
      {state === "error" ? (
        <WifiOff size={30} />
      ) : state === "denied" ? (
        <ShieldAlert size={30} />
      ) : (
        <CalendarDays size={30} />
      )}
      <h3>{copy[0]}</h3>
      <p>{copy[1]}</p>
      {state !== "empty" && (
        <button className="secondary" onClick={retry}>
          <RefreshCw size={15} />
          Повторить загрузку
        </button>
      )}
    </div>
  );
}
