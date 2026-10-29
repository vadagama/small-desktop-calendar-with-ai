import { useEffect, useState } from "react";
import type {
  MeetingReply,
  MeetingView,
} from "../shared/meeting-operations.js";
import type { MeetingDraft } from "../shared/meeting-draft.js";
const dateTime = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
export function MeetingDraftCard({ draft: initial }: { draft: MeetingDraft }) {
  const [view, setView] = useState<MeetingView>({
    draft: initial,
    phase: "preview",
    message: "",
  });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(initial.title);
  const [agenda, setAgenda] = useState(initial.agenda);
  const draft = view.draft;
  const reference = { id: draft.id, revision: draft.revision };
  const accept = (reply: MeetingReply) => {
    if (reply.ok) {
      setView(reply.data);
      setTitle(reply.data.draft.title);
      setAgenda(reply.data.draft.agenda);
    } else setError(reply.error);
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
  const act = async (action: "read" | "edit" | "confirm" | "reconcile") => {
    setBusy(true);
    setError("");
    try {
      const reply =
        action === "edit"
          ? await window.smallDesktop.meetings.edit({
              ...reference,
              title,
              agenda,
            })
          : await window.smallDesktop.meetings[action](reference);
      accept(reply);
      if (reply.ok) setEditing(false);
    } catch {
      setError(
        "Связь прервана. Проверьте состояние перед дальнейшими действиями.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Черновик встречи">
      <strong>{draft.title}</strong>
      <p>
        {dateTime(draft.startsAt)} — {dateTime(draft.endsAt)} ·{" "}
        {draft.durationMinutes} мин · {draft.timezone}
      </p>
      <p>Организатор: {draft.organizer.name}</p>
      <p>Участники: {draft.participantIds.join(", ")}</p>
      <p>Разовая · личный календарь</p>
      <p>Адженда: {draft.agenda || "Не указана"}</p>
      <p>Место: {draft.location || "Не указано"}</p>
      {draft.conferenceUrl ? (
        <p>
          Ссылка:{" "}
          <span className="meeting-draft-url">{draft.conferenceUrl}</span>
        </p>
      ) : (
        <p>Без видеоконференции</p>
      )}
      <p>
        Занятость участников проверена {dateTime(draft.availabilityCheckedAt)}.
        Перед созданием занятость и похожие события проверяются повторно.
        Помещение не проверяется.
      </p>
      {view.phase === "preview" && (
        <p>
          Встреча не создана. Проверьте все параметры перед отправкой
          приглашений.
        </p>
      )}
      <p role="status">{busy ? "Проверяю состояние…" : view.message}</p>
      {error && <p role="alert">{error}</p>}
      {editing ? (
        <form
          className="meeting-draft-edit"
          onSubmit={(event) => {
            event.preventDefault();
            void act("edit");
          }}
        >
          <label>
            Название встречи
            <input
              required
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            Адженда
            <textarea
              maxLength={5000}
              value={agenda}
              onChange={(event) => setAgenda(event.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            Сохранить изменения
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setTitle(draft.title);
              setAgenda(draft.agenda);
            }}
          >
            Отмена
          </button>
        </form>
      ) : (
        <div className="meeting-draft-actions">
          {view.phase === "preview" && (
            <>
              <button
                type="button"
                disabled={busy || !!error}
                onClick={() => setEditing(true)}
              >
                Изменить черновик
              </button>
              <button
                type="button"
                disabled={busy || !!error}
                onClick={() => void act("confirm")}
              >
                Создать встречу и отправить приглашения
              </button>
            </>
          )}
          {view.phase === "unknown" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act("reconcile")}
            >
              Проверить результат
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void act("read")}
          >
            Обновить состояние
          </button>
        </div>
      )}
    </section>
  );
}
