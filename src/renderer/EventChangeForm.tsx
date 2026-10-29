import { notifySuccess, notifyError } from "./notification-events.js";
import { useRef, useState } from "react";
import type { CalendarEvent } from "../shared/calendar.js";

export function EventChangeForm({
  accountId,
  event,
  expired,
  saved,
  locked,
}: {
  accountId: string;
  event: CalendarEvent;
  expired: () => void;
  saved: () => void;
  /** The event is gone from Small: nothing can be saved any more. */
  locked: boolean;
}) {
  const [title, setTitle] = useState(event.title);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  if (!("id" in event.lookup)) return <p>Изменение серий пока недоступно.</p>;
  return (
    <form
      className="meeting-form event-change"
      aria-label="Редактирование встречи"
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending.current || !("id" in event.lookup)) return;
        pending.current = true;
        setBusy(true);
        try {
          const reply = await window.smallDesktop.calendar.applyChange({
            accountId,
            eventId: event.lookup.id,
            change: { kind: "rename", title },
          });
          if (reply.ok) {
            notifySuccess("Изменения сохранены");
            saved();
          } else {
            notifyError("сохранить изменения", reply.kind);
            if (reply.kind === "auth") expired();
          }
        } catch {
          notifyError("сохранить изменения");
        } finally {
          pending.current = false;
          setBusy(false);
        }
      }}
    >
      <label>
        Новое название
        <input
          value={title}
          maxLength={200}
          required
          disabled={busy || locked}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <button
        className="primary"
        disabled={
          busy || locked || !title.trim() || title.trim() === event.title
        }
      >
        {busy ? "Сохраняю…" : "Сохранить"}
      </button>
    </form>
  );
}
