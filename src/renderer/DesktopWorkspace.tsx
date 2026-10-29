import { Reminders } from "./Reminders";
import { Bell, Tags } from "lucide-react";
import { AnalyticsRules } from "./AnalyticsRules";
import { events, notifySuccess, notifyError } from "./notification-events.js";
import { NewMeeting } from "./NewMeeting";
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, Settings2, UsersRound, Plus } from "lucide-react";
import { Calendar } from "../../prototype/src/CalendarView";
import type { Meeting, Slot } from "../../prototype/src/types";
import { DesktopAssistant } from "./Assistant";
import { DockWorkspace } from "./DockWorkspace";
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
  const [rulesOpen, setRulesOpen] = useState(false);
  const [savingTime, setSavingTime] = useState(false);
  const saving = useRef(false);
  const currentAccount = useRef<string | null>(null);
  const [initialPeople, setInitialPeople] = useState<
    NonNullable<CalendarEvent["participants"]>
  >([]);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [initialSlot, setInitialSlot] = useState<Slot | null>(null);
  const [creating, setCreating] = useState(false);
  const [account, setAccount] = useState<SmallAuthState | null>(null);
  const [revision, setRevision] = useState(0);
  const [date, setDate] = useState(calendarToday);
  const [view, setView] = useState<CalendarView>("week");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<{
    accountId: string;
    event: CalendarEvent;
  } | null>(null);
  const accountId = account?.status === "signed-in" ? account.profile.id : null;
  currentAccount.current = accountId;
  useEffect(() => {
    setRemindersOpen(false);
    setCreating(false);
    setCreatedId(null);
    setSelected(null);
  }, [accountId]);
  const expired = useCallback(() => {
    setAccount(null);
    setRevision((value) => value + 1);
  }, []);
  const calendar = useSmallCalendar(accountId, date, view, expired);
  useEffect(() => {
    const created = (event: Event) => {
      const result = (
        event as CustomEvent<
          import("../shared/meeting-operations.js").MeetingView
        >
      ).detail;
      if (result.draft.organizer.id !== currentAccount.current) return;
      setCreatedId(result.eventId ?? null);
      setDate(calendarDateAt(result.draft.startsAt));
      calendar.setMy(true);
      calendar.refresh();
    };
    events.addEventListener("assistant-meeting-created", created);
    return () =>
      events.removeEventListener("assistant-meeting-created", created);
  }, [calendar.setMy, calendar.refresh]);
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
        people:
          event.participants?.map((p) => p.name || "Участник без имени") ?? [],
        location: event.location,
      };
    }),
  );
  const canChange = (meeting: Meeting) => {
    const event = byId.get(meeting.id);
    const original = meetings.find((item) => item.id === meeting.id);
    if (!original) return false;
    const day = calendarRange(original.date, "day");
    return (
      !!event &&
      calendarDateAt(event.startsAt) >= calendarToday() &&
      meeting.date >= calendarToday() &&
      !savingTime &&
      event.participation === "organizer" &&
      "id" in event.lookup &&
      // Only whole events can be dragged; grid durations round away seconds.
      Date.parse(event.startsAt) >= Date.parse(day.start) &&
      Date.parse(event.endsAt) <= Date.parse(day.end)
    );
  };
  async function changeTime(meeting: Meeting) {
    const event = byId.get(meeting.id);
    if (
      !event ||
      !("id" in event.lookup) ||
      !accountId ||
      saving.current ||
      !canChange(meeting)
    )
      return;
    saving.current = true;
    setSavingTime(true);
    const accountAtStart = accountId;
    const base = Date.parse(calendarRange(meeting.date, "day").start);
    try {
      const reply = await window.smallDesktop.calendar.reschedule({
        accountId,
        eventId: event.lookup.id,
        beforeStart: event.startsAt,
        beforeEnd: event.endsAt,
        startsAt: new Date(base + meeting.start * 60000).toISOString(),
        endsAt: new Date(
          base + (meeting.start + meeting.duration) * 60000,
        ).toISOString(),
      });
      if (currentAccount.current !== accountAtStart) return;
      if (!reply.ok) {
        notifyError("перенести событие", reply.kind);
        if (reply.kind === "auth") expired();
      } else notifySuccess("Время события изменено");
      calendar.refresh();
    } catch {
      if (currentAccount.current === accountAtStart) {
        notifyError("перенести событие");
        calendar.refresh();
      }
    } finally {
      saving.current = false;
      setSavingTime(false);
    }
  }
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
          aria-label="Правила тем аналитики"
          title="Правила тем аналитики"
          onClick={() => setRulesOpen(true)}
        >
          <Tags size={19} />
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
            onClick={() => {
              setInitialPeople([]);
              setInitialSlot(null);
              setCreating(true);
            }}
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
              {savingTime && (
                <p className="calendar-warning" role="status">
                  Сохраняю время встречи…
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
                change={(meeting) => void changeTime(meeting)}
                canChange={canChange}
                create={
                  !unavailable
                    ? (slot) => {
                        if (slot.date < calendarToday()) return;
                        setInitialPeople([]);
                        setInitialSlot(slot);
                        setCreating(true);
                      }
                    : undefined
                }
                state="ready"
                retry={calendar.refresh}
                swap={swap}
                today={calendarToday()}
                footerLabel="Данные Small"
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
          <span>Team API · Asia/Almaty</span>
        </footer>
      </main>
      {remindersOpen && <Reminders close={() => setRemindersOpen(false)} />}
      {rulesOpen && <AnalyticsRules close={() => setRulesOpen(false)} />}
      {creating && account?.status === "signed-in" && (
        <NewMeeting
          key={account.profile.id}
          account={account.profile}
          initialPeople={initialPeople.map((p) => ({
            participantId: p.id,
            name: p.name,
            position: "",
          }))}
          initialDate={
            initialSlot?.date ??
            (date < calendarToday() ? calendarToday() : date)
          }
          initialSlot={initialSlot ?? undefined}
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
      {selected && selected.accountId === accountId && (
        <EventDetails
          key={`${selected.accountId}:${selected.event.key}`}
          accountId={selected.accountId}
          lookup={selected.event.lookup}
          changed={calendar.refresh}
          createWithPeople={(event) => {
            setInitialPeople(event.participants ?? []);
            setInitialSlot(null);
            setSelected(null);
            setCreating(true);
          }}
          close={() => setSelected(null)}
          expired={expired}
        />
      )}
    </div>
  );
}
