import { useState } from "react";
import { Search, X } from "lucide-react";
import type { useAvailability } from "./useAvailability";
export function MeetingPeoplePicker({
  data,
  label,
}: {
  data: ReturnType<typeof useAvailability>;
  label: string;
}) {
  const [query, setQuery] = useState("");
  return (
    <div className="meeting-people-picker">
      <div className="meeting-people-input">
        <div className="meeting-chips">
          {data.selected.map((p) => (
            <span key={p.participantId}>
              {p.name}
              <button
                type="button"
                aria-label={`Убрать ${p.name}`}
                onClick={() => data.toggle(p)}
              >
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
        <div className="meeting-people-search">
          <input
            aria-label={`Поиск ${label}`}
            placeholder="Имя сотрудника"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              data.resetSearch();
            }}
          />
          <button
            type="button"
            className="secondary"
            aria-label={
              label === "участников"
                ? "Найти сотрудников"
                : "Найти информируемых"
            }
            disabled={!query.trim() || data.searching}
            onClick={() => void data.search(query)}
          >
            <Search size={16} />
          </button>
        </div>
      </div>
      {data.searching && <p role="status">Ищу сотрудников…</p>}
      {data.searchError && (
        <p role="alert" className="form-error">
          {data.searchError}
        </p>
      )}
      {data.people && (
        <div className="meeting-people-results">
          {!data.people.people.length && <p>Не найдено</p>}
          {data.people.people.map((p) => (
            <label key={p.participantId}>
              <input
                type="checkbox"
                checked={data.selected.some(
                  (s) => s.participantId === p.participantId,
                )}
                disabled={
                  data.selected.length >= 20 &&
                  !data.selected.some(
                    (s) => s.participantId === p.participantId,
                  )
                }
                onChange={() => data.toggle(p)}
              />
              <span>
                {p.name}
                <small>{p.position}</small>
              </span>
            </label>
          ))}
          {data.people.nextPage && (
            <button
              type="button"
              className="secondary"
              onClick={() => void data.search(query, data.people!.nextPage!)}
            >
              Следующая страница
            </button>
          )}
        </div>
      )}
    </div>
  );
}
