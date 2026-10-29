import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type { CalendarEvent } from "../shared/calendar.js";
import {
  addDateDays,
  calendarDateAt,
  calendarRange,
  calendarTimeZone,
} from "../shared/calendar-time.js";
import {
  defaultSeriesScope,
  scopeLabels,
  seriesScopes,
  seriesTarget,
  type SeriesGateState,
  type SeriesRequest,
  type SeriesScope,
} from "../shared/series-scope.js";
import { notifyError, notifySuccess } from "./notification-events.js";

export type SeriesDialogOperation = "rename" | "move" | "delete";
const titles: Record<SeriesDialogOperation, string> = {
  rename: "Переименовать повторяющуюся встречу",
  move: "Перенести повторяющуюся встречу",
  delete: "Удалить повторяющуюся встречу",
};
const confirmLabels: Record<SeriesDialogOperation, string> = {
  rename: "Сохранить название",
  move: "Перенести",
  delete: "Удалить",
};
const clock = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: calendarTimeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
const human = (value: string) =>
  new Intl.DateTimeFormat("ru", {
    timeZone: calendarTimeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(value));
/** Local date and "HH:MM" to an instant, through the calendar's own day boundaries. */
function instant(date: string, time: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match || addDateDays(date, 0) !== date) return null;
  return new Date(
    Date.parse(calendarRange(date, "day").start) +
      (Number(match[1]) * 60 + Number(match[2])) * 60000,
  ).toISOString();
}

export function SeriesScopeDialog({
  accountId,
  event,
  operation,
  close,
  done,
  expired,
}: {
  accountId: string;
  event: CalendarEvent;
  operation: SeriesDialogOperation;
  close: () => void;
  done: () => void;
  expired: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const [scope, setScope] = useState<SeriesScope>(defaultSeriesScope);
  const [title, setTitle] = useState(event.title);
  const [date, setDate] = useState(calendarDateAt(event.startsAt));
  const [start, setStart] = useState(clock(event.startsAt));
  const [end, setEnd] = useState(clock(event.endsAt));
  const [gate, setGate] = useState<SeriesGateState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const target = useMemo(() => seriesTarget(event), [event]);
  const request = useMemo<SeriesRequest | null>(() => {
    if (!target) return null;
    const base = {
      accountId,
      operation,
      scope,
      ...target,
      beforeStart: event.startsAt,
      beforeEnd: event.endsAt,
    };
    if (operation === "rename")
      return title.trim() ? { ...base, title: title.trim() } : null;
    if (operation === "delete") return base;
    const newStartsAt = instant(date, start);
    const newEndsAt = instant(date, end);
    return newStartsAt &&
      newEndsAt &&
      Date.parse(newStartsAt) < Date.parse(newEndsAt)
      ? { ...base, newStartsAt, newEndsAt }
      : null;
  }, [accountId, date, end, event, operation, scope, start, target, title]);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  // A stable key, so the gate is asked once per distinct request and never in a render loop.
  const requestKey = request ? JSON.stringify(request) : "";
  useEffect(() => {
    let active = true;
    setGate(null);
    if (!requestKey) return;
    void window.smallDesktop.series
      .gate(JSON.parse(requestKey) as SeriesRequest)
      .then((reply) => {
        if (!active) return;
        if (reply.ok) setGate(reply.data);
        else {
          setError(reply.error);
          if (reply.kind === "auth") expired();
        }
      })
      .catch(() => {
        if (active) setError("Не удалось проверить действие.");
      });
    return () => {
      active = false;
    };
  }, [requestKey, expired]);
  const open = Boolean(request && gate?.open) && !busy;
  async function confirm() {
    if (!request || !open || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const reply = await window.smallDesktop.series.apply(request);
      if (reply.ok) {
        notifySuccess(
          operation === "delete" ? "Вхождение удалено" : "Изменения сохранены",
        );
        done();
      } else {
        setError(reply.error);
        notifyError("изменить повторяющуюся встречу", reply.kind);
        if (reply.kind === "auth") expired();
      }
    } catch {
      setError("Не удалось подтвердить действие. Обновите календарь.");
      notifyError("изменить повторяющуюся встречу");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="modal series-scope-dialog"
      aria-labelledby="series-scope-title"
      // React bubbles cancel/close to the card's own handlers, which would close the card too.
      onCancel={(e) => {
        e.stopPropagation();
        close();
      }}
      onClose={(e) => {
        e.stopPropagation();
        close();
      }}
    >
      <div className="modal-header">
        <h2 id="series-scope-title">{titles[operation]}</h2>
        <button
          className="icon-button"
          aria-label="Закрыть выбор области"
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      <p className="series-scope-occurrence">
        <strong>{event.title}</strong>
        <br />
        {human(event.startsAt)} · {clock(event.startsAt)}–{clock(event.endsAt)}
      </p>
      {!target && (
        <p role="alert" className="form-error">
          Не удалось определить серию. Обновите календарь.
        </p>
      )}
      <fieldset className="series-scope-options" disabled={busy}>
        <legend>Область изменения</legend>
        {seriesScopes.map((value) => {
          const unavailable = operation === "delete" && value === "following";
          return (
            <label key={value}>
              <input
                type="radio"
                name="series-scope"
                value={value}
                checked={scope === value}
                disabled={unavailable}
                onChange={() => setScope(value)}
              />
              {scopeLabels[value]}
              {unavailable && (
                <small> — для удаления доступно только одно вхождение</small>
              )}
            </label>
          );
        })}
      </fieldset>
      {operation === "rename" && (
        <label className="series-scope-field">
          Новое название
          <input
            value={title}
            maxLength={200}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
      )}
      {operation === "move" && (
        <div className="series-scope-times">
          <label>
            Дата
            <input
              type="date"
              value={date}
              disabled={busy}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            Начало
            <input
              type="time"
              value={start}
              disabled={busy}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            Конец
            <input
              type="time"
              value={end}
              disabled={busy}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
      )}
      {gate && (
        <p className="series-scope-summary" data-testid="series-summary">
          {gate.summary}
        </p>
      )}
      {gate && !gate.open && (
        <p role="status" className="series-scope-closed">
          {gate.message}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="series-scope-actions">
        <button className="secondary" onClick={close} disabled={busy}>
          Отмена
        </button>
        <button
          className={operation === "delete" ? "danger" : "primary"}
          disabled={!open}
          onClick={() => void confirm()}
        >
          {busy ? "Выполняю…" : confirmLabels[operation]}
        </button>
      </div>
    </dialog>
  );
}
