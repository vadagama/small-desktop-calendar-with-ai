import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
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
      const reply = await window.smallDesktop.calendar.applyChange({
        accountId: deletion.accountId,
        eventId: deletion.eventId,
        change: { kind: "cancel" },
      });
      if (reply.ok) {
        setDeleted(true);
        events.dispatchEvent(
          new CustomEvent("assistant-meeting-deleted", { detail: deletion }),
        );
        notifySuccess("Событие успешно удалено");
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
          {deleted ? "Встреча удалена" : "Удаление встречи"}
        </header>
        <p>
          <strong>{deletion.title}</strong>
        </p>
        <p>
          {date.format(new Date(deletion.startsAt))},{" "}
          {time.format(new Date(deletion.startsAt))}–
          {time.format(new Date(deletion.endsAt))} · Asia/Almaty
        </p>
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
                : "Удалить встречу"}
          </button>
        )}
        {deleted && <p role="status">Событие успешно удалено</p>}
        {error && <p role="alert">{error}</p>}
      </div>
    </section>
  );
}
