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
}: {
  accountId: string;
  event: CalendarEvent;
  expired: () => void;
}) {
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
    if (!("id" in event.lookup)) return;
    const current = ++request.current;
    setBusy(true);
    setPreview(null);
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
        Только предпросмотр. Встреча не изменяется, приглашения не отправляются.
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
            disabled={busy}
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
            disabled={busy || !title.trim()}
          >
            Предпросмотр названия
          </button>
          <button
            className="secondary"
            type="button"
            disabled={busy}
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
              : "Это предложение отмены встречи для всего состава, а не отказ одного участника."}
          </p>
          <p role="status">
            Ничего не применено. Отправка изменений пока недоступна.
          </p>
        </section>
      )}
    </section>
  );
}
