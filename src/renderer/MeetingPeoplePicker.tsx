import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, Search, X } from "lucide-react";
import type { useAvailability } from "./useAvailability";

export function MeetingPeoplePicker({
  data,
  label,
  overlayRoot,
  disabled,
}: {
  data: ReturnType<typeof useAvailability>;
  label: string;
  overlayRoot?: HTMLDivElement | null;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [waitingToSearch, setWaitingToSearch] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);
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
      const target = event.target as Node;
      if (!root.current?.contains(target) && !results.current?.contains(target))
        setOpen(false);
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
  const searching = waitingToSearch || data.searching;
  const visible =
    !disabled && open && (searching || !!data.people || !!data.searchError);
  const [position, setPosition] = useState<{
    left: number;
    bottom: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  useLayoutEffect(() => {
    const anchor = field.current;
    const dialog = overlayRoot?.parentElement;
    if (!visible || !anchor || !dialog) return;
    const scroller = anchor.closest(".new-meeting-body");
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      const boundary = dialog.getBoundingClientRect();
      const viewport = scroller?.getBoundingClientRect() ?? boundary;
      const next =
        rect.bottom <= viewport.top || rect.top >= viewport.bottom
          ? null
          : {
              left: rect.left,
              bottom: window.innerHeight - rect.top + 4,
              width: rect.width,
              maxHeight: Math.max(
                0,
                Math.min(232, rect.top - boundary.top - 12),
              ),
            };
      setPosition((previous) =>
        previous?.left === next?.left &&
        previous?.bottom === next?.bottom &&
        previous?.width === next?.width &&
        previous?.maxHeight === next?.maxHeight
          ? previous
          : next,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    observer.observe(dialog);
    document.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [overlayRoot, visible]);
  const panelVisible =
    visible && (!overlayRoot || (position && position.maxHeight > 0));
  const candidates =
    data.people?.people.filter(
      (person) =>
        !data.selected.some(
          (selected) => selected.participantId === person.participantId,
        ),
    ) ?? [];
  function select(person: (typeof data.selected)[number]) {
    clearTimeout(timer.current);
    setWaitingToSearch(false);
    data.toggle(person);
    setQuery("");
    data.resetSearch();
    input.current?.focus();
    setOpen(false);
  }
  function searchNow() {
    clearTimeout(timer.current);
    setWaitingToSearch(false);
    if (query.trim() && !data.searching) {
      setOpen(true);
      void data.search(query.trim());
    }
  }
  const resultsPanel = panelVisible && (
    <div
      ref={results}
      id={resultsId}
      className="meeting-people-results"
      data-side={overlayRoot ? "top" : undefined}
      style={overlayRoot ? (position ?? undefined) : undefined}
      role="group"
      aria-label={`Результаты поиска ${label}`}
      onKeyDownCapture={(event) => {
        if (overlayRoot && event.key === "Tab") {
          event.stopPropagation();
          input.current?.focus();
          setOpen(false);
        }
      }}
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
      {data.people && !candidates.length && !searching && !data.searchError && (
        <p className="meeting-people-status" role="status">
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
          disabled={data.selected.length >= data.selectionLimit}
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
      {searching && (
        <p className="meeting-people-status" role="status">
          Загрузка
          <LoaderCircle className="loading-icon" aria-hidden="true" />
        </p>
      )}
      {data.searchError && (
        <p className="meeting-people-status" role="alert">
          {data.searchError}
        </p>
      )}
      {data.people?.nextPage && (
        <button
          type="button"
          className="secondary"
          aria-disabled={searching}
          onClick={() => {
            const nextPage = data.people?.nextPage;
            if (!searching && nextPage)
              void data.search(query.trim(), nextPage);
          }}
        >
          Следующая страница
        </button>
      )}
    </div>
  );
  return (
    <div
      className="meeting-people-picker"
      ref={root}
      onBlur={(event) => {
        if (
          !pointerInput.current &&
          !event.currentTarget.contains(event.relatedTarget as Node | null) &&
          !results.current?.contains(event.relatedTarget as Node | null)
        )
          setOpen(false);
      }}
    >
      <div className="meeting-people-input" ref={field}>
        <div className="meeting-chips">
          {data.selected.map((p) => (
            <span key={p.participantId}>
              <span className="meeting-chip-name" title={p.name}>
                {p.name}
              </span>
              {!data.protectedIds.includes(p.participantId) && (
                <button
                  type="button"
                  aria-label={`Убрать ${p.name}`}
                  onClick={() => {
                    if (visible) input.current?.focus({ preventScroll: true });
                    data.toggle(p);
                  }}
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
            aria-expanded={!!panelVisible}
            aria-controls={panelVisible ? resultsId : undefined}
            autoComplete="off"
            maxLength={200}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                searchNow();
              } else if (event.key === "Escape" && visible) {
                event.preventDefault();
                event.stopPropagation();
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
              const term = value.trim();
              setWaitingToSearch(!!term);
              if (term)
                timer.current = setTimeout(() => {
                  setWaitingToSearch(false);
                  void data.search(term);
                }, 300);
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
            aria-busy={searching}
            onClick={searchNow}
          >
            <Search size={16} />
          </button>
        </div>
      </div>
      {overlayRoot ? createPortal(resultsPanel, overlayRoot) : resultsPanel}
      {data.selected.length >= data.selectionLimit && (
        <p role="status">
          Можно выбрать не более {data.selectionLimit} сотрудников. Чтобы
          добавить другого, уберите одного из выбранных.
        </p>
      )}
    </div>
  );
}
