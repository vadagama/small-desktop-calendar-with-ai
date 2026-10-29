import { X } from "lucide-react";
import type { useAvailability } from "./useAvailability";

export function AvailabilityPeople({
  data,
  query,
}: {
  data: ReturnType<typeof useAvailability>;
  query: string;
}) {
  return (
    <>
      {data.people && (
        <section
          aria-label="Результаты поиска сотрудников"
          className="availability-section"
        >
          <h3>Результаты · страница {data.people.page}</h3>
          {!data.people.people.length && (
            <p role="status">По этому запросу сотрудники не найдены.</p>
          )}
          <div className="people-options">
            {data.people.people.map((person) => {
              const checked = data.selected.some(
                (p) => p.participantId === person.participantId,
              );
              return (
                <label key={person.participantId} className="person-option">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && data.selected.length >= 20}
                    onChange={() => data.toggle(person)}
                  />
                  <span>
                    {person.name}
                    <small>
                      {person.position || "Должность не указана"} ·{" "}
                      {person.participantId}
                    </small>
                  </span>
                </label>
              );
            })}
          </div>
          {data.people.nextPage !== null && (
            <button
              className="secondary"
              onClick={() => void data.search(query, data.people!.nextPage!)}
            >
              Следующая страница сотрудников
            </button>
          )}
        </section>
      )}
      <section
        className="availability-section"
        aria-label="Выбранные участники"
      >
        <h3>Участники · {data.selected.length} из 20</h3>
        {!data.selected.length ? (
          <p className="form-note">Выберите людей в результатах поиска.</p>
        ) : (
          <ul className="selected-people">
            {data.selected.map((person) => (
              <li key={person.participantId}>
                <span>
                  {person.name}
                  <small>{person.position || person.participantId}</small>
                </span>
                <button
                  className="icon-button"
                  aria-label={`Убрать ${person.name} ${person.participantId}`}
                  onClick={() => data.toggle(person)}
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
