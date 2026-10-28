import { useCallback, useEffect, useState } from "react";
import { CalendarDays, UsersRound } from "lucide-react";
import { Calendar } from "../../prototype/src/CalendarView";
import type { Meeting } from "../../prototype/src/types";
import { DesktopAssistant } from "./Assistant";
import { SmallAccount } from "./SmallAccount";
import { CalendarFilters } from "./CalendarFilters";
import { EventDetails } from "./EventDetails";
import { useSmallCalendar } from "./useSmallCalendar";
import {
  calendarRange,
  calendarToday,
  splitEventDays,
} from "../shared/calendar-time.js";
import type { CalendarEvent, CalendarView } from "../shared/calendar.js";
import type { SmallAuthState } from "../shared/small-auth.js";

export function DesktopWorkspace() {
  const [account, setAccount] = useState<SmallAuthState | null>(null);
  const [revision, setRevision] = useState(0);
  const [date, setDate] = useState(calendarToday);
  const [view, setView] = useState<CalendarView>("week");
  const [reversed, setReversed] = useState(false);
  const [selected, setSelected] = useState<{
    accountId: string;
    event: CalendarEvent;
  } | null>(null);
  const accountId = account?.status === "signed-in" ? account.profile.id : null;
  useEffect(() => {
    setSelected(null);
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
        agenda: event.description,
        calendar: calendar.my ? "personal" : "team",
        color: "green",
        people: [],
        location: event.location,
      };
    }),
  );
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
  const swap = () => setReversed((value) => !value);
  return (
    <div className="app-shell desktop-workspace">
      <nav className="icon-rail" aria-label="Разделы Small">
        <div className="small-emblem" title="Small">
          <UsersRound size={22} />
        </div>
        <button className="active" aria-label="Календарь">
          <CalendarDays size={19} />
        </button>
        <SmallAccount onChange={setAccount} revision={revision} />
      </nav>
      <CalendarFilters calendar={calendar} enabled={Boolean(accountId)} />
      <main className="main-shell">
        <header className="workspace-header">
          <div className="workspace-title">
            <h1>Календарь Small</h1>
            <span className="prototype-tag">
              {accountId ? "Team API" : "Вход не выполнен"}
            </span>
          </div>
          <span className="subtle">
            {account?.status === "signed-in" ? account.profile.name : ""}
          </span>
        </header>
        <div
          className={`workspace ${reversed ? "reversed" : ""}`}
          style={{ "--calendar-ratio": "68%" } as React.CSSProperties}
        >
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
                      (issue.source === "my" ? "Мой календарь" : issue.source)}
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
                      <button className="secondary" onClick={calendar.refresh}>
                        Повторить загрузку
                      </button>
                    )}
                  </div>
                ) : undefined
              }
            />
          </div>
          <div className="splitter" aria-hidden="true">
            <span />
          </div>
          <div className="assistant-container">
            <DesktopAssistant key={accountId ?? "signed-out"} swap={swap} />
          </div>
        </div>
        <footer className="workspace-footer">
          <span>Small Calendar</span>
          <span>Чтение Team API · Asia/Almaty</span>
        </footer>
      </main>
      {selected && selected.accountId === accountId && (
        <EventDetails
          key={`${selected.accountId}:${selected.event.key}`}
          accountId={selected.accountId}
          lookup={selected.event.lookup}
          close={() => setSelected(null)}
          expired={expired}
        />
      )}
    </div>
  );
}
