import { Reminders } from "./Reminders";
import { Bell } from "lucide-react";
import { NewMeeting } from "./NewMeeting";
import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Settings2, UsersRound, Plus, Clock } from "lucide-react";
import { Calendar } from "../../prototype/src/CalendarView";
import type { Meeting } from "../../prototype/src/types";
import { DesktopAssistant } from "./Assistant";
import { DockWorkspace } from "./DockWorkspace";
import { Availability } from "./Availability";
import { SmallAccount } from "./SmallAccount";
import { CalendarFilters } from "./CalendarFilters";
import { EventDetails } from "./EventDetails";
import { useSmallCalendar } from "./useSmallCalendar";
import {
  calendarDateAt,
  calendarRange,
  calendarToday,
  splitEventDays,
} from "../shared/calendar-time.js";
import type { CalendarEvent, CalendarView } from "../shared/calendar.js";
import type { SmallAuthState } from "../shared/small-auth.js";

export function DesktopWorkspace() {
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [account, setAccount] = useState<SmallAuthState | null>(null);
  const [revision, setRevision] = useState(0);
  const [date, setDate] = useState(calendarToday);
  const [view, setView] = useState<CalendarView>("week");
  const [availabilityAccount, setAvailabilityAccount] = useState<string | null>(
    null,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<{
    accountId: string;
    event: CalendarEvent;
  } | null>(null);
  const accountId = account?.status === "signed-in" ? account.profile.id : null;
  useEffect(() => {
    setRemindersOpen(false);
    setCreating(false);
    setCreatedId(null);
    setSelected(null);
    setAvailabilityAccount(null);
  }, [accountId]);
  const expired = useCallback(() => {
    setAccount(null);
    setRevision((value) => value + 1);
  }, []);
  const calendar = useSmallCalendar(accountId, date, view, expired);
  const range = calendarRange(date, view);
  const byId = new Map<string, CalendarEvent>();
  const meetings: Meeting[] = calendar.events.flatMap((event) =>
    splitEventDays(event.startsAt, event.endsAt, range).map((part) => {
      const id = `${event.key}:${part.date}`;
      byId.set(id, event);
      return {
        ...part,
        id,
        title: event.title,
        organizer: event.organizer,
        participation: event.participation,
        accepted: event.accepted,
        agenda: event.description,
        calendar: calendar.my ? "personal" : "team",
        color: "green",
        people: [],
        location: event.location,
      };
    }),
  );
  const revealed = meetings.find((meeting) => {
    const event = byId.get(meeting.id);
    return (
      event &&
      ("id" in event.lookup
        ? event.lookup.id
        : event.lookup.originalEventId) === createdId
    );
  })?.id;
  useEffect(() => {
    if (!revealed) return;
    const timer = window.setTimeout(() => setCreatedId(null), 2000);
    return () => window.clearTimeout(timer);
  }, [revealed]);
  const unavailable =
    !accountId ||
    calendar.loading ||
    Boolean(calendar.error) ||
    (calendar.issues.length > 0 && calendar.events.length === 0) ||
    (!calendar.my && !calendar.ids.length);
  const status = !accountId
    ? "Войдите в Small через кнопку профиля внизу слева."
    : calendar.loading
      ? "Загружаю календарь Small…"
      : calendar.error ||
        (calendar.issues.length
          ? "Нет подтверждённых данных за этот период."
          : "Выберите хотя бы один календарь.");
  return (
    <div
      className={`app-shell desktop-workspace ${filtersOpen ? "sidebar-open" : ""}`}
    >
      <nav className="icon-rail" aria-label="Разделы Small">
        <div className="small-emblem" title="Small">
          <UsersRound size={22} />
        </div>
        <button
          className="active"
          aria-label="Показать календари"
          aria-controls="small-calendar-filters"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <CalendarDays size={19} />
        </button>
        <button
          className="rail-settings"
          aria-label="Настройки пространства"
          title="Настройки пространства"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 size={19} />
        </button>
        <button
          aria-label="Подобрать время"
          title="Подобрать время"
          disabled={!accountId}
          onClick={() => setAvailabilityAccount(accountId)}
        >
          <Clock size={19} />
        </button>
        <button
          aria-label="Напоминания"
          title="Напоминания"
          onClick={() => setRemindersOpen(true)}
        >
          <Bell size={19} />
        </button>
        <SmallAccount onChange={setAccount} revision={revision} />
      </nav>
      <CalendarFilters
        calendar={calendar}
        enabled={Boolean(accountId)}
        date={date}
        setDate={setDate}
      />
      {filtersOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Закрыть список календарей"
          onClick={() => setFiltersOpen(false)}
        />
      )}
      <main className="main-shell">
        <header className="workspace-header">
          <div className="workspace-title">
            <h1>Календарь Small</h1>
            <span className="prototype-tag">
              {accountId ? "Team API" : "Вход не выполнен"}
            </span>
          </div>
          <button
            className="primary header-create"
            aria-label="Создать событие"
            disabled={!accountId}
            title={
              !accountId ? "Войдите в Small для создания встречи" : undefined
            }
            onClick={() => setCreating(true)}
          >
            Создать <Plus size={16} />
          </button>
        </header>
        <DockWorkspace
          settingsOpen={settingsOpen}
          closeSettings={() => setSettingsOpen(false)}
          calendar={(swap) => (
            <div className="calendar-container live-calendar">
              {calendar.issues.length > 0 && (
                <div className="calendar-warning" role="alert">
                  <strong>
                    Данные неполные. Занятость неизвестна для части календарей.
                  </strong>
                  {calendar.issues.map((issue, index) => (
                    <p key={index}>
                      {calendar.calendars.find((c) => c.id === issue.source)
                        ?.name ??
                        (issue.source === "my"
                          ? "Мой календарь"
                          : issue.source)}
                      : {issue.message}
                    </p>
                  ))}
                </div>
              )}
              {!unavailable &&
                !calendar.events.length &&
                !calendar.issues.length && (
                  <p className="calendar-warning" role="status">
                    В этом периоде встреч нет.
                  </p>
                )}
              <Calendar
                date={date}
                setDate={setDate}
                view={view}
                setView={setView}
                events={meetings}
                revealEventId={revealed}
                select={(meeting) => {
                  const event = byId.get(meeting.id);
                  if (event && accountId) setSelected({ accountId, event });
                }}
                change={() => {}}
                state="ready"
                retry={calendar.refresh}
                swap={swap}
                readOnly
                today={calendarToday()}
                footerLabel="Данные Small · только чтение"
                statusContent={
                  unavailable ? (
                    <div className="state-screen" role="status">
                      <CalendarDays size={30} />
                      <h3>{status}</h3>
                      {accountId && !calendar.loading && (
                        <button
                          className="secondary"
                          onClick={calendar.refresh}
                        >
                          Повторить загрузку
                        </button>
                      )}
                    </div>
                  ) : undefined
                }
              />
            </div>
          )}
          assistant={(swap, headerTarget) => (
            <div className="assistant-container">
              <DesktopAssistant
                key={accountId ?? "signed-out"}
                swap={swap}
                headerTarget={headerTarget}
              />
            </div>
          )}
        />
        <footer className="workspace-footer">
          <span>Small Calendar</span>
          <span>Чтение Team API · Asia/Almaty</span>
        </footer>
      </main>
      {remindersOpen && <Reminders close={() => setRemindersOpen(false)} />}
      {creating && account?.status === "signed-in" && (
        <NewMeeting
          key={account.profile.id}
          account={account.profile}
          initialDate={date}
          close={() => setCreating(false)}
          expired={expired}
          created={(result) => {
            setCreatedId(result.eventId ?? null);
            setDate(calendarDateAt(result.draft.startsAt));
            calendar.setMy(true);
            calendar.refresh();
          }}
        />
      )}
      {availabilityAccount && availabilityAccount === accountId && (
        <Availability
          key={accountId}
          accountId={availabilityAccount}
          initialDate={date}
          close={() => setAvailabilityAccount(null)}
          expired={expired}
        />
      )}
      {selected && selected.accountId === accountId && (
        <EventDetails
          key={`${selected.accountId}:${selected.event.key}`}
          accountId={selected.accountId}
          lookup={selected.event.lookup}
          changed={calendar.refresh}
          close={() => setSelected(null)}
          expired={expired}
        />
      )}
    </div>
  );
}
