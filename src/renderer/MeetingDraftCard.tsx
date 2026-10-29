import type { MeetingDraft } from "../shared/meeting-draft.js";
const dateTime = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
export function MeetingDraftCard({ draft }: { draft: MeetingDraft }) {
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
        Помещение и дубликаты не проверены.
      </p>
      <p>
        Только черновик. Встреча не создана, приглашения не отправлены. Создание
        из приложения пока недоступно.
      </p>
    </section>
  );
}
