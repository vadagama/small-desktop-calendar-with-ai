import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  describeScope,
  scopeLabels,
  seriesScopes,
  type SeriesScope,
} from "../shared/series-scope.js";
import type { MeetingDeletion } from "../shared/calendar-tools.js";
import { useAssistantPresentation } from "./AssistantPresentation";
import { events, notifySuccess } from "./notification-events.js";

export function MeetingDeletionCard({
  deletion,
}: {
  deletion: MeetingDeletion;
}) {
  const { disabled } = useAssistantPresentation();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<SeriesScope>(
    deletion.series?.scope ?? "occurrence",
  );
  const [deleted, setDeleted] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState("");
  const date = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const time = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    hour: "2-digit",
    minute: "2-digit",
  });
  async function confirm() {
    if (pending.current || deleted || disabled) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const reply = deletion.series
        ? await window.smallDesktop.series.apply({
            accountId: deletion.accountId,
            operation: "delete",
            ...deletion.series,
            beforeStart: deletion.startsAt,
            beforeEnd: deletion.endsAt,
            // The current radio selection is the user's confirmed scope.
            scope,
          })
        : await window.smallDesktop.calendar.applyChange({
            accountId: deletion.accountId,
            eventId: deletion.eventId,
            change: { kind: "cancel" },
          });
      if (reply.ok) {
        setDeleted(true);
        events.dispatchEvent(
          new CustomEvent("assistant-meeting-deleted", { detail: deletion }),
        );
        notifySuccess(
          deletion.series && scope === "following"
            ? "Это и последующие встречи удалены"
            : "Событие успешно удалено",
        );
      } else {
        setUnknown(reply.unknownOutcome === true);
        setError(reply.error);
      }
    } catch {
      setUnknown(true);
      setError(
        "Связь прервана. Проверьте результат удаления перед дальнейшими действиями.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section aria-label="Удаление встречи" className="assistant-meeting">
      <div className="assistant-meeting-card">
        <header>
          <Trash2 size={17} aria-hidden="true" />
          {deleted
            ? "Удаление подтверждено"
            : deletion.series
              ? "Удаление повторяющейся встречи"
              : "Удаление встречи"}
        </header>
        <p>
          <strong>{deletion.title}</strong>
        </p>
        <p>
          {date.format(new Date(deletion.startsAt))},{" "}
          {time.format(new Date(deletion.startsAt))}–
          {time.format(new Date(deletion.endsAt))} · Asia/Almaty
        </p>
        {deletion.series && !deleted && (
          <fieldset
            className="series-scope-options"
            disabled={disabled || busy || unknown}
          >
            <legend>Область удаления</legend>
            {seriesScopes.map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name={`deletion-scope-${deletion.eventId}`}
                  checked={scope === value}
                  onChange={() => setScope(value)}
                />
                {scopeLabels[value]}
              </label>
            ))}
          </fieldset>
        )}
        {deletion.series && (
          <p>{describeScope(scope, deletion.series.originalDate)}</p>
        )}
        {!deleted && (
          <button
            type="button"
            className="assistant-meeting-create"
            disabled={disabled || busy}
            onClick={() => void confirm()}
          >
            {busy
              ? "Проверяю…"
              : unknown
                ? "Проверить удаление"
                : deletion.series && scope === "following"
                  ? "Удалить это и последующие"
                  : "Удалить встречу"}
          </button>
        )}
        {deleted && (
          <p role="status">
            {deletion.series && scope === "following"
              ? "Это и последующие встречи удалены"
              : "Событие успешно удалено"}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </section>
  );
}
