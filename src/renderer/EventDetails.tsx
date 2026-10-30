import { EventAgenda } from "./EventAgenda.js";
import { meetingLink } from "../shared/meeting-link.js";
import { notifySuccess, notifyError } from "./notification-events.js";
import { EventChangeForm } from "./EventChangeForm.js";
import {
  SeriesScopeDialog,
  type SeriesDialogOperation,
} from "./SeriesScopeDialog.js";
import { useEffect, useRef, useState } from "react";
import {
  X,
  MoreVertical,
  Users,
  User,
  DoorOpen,
  Repeat2,
  Copy,
  Link as LinkIcon,
  Pencil,
  Trash2,
  CalendarClock,
  CalendarPlus,
  Check,
  HelpCircle,
} from "lucide-react";
import { EventAttachments } from "./EventAttachments.js";
import { recurrenceSummary } from "../shared/recurrence-summary.js";
import type {
  SmallCalendar,
  CalendarEvent,
  EventLookup,
} from "../shared/calendar.js";
import {
  seriesInvalidation,
  type EventInvalidation,
} from "../shared/calendar-invalidation.js";
import {
  calendarDateAt,
  calendarToday,
  calendarTimeZone,
} from "../shared/calendar-time.js";

export function EventDetails({
  accountId,
  lookup,
  close,
  expired,
  createWithPeople,
  changed,
  remote = null,
  acknowledgeRemote,
}: {
  accountId: string;
  lookup: EventLookup;
  close: () => void;
  expired: () => void;
  changed?: (write: EventInvalidation, removed?: boolean) => void;
  /** What happened to this event on the server while the card was open. */
  remote?: "changed" | "missing" | null;
  acknowledgeRemote?: () => void;
  createWithPeople?: (event: CalendarEvent) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const menuPopup = useRef<HTMLDivElement>(null);
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [error, setError] = useState("");
  // Small answered "not found": the event is gone and nothing can be changed.
  const [gone, setGone] = useState(false);
  const [responding, setResponding] = useState(false);
  const [response, setResponse] = useState<"accepted" | "declined" | null>(
    null,
  );
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const [allPeople, setAllPeople] = useState(false);
  const [allInformed, setAllInformed] = useState(false);
  const [calendars, setCalendars] = useState<SmallCalendar[]>([]);
  const [editing, setEditing] = useState<"rename" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [seriesOperation, setSeriesOperation] =
    useState<SeriesDialogOperation | null>(null);
  const deletePending = useRef(false);
  function positionMenu() {
    const popup = menuPopup.current;
    const trigger = menu.current?.querySelector("summary");
    if (!menu.current?.open || !popup?.matches(":popover-open") || !trigger)
      return;
    const anchor = trigger.getBoundingClientRect();
    const rect = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - rect.width - 8))}px`;
    const below = anchor.bottom + 8;
    const top =
      below + rect.height <= window.innerHeight - 8
        ? below
        : anchor.top - rect.height - 8;
    popup.style.top = `${Math.max(8, top)}px`;
  }
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    const dismiss = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node))
        menu.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    const observer = new ResizeObserver(positionMenu);
    if (dialog.current) observer.observe(dialog.current);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
      observer.disconnect();
      before?.focus();
    };
  }, []);
  useEffect(() => {
    let active = true;
    // A reload keeps what is on screen, so a form being filled in is not discarded.
    setError("");
    void window.smallDesktop.calendar
      .detail({ accountId, lookup })
      .then((reply) => {
        if (!active) return;
        if (reply.ok) {
          setEvent(reply.data);
          setGone(false);
        } else {
          setError(reply.error);
          if (reply.kind === "not-found") setGone(true);
          if (reply.kind === "auth") expired();
        }
      })
      .catch(() => {
        if (active) setError("Не удалось прочитать карточку Small.");
      });
    return () => {
      active = false;
    };
  }, [accountId, lookup, retry, expired]);
  useEffect(() => {
    if (!event?.calendarIds.length) return;
    let active = true;
    void window.smallDesktop.calendar
      .calendars({ accountId })
      .then((reply) => {
        if (!active) return;
        if (reply.ok) setCalendars(reply.data);
        else if (reply.kind === "auth") expired();
      })
      .catch(() => {
        /* Only confirmed room names are shown. */
      });
    return () => {
      active = false;
    };
  }, [accountId, event, expired]);
  const rooms = calendars.filter((calendar) =>
    event?.calendarIds.includes(calendar.id),
  );
  const informed = event?.notificationRecipients ?? [];
  const date = (value: string) =>
    new Intl.DateTimeFormat("ru", {
      timeZone: calendarTimeZone,
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(new Date(value));
  const time = (value: string) =>
    new Intl.DateTimeFormat("ru", {
      timeZone: calendarTimeZone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  async function copy(value: string) {
    try {
      const reply = await window.smallDesktop.calendar.copyLink(value);
      if (!reply.ok) throw new Error(reply.error);
      setNotice("Ссылка скопирована");
    } catch {
      setNotice(
        "Не удалось скопировать ссылку. Выделите её и скопируйте вручную.",
      );
    }
    menu.current?.removeAttribute("open");
  }
  async function respond(status: "accepted" | "declined") {
    if (!event || !("id" in event.lookup) || responding || gone) return;
    setResponding(true);
    setNotice("");
    try {
      const reply = await window.smallDesktop.calendar.respond({
        accountId,
        eventId: event.lookup.id,
        status,
      });
      if (reply.ok) {
        setResponse(status);
        notifySuccess("Ответ на приглашение сохранён");
        changed?.({ eventIds: [event.lookup.id], windows: [] }, true);
      } else {
        notifyError("сохранить ответ", reply.kind);
        if (reply.kind === "auth") expired();
      }
    } catch {
      notifyError("сохранить ответ");
    } finally {
      setResponding(false);
    }
  }
  async function deleteEvent() {
    if (!event || !("id" in event.lookup) || deletePending.current || gone)
      return;
    deletePending.current = true;
    setDeleting(true);
    setNotice("");
    menu.current!.open = false;
    try {
      const reply = await window.smallDesktop.calendar.applyChange({
        accountId,
        eventId: event.lookup.id,
        change: { kind: "cancel" },
      });
      if (reply.ok) {
        notifySuccess("Событие успешно удалено");
        changed?.({ eventIds: [event.lookup.id], windows: [] }, true);
        close();
      } else {
        notifyError("удалить событие", reply.kind);
        if (reply.kind === "auth") expired();
      }
    } catch {
      notifyError("удалить событие");
    } finally {
      deletePending.current = false;
      setDeleting(false);
    }
  }
  const people = event?.participants ?? [];
  const participants = people.length
    ? people
    : event?.organizer
      ? [
          {
            id: "organizer",
            name: event.organizer,
            status: "unknown",
            organizer: true,
          },
        ]
      : [];
  const link = event
    ? (meetingLink(event.location) ?? meetingLink(event.description))
    : undefined;
  const onlyLink = (text: string) => {
    const trimmed = text.trim();
    return Boolean(
      link && meetingLink(trimmed) === link && !/\s/.test(trimmed),
    );
  };
  const eventLink = event
    ? `https://team.small.kz/calendar#${"id" in event.lookup ? `event-${event.lookup.id}-${calendarDateAt(event.startsAt)}` : `event-orig-${event.lookup.originalEventId}-${event.lookup.date}`}`
    : "";
  return (
    <dialog
      ref={dialog}
      className="modal small-event-details"
      aria-labelledby="event-details-title"
      onCancel={(e) => {
        if (menu.current?.open) {
          e.preventDefault();
          menu.current.open = false;
        } else close();
      }}
      onClose={close}
    >
      <div className="modal-header">
        <h2 id="event-details-title">{event?.title ?? "Событие Small"}</h2>
        <div className="event-header-actions">
          {event && (
            <details
              ref={menu}
              className="event-actions-menu"
              onToggle={() => {
                const popup = menuPopup.current;
                const trigger = menu.current?.querySelector("summary");
                if (!popup || !trigger) return;
                if (!menu.current?.open) {
                  popup.hidePopover();
                  return;
                }
                popup.showPopover();
                positionMenu();
              }}
            >
              <summary
                className="icon-button"
                aria-label="Действия со встречей"
              >
                <MoreVertical size={22} />
              </summary>
              <div
                ref={menuPopup}
                popover="manual"
                className="event-menu-items"
              >
                {event.participation === "organizer" &&
                  calendarDateAt(event.startsAt) >= calendarToday() && (
                    <button
                      disabled={gone}
                      onClick={() => {
                        if (event.recurring === true)
                          setSeriesOperation("rename");
                        else setEditing("rename");
                        menu.current!.open = false;
                      }}
                    >
                      <Pencil size={18} />
                      Редактировать
                    </button>
                  )}
                {event.recurring === true &&
                  event.participation === "organizer" &&
                  calendarDateAt(event.startsAt) >= calendarToday() && (
                    <button
                      onClick={() => {
                        setSeriesOperation("move");
                        menu.current!.open = false;
                      }}
                    >
                      <CalendarClock size={18} />
                      Перенести
                    </button>
                  )}
                {createWithPeople && (
                  <button
                    disabled={!people.length}
                    onClick={() => createWithPeople(event)}
                  >
                    <CalendarPlus size={18} />
                    Новая встреча с этими участниками
                  </button>
                )}
                <button onClick={() => void copy(eventLink)}>
                  <Copy size={18} />
                  Скопировать ссылку на встречу
                </button>
                {event.participation === "organizer" &&
                  calendarDateAt(event.startsAt) >= calendarToday() && (
                    <button
                      className="danger-text"
                      disabled={deleting || gone}
                      onClick={() => {
                        if (event.recurring === true) {
                          setSeriesOperation("delete");
                          menu.current!.open = false;
                        } else void deleteEvent();
                      }}
                    >
                      <Trash2 size={18} />
                      Удалить
                    </button>
                  )}
              </div>
            </details>
          )}
          <button
            className="icon-button event-close"
            aria-label="Закрыть событие"
            onClick={close}
          >
            <X size={24} />
          </button>
        </div>
      </div>
      {!event && !error && <p role="status">Загружаю карточку Small…</p>}
      {(gone || remote) && (
        <div className="event-remote-change" role="status">
          <p>
            {gone
              ? "Событие удалено или отменено на сервере. Изменить его больше нельзя."
              : remote === "missing"
                ? "Событие больше не показано в этом периоде: его могли удалить, отменить или перенести. Обновите карточку, чтобы проверить."
                : "Событие изменилось на сервере. Показанные данные и ваши правки могут быть устаревшими."}
          </p>
          {!gone && (
            <button
              className="secondary"
              onClick={() => {
                setRetry((value) => value + 1);
                acknowledgeRemote?.();
              }}
            >
              Обновить карточку
            </button>
          )}
        </div>
      )}
      {error && !gone && (
        <>
          <p className="form-error" role="alert">
            {error}
          </p>
          <button className="secondary" onClick={() => setRetry((v) => v + 1)}>
            Повторить чтение
          </button>
        </>
      )}
      {event && (
        <div className="event-card-body">
          {event.description && !onlyLink(event.description) && (
            <EventAgenda
              key={event.key + event.description}
              text={event.description}
            />
          )}
          <p className="event-card-date">
            {date(event.startsAt)} · {time(event.startsAt)} –{" "}
            {calendarDateAt(event.startsAt) !== calendarDateAt(event.endsAt)
              ? `${date(event.endsAt)} · `
              : ""}
            {time(event.endsAt)}
          </p>
          <section className="event-people-card" aria-label="Участники">
            <div className="event-section-label">
              <Users size={20} />
              Участники
            </div>
            <ul>
              {(allPeople ? participants : participants.slice(0, 5)).map(
                (p) => (
                  <li key={p.id}>
                    <span
                      className="event-avatar"
                      aria-label={
                        p.status === "accepted"
                          ? "Принял приглашение"
                          : p.status === "declined"
                            ? "Отклонил приглашение"
                            : "Ожидается ответ"
                      }
                    >
                      {(p.name || "?")
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((n) => n[0])
                        .join("")
                        .toUpperCase()}
                      {p.status === "accepted" ? (
                        <Check className="accepted" size={12} />
                      ) : p.status === "declined" ? (
                        <X className="declined" size={12} />
                      ) : (
                        <HelpCircle size={12} />
                      )}
                    </span>
                    <span>
                      {p.name || "Участник без имени"}{" "}
                      {p.organizer && (
                        <span className="event-author">Автор</span>
                      )}
                    </span>
                  </li>
                ),
              )}
            </ul>
            {!participants.length && <p>Список участников недоступен</p>}
            {participants.length > 5 && (
              <button
                className="event-show-all"
                aria-expanded={allPeople}
                onClick={() => setAllPeople((v) => !v)}
              >
                {allPeople
                  ? "Свернуть"
                  : `Показать всех (${participants.length})`}
              </button>
            )}
          </section>
          {informed.length > 0 && (
            <section className="event-people-card" aria-label="Информировать">
              <div className="event-section-label">
                <User size={20} />
                Информировать
              </div>
              <ul>
                {(allInformed ? informed : informed.slice(0, 5)).map(
                  (person) => (
                    <li key={person.id}>
                      <span className="event-avatar" aria-hidden="true">
                        {(person.name || "?")
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((n) => n[0])
                          .join("")
                          .toUpperCase()}
                      </span>
                      <span>{person.name || "Сотрудник без имени"}</span>
                    </li>
                  ),
                )}
              </ul>
              {informed.length > 5 && (
                <button
                  className="event-show-all"
                  aria-expanded={allInformed}
                  onClick={() => setAllInformed((v) => !v)}
                >
                  {allInformed
                    ? "Свернуть"
                    : `Показать всех (${informed.length})`}
                </button>
              )}
            </section>
          )}
          {rooms.length > 0 && (
            <section className="event-metadata-card" aria-label="Переговорные">
              <div className="event-section-label">
                <DoorOpen size={20} />
                Переговорные
              </div>
              <p>{rooms.map((room) => room.name).join(", ")}</p>
            </section>
          )}
          {event.recurring === true && (
            <section className="event-metadata-card" aria-label="Повторяется">
              <div className="event-section-label">
                <Repeat2 size={20} />
                Повторяется
              </div>
              <p>{recurrenceSummary(event.recurrenceRule)}</p>
            </section>
          )}
          {link && (
            <div className="event-link-card">
              <LinkIcon size={20} />
              <a
                className="event-link-text"
                href={link}
                onClick={(e) => {
                  e.preventDefault();
                  void window.smallDesktop.calendar
                    .openLink(link)
                    .then((reply) => {
                      if (!reply.ok) setNotice(reply.error);
                    })
                    .catch(() => setNotice("Не удалось открыть ссылку."));
                }}
              >
                {link}
              </a>
              <button
                className="icon-button"
                aria-label="Скопировать ссылку подключения"
                onClick={() => void copy(link)}
              >
                <Copy size={20} />
              </button>
            </div>
          )}
          {!!event.attachments?.length && (
            <EventAttachments files={event.attachments} notice={setNotice} />
          )}
          {event.location && !onlyLink(event.location) && (
            <p className="event-card-location">{event.location}</p>
          )}

          {notice && <p role="status">{notice}</p>}
          {editing && (
            <EventChangeForm
              key={`${accountId}:${event.key}:${editing}`}
              accountId={accountId}
              event={event}
              expired={expired}
              locked={gone}
              saved={() => {
                setEditing(null);
                setRetry((value) => value + 1);
                if ("id" in event.lookup)
                  changed?.({ eventIds: [event.lookup.id], windows: [] }, true);
              }}
            />
          )}
        </div>
      )}
      {event && seriesOperation && (
        <SeriesScopeDialog
          key={`${event.key}:${seriesOperation}`}
          accountId={accountId}
          event={event}
          operation={seriesOperation}
          expired={expired}
          close={() => setSeriesOperation(null)}
          done={() => {
            const removed = seriesOperation === "delete";
            setSeriesOperation(null);
            changed?.(seriesInvalidation(event));
            if (removed) close();
            else setRetry((value) => value + 1);
          }}
        />
      )}
      {event && event.participation === "invited" && "id" in event.lookup && (
        <footer className="event-rsvp">
          <span>Придёте?</span>
          <div>
            <button
              disabled={responding || gone}
              aria-pressed={
                response === "accepted" || (!response && event.accepted)
              }
              onClick={() => void respond("accepted")}
            >
              Да
            </button>
            <button
              disabled={responding || gone}
              aria-pressed={response === "declined"}
              onClick={() => void respond("declined")}
            >
              Нет
            </button>
          </div>
        </footer>
      )}
    </dialog>
  );
}
