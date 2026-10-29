import {
  TemplateMarkdown,
  useAssistantPresentation,
} from "./AssistantPresentation";
import { CalendarPlus, CheckCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { events } from "./notification-events.js";
import type {
  MeetingReply,
  MeetingView,
} from "../shared/meeting-operations.js";
import type { MeetingDraft } from "../shared/meeting-draft.js";

const date = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
const time = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export function MeetingDraftCard({ draft: initial }: { draft: MeetingDraft }) {
  const presentation = useAssistantPresentation();
  const [view, setView] = useState<MeetingView>({
    draft: initial,
    phase: "preview",
    message: "",
  });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const draft = view.draft;
  const participants =
    draft.participants?.map((p) => p.name).join(", ") ??
    draft.participantIds.join(", ");
  const interval = `${date(draft.startsAt)}, ${time(draft.startsAt)}–${date(draft.startsAt) === date(draft.endsAt) ? "" : `${date(draft.endsAt)}, `}${time(draft.endsAt)}`;
  const accept = (reply: MeetingReply) => {
    if (reply.ok) setView(reply.data);
    else setError(reply.error);
  };
  useEffect(() => {
    let active = true;
    void window.smallDesktop.meetings
      .read({ id: initial.id, revision: initial.revision })
      .then((reply) => {
        if (active) {
          accept(reply);
          setBusy(false);
        }
      })
      .catch(() => {
        if (active) {
          setError("Не удалось проверить черновик.");
          setBusy(false);
        }
      });
    return () => {
      active = false;
    };
  }, [initial.id, initial.revision]);
  const act = async (action: "read" | "confirm" | "reconcile") => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const reply = await window.smallDesktop.meetings[action]({
        id: draft.id,
        revision: draft.revision,
      });
      accept(reply);
      if (reply.ok && reply.data.phase === "succeeded") {
        events.dispatchEvent(
          new CustomEvent("assistant-meeting-created", { detail: reply.data }),
        );
      }
    } catch {
      setError(
        "Связь прервана. Проверьте состояние перед дальнейшими действиями.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Черновик встречи" className="assistant-meeting">
      <div className="assistant-meeting-card">
        <header>
          <CalendarPlus size={17} aria-hidden="true" />
          {view.phase === "succeeded" ? "Встреча создана" : "Черновик встречи"}
        </header>
        <TemplateMarkdown
          name="draft"
          values={{
            title: draft.title,
            time: interval,
            duration: String(draft.durationMinutes),
            organizer: draft.organizer.name,
            participants,
            location:
              draft.location || (draft.conferenceUrl ? "Онлайн" : "Не указано"),
            agenda: draft.agenda || "",
          }}
        />
        {draft.conferenceUrl && (
          <p className="meeting-draft-url">
            Ссылка на конференцию
            <br />
            {draft.conferenceUrl}
          </p>
        )}
        {view.phase === "preview" && !error && !view.message && (
          <p className="assistant-meeting-checked">
            <CheckCheck size={16} aria-hidden="true" />
            Нет пересечений у участников
          </p>
        )}
        {view.phase !== "succeeded" && !!view.message && (
          <p role="status">{view.message}</p>
        )}
        {error && <p role="alert">{error}</p>}
        {view.phase !== "succeeded" && (
          <button
            className="assistant-meeting-create"
            type="button"
            disabled={busy || !!error || view.phase !== "preview"}
            onClick={() => void act("confirm")}
          >
            {busy ? "Проверяю…" : "Создать встречу"}
          </button>
        )}
        {(view.phase === "unknown" || view.phase === "blocked") && (
          <button
            type="button"
            disabled={busy || presentation.disabled}
            onClick={() =>
              presentation.choose(
                "Подбери другое свободное время для этой встречи с теми же участниками и длительностью. Предыдущую отправку не повторяй.",
              )
            }
          >
            Выбрать другое время
          </button>
        )}
        {(view.phase === "unknown" || !!error) && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void act(view.phase === "unknown" ? "reconcile" : "read")
            }
          >
            Проверить результат
          </button>
        )}
      </div>
      {view.phase === "succeeded" && (
        <p role="status" className="assistant-meeting-confirmation">
          Встреча создана: <strong>«{draft.title}»</strong>. {interval}{" "}
          (Asia/Almaty). Участники: {participants}.{" "}
          {draft.conferenceUrl ? "Онлайн-конференция." : draft.location}
        </p>
      )}
    </section>
  );
}
