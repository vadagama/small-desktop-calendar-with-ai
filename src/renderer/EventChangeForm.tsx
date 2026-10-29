import type { EventMutationResult } from "../shared/event-mutation.js";
import { useEffect, useRef, useState } from "react";
import type { CalendarEvent } from "../shared/calendar.js";
import type {
  EventChange,
  EventChangePreview,
} from "../shared/event-change.js";
import { calendarTimeZone } from "../shared/calendar-time.js";

export function EventChangeForm({
  accountId,
  event,
  expired,
  changed,
}: {
  accountId: string;
  event: CalendarEvent;
  expired: () => void;
  changed: () => void;
}) {
  const [result, setResult] = useState<EventMutationResult | null>(null);
  const locked = !!result && result.phase !== "preview";
  const sending = useRef(false);
  const [title, setTitle] = useState(event.title);
  const [preview, setPreview] = useState<EventChangePreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const prepare = async (change: EventChange) => {
    if (!("id" in event.lookup) || sending.current || locked) return;
    const current = ++request.current;
    setBusy(true);
    setPreview(null);
    setResult(null);
    setError("");
    try {
      const reply = await window.smallDesktop.calendar.previewChange({
        accountId,
        eventId: event.lookup.id,
        change,
      });
      if (current !== request.current) return;
      if (reply.ok) setPreview(reply.data);
      else {
        setError(reply.error);
        if (reply.kind === "auth") expired();
      }
    } catch {
      if (current === request.current)
        setError("Не удалось подготовить предпросмотр встречи.");
    } finally {
      if (current === request.current) setBusy(false);
    }
  };
  const apply = async (reconcile = false) => {
    if (!preview?.operationId || sending.current) return;
    sending.current = true;
    const current = ++request.current;
    setBusy(true);
    setError("");
    setResult({ phase: "unknown", message: "Проверяем результат изменения…" });
    try {
      const action = reconcile
        ? window.smallDesktop.calendar.reconcileChange
        : window.smallDesktop.calendar.confirmChange;
      const reply = await action({
        accountId,
        operationId: preview.operationId,
      });
      if (current !== request.current) return;
      if (reply.ok) {
        setResult(reply.data);
        if (reply.data.phase === "succeeded") changed();
      } else {
        setResult({
          phase: "unknown",
          message:
            "Ответ не получен. Проверьте результат перед дальнейшими действиями.",
        });
        setError(reply.error);
        if (reply.kind === "auth") expired();
      }
    } catch {
      if (current === request.current)
        setResult({
          phase: "unknown",
          message:
            "Ответ не получен. Проверьте результат перед дальнейшими действиями.",
        });
    } finally {
      sending.current = false;
      if (current === request.current) setBusy(false);
    }
  };
  if (!("id" in event.lookup))
    return (
      <p className="form-note">
        Изменение серий и их вхождений пока недоступно.
      </p>
    );
  const format = (date: string) =>
    new Intl.DateTimeFormat("ru", {
      timeZone: calendarTimeZone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(date));
  return (
    <section aria-label="Подготовка изменения встречи" className="event-change">
      <h3>Подготовить изменение</h3>
      <p className="form-note">
        Сначала проверьте предложение, затем подтвердите применение.
      </p>
      <form
        className="meeting-form"
        onSubmit={(e) => {
          e.preventDefault();
          void prepare({ kind: "rename", title });
        }}
      >
        <label>
          Новое название
          <input
            value={title}
            maxLength={200}
            required
            disabled={busy || locked}
            onChange={(e) => {
              setTitle(e.target.value);
              setPreview(null);
              setError("");
            }}
          />
        </label>
        <div className="event-change-actions">
          <button
            className="primary"
            type="submit"
            disabled={busy || locked || !title.trim()}
          >
            Предпросмотр названия
          </button>
          <button
            className="secondary"
            type="button"
            disabled={busy || locked}
            onClick={() => void prepare({ kind: "cancel" })}
          >
            Предпросмотр отмены
          </button>
        </div>
      </form>
      {busy && <p role="status">Проверяю актуальную встречу и организатора…</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {preview && (
        <section aria-label="Предпросмотр изменения" aria-live="polite">
          <h4>
            {preview.kind === "rename"
              ? "Изменение названия"
              : "Отмена разовой встречи"}
          </h4>
          <dl className="event-details-fields">
            <dt>Сейчас</dt>
            <dd>{preview.before.title}</dd>
            <dt>Предлагается</dt>
            <dd>{preview.afterTitle ?? "Отменить всю разовую встречу"}</dd>
            <dt>Время</dt>
            <dd>
              {format(preview.before.startsAt)} —{" "}
              {format(preview.before.endsAt)} · {calendarTimeZone}
            </dd>
            <dt>Участники</dt>
            <dd>
              {preview.before.participantIds.join(", ") || "Нет участников"}
            </dd>
            <dt>Описание</dt>
            <dd>{preview.before.description || "Нет описания"}</dd>
            <dt>Место</dt>
            <dd>{preview.before.location || "Не указано"}</dd>
          </dl>
          <p>
            {preview.kind === "rename"
              ? "В предложении меняется только название; время, состав, описание и место сохраняются."
              : "После подтверждения разовая встреча будет удалена из календаря для всех участников."}
          </p>
          <p role="status">
            {result?.message ?? "Ничего не применено. Подтвердите изменение."}
          </p>
          {preview.operationId && !locked && (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void apply()}
            >
              {preview.kind === "rename"
                ? "Применить название"
                : "Подтвердить отмену встречи"}
            </button>
          )}
          {result?.phase === "unknown" && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void apply(true)}
            >
              Проверить результат изменения
            </button>
          )}
        </section>
      )}
    </section>
  );
}
