import { useRef, useState } from "react";
import type { MeetingParticipants } from "../shared/calendar-tools.js";
import { useAssistantPresentation } from "./AssistantPresentation";
import { MeetingConflictDialog } from "./MeetingConflictDialog";
import { notifySuccess } from "./notification-events.js";

export function MeetingParticipantsCard({
  change,
}: {
  change: MeetingParticipants;
}) {
  const { disabled } = useAssistantPresentation();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [canceled, setCanceled] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState("");
  const [conflicts, setConflicts] = useState<string[] | null>(null);
  async function confirm(allowConflicts = false) {
    if (pending.current || disabled || done || canceled || unknown) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setConflicts(null);
    try {
      const { accountId, eventId, before, after } = change;
      const reply = await window.smallDesktop.calendar.updateEvent({
        accountId,
        eventId,
        before,
        after,
        ...(allowConflicts ? { allowConflicts: true } : {}),
      });
      if (reply.ok) {
        setDone(true);
        notifySuccess("Участники добавлены");
      } else {
        setUnknown(reply.unknownOutcome === true);
        setError(reply.error);
        if (!reply.unknownOutcome && reply.conflictingParticipantIds?.length)
          setConflicts(reply.conflictingParticipantIds);
      }
    } catch {
      setUnknown(true);
      setError(
        "Связь прервана. Проверьте состав встречи в календаре перед повторной попыткой.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section aria-label="Добавление участников" className="assistant-meeting">
      <div className="assistant-meeting-card">
        <header>Добавление участников</header>
        <p>
          <strong>{change.before.title}</strong>
        </p>
        <p>
          {new Intl.DateTimeFormat("ru-RU", {
            timeZone: "Asia/Almaty",
            dateStyle: "long",
            timeStyle: "short",
          }).format(new Date(change.before.starts_at))}{" "}
          · Asia/Almaty
        </p>
        <p>{change.people.map((person) => person.name).join(", ")}</p>
        <p>Текущие участники и параметры встречи сохранятся.</p>
        {!done && !canceled && (
          <>
            <button
              type="button"
              className="assistant-meeting-create"
              disabled={disabled || busy || unknown}
              onClick={() => void confirm()}
            >
              {busy ? "Сохраняю…" : "Добавить участников"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={disabled || busy}
              onClick={() => setCanceled(true)}
            >
              Отмена
            </button>
          </>
        )}
        {(done || canceled) && (
          <p role="status">
            {done ? "Участники добавлены" : "Добавление отменено"}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {conflicts && (
          <MeetingConflictDialog
            editing
            names={change.people
              .filter((p) => conflicts.includes(p.participantId))
              .map((p) => p.name)}
            cancel={() => setConflicts(null)}
            confirm={() => void confirm(true)}
          />
        )}
      </div>
    </section>
  );
}
