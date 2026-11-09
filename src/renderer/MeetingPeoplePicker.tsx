import { useEffect, useId, useRef, useState } from "react";
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
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pointerInput = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const resultsId = useId();
  useEffect(() => {
    const pointer = () => {
      pointerInput.current = true;
    };
    const keyboard = () => {
      pointerInput.current = false;
    };
    // Close after the click target is established: collapsing the results on
    // pointer blur moves a centred dialog before its close button receives click.
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", keyboard, true);
    document.addEventListener("click", outside, true);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", keyboard, true);
      document.removeEventListener("click", outside, true);
    };
  }, []);
  const candidates =
    data.people?.people.filter(
      (person) =>
        !data.selected.some(
          (selected) => selected.participantId === person.participantId,
        ),
    ) ?? [];
  function select(person: (typeof data.selected)[number]) {
    clearTimeout(timer.current);
    data.toggle(person);
    setQuery("");
    data.resetSearch();
    input.current?.focus();
    setOpen(false);
  }
  function searchNow() {
    clearTimeout(timer.current);
    if (query.trim() && !data.searching) {
      setOpen(true);
      void data.search(query.trim());
    }
  }
  return (
    <div
      className="meeting-people-picker"
      ref={root}
      onBlur={(event) => {
        if (
          !pointerInput.current &&
          !event.currentTarget.contains(event.relatedTarget as Node | null)
        )
          setOpen(false);
      }}
    >
      <div className="meeting-people-input">
        <div className="meeting-chips">
          {data.selected.map((p) => (
            <span key={p.participantId}>
              {p.name}
              {!data.protectedIds.includes(p.participantId) && (
                <button
                  type="button"
                  aria-label={`Убрать ${p.name}`}
                  onClick={() => data.toggle(p)}
                >
                  <X size={14} />
                </button>
              )}
            </span>
          ))}
        </div>
        <div className="meeting-people-search">
          <input
            ref={input}
            aria-label={`Поиск ${label}`}
            aria-expanded={open && !!data.people}
            aria-controls={resultsId}
            autoComplete="off"
            maxLength={200}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                searchNow();
              } else if (event.key === "Escape" && open) {
                event.preventDefault();
                event.stopPropagation();
                clearTimeout(timer.current);
                setOpen(false);
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setOpen(true);
                requestAnimationFrame(() =>
                  document
                    .getElementById(resultsId)
                    ?.querySelector<HTMLButtonElement>(
                      ".meeting-person-option:not(:disabled)",
                    )
                    ?.focus(),
                );
              }
            }}
            placeholder="Имя сотрудника"
            value={query}
            onChange={(e) => {
              const value = e.target.value;
              clearTimeout(timer.current);
              setQuery(value);
              setOpen(true);
              data.resetSearch();
              if (value.trim())
                timer.current = setTimeout(
                  () => void data.search(value.trim()),
                  300,
                );
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
            disabled={!query.trim()}
            aria-busy={data.searching}
            onClick={searchNow}
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
      {open && data.people && (
        <div
          id={resultsId}
          className="meeting-people-results"
          aria-label={`Результаты поиска ${label}`}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              input.current?.focus();
              setOpen(false);
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const choices = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  ".meeting-person-option:not(:disabled)",
                ),
              ];
              const index = choices.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next = index + (event.key === "ArrowDown" ? 1 : -1);
              if (next < 0) input.current?.focus();
              else choices[next]?.focus();
            }
          }}
        >
          {!candidates.length && (
            <p>
              {data.people.people.length
                ? "Все найденные сотрудники уже добавлены"
                : "Не найдено"}
            </p>
          )}
          {candidates.map((p) => (
            <button
              key={p.participantId}
              type="button"
              className="meeting-person-option"
              disabled={data.selected.length >= 20}
              onClick={() => select(p)}
            >
              <span className="meeting-person-avatar" aria-hidden="true">
                {p.name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join("")}
              </span>
              <span className="meeting-person-name">
                {p.name}
                <small>{p.position}</small>
              </span>
            </button>
          ))}
          {data.people.nextPage && (
            <button
              type="button"
              className="secondary"
              aria-disabled={data.searching}
              onClick={() => {
                if (!data.searching)
                  void data.search(query, data.people!.nextPage!);
              }}
            >
              Следующая страница
            </button>
          )}
        </div>
      )}
    </div>
  );
}
