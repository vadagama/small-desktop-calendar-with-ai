import { seriesInvalidation } from "../shared/calendar-invalidation.js";
import { Reminders } from "./Reminders";
import { Bell, Brain, Sparkles } from "lucide-react";
import { MemorySettings } from "./MemorySettings";
import { AgentSettings } from "./AgentSettings";
import {
  events,
  notifySuccess,
  notifyError,
  notifyInfo,
} from "./notification-events.js";
import { NewMeeting } from "./NewMeeting";
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, Settings2, UsersRound, Plus } from "lucide-react";
import { Calendar } from "../../prototype/src/CalendarView";
import type { Meeting, Slot } from "../../prototype/src/types";
import { DesktopAssistant } from "./Assistant";
import { DockWorkspace } from "./DockWorkspace";
import { SmallAccount } from "./SmallAccount";
import { CalendarFilters, type ParticipationFilter } from "./CalendarFilters";
import { EventDetails } from "./EventDetails";
import { CalendarFreshnessBar } from "./CalendarFreshnessBar";
import { eventFromCreatedMeeting } from "../shared/calendar-view-state.js";
import type { MeetingView } from "../shared/meeting-operations.js";
import type { MeetingDeletion } from "../shared/calendar-tools.js";
import { meetingInvalidation } from "../shared/calendar-invalidation.js";
import {
  beginMove,
  classifyMoveReply,
  isMoveLocked,
  moveBadge,
  overlayMoves,
  resolveMove,
  settleMoves,
  type MoveReply,
  type PendingMoves,
} from "../shared/optimistic-move.js";
import { useSmallCalendar } from "./useSmallCalendar";
import {
  calendarChangeMarks,
  type CalendarChangeKind,
} from "../shared/calendar-change-marks.js";
import {
  calendarDateAt,
  calendarRange,
  calendarToday,
  splitEventDays,
} from "../shared/calendar-time.js";
import type { CalendarEvent, CalendarView } from "../shared/calendar.js";
import type { SmallAuthState } from "../shared/small-auth.js";

export function DesktopWorkspace() {
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  useEffect(() => {
    const open = () => setAgentSettingsOpen(true);
    window.addEventListener("small:open-ai-settings", open);
    return () => window.removeEventListener("small:open-ai-settings", open);
  }, []);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [savingTime, setSavingTime] = useState(false);
  // Moves shown at their new time while Small has not confirmed them yet.
  const [moves, setMoves] = useState<PendingMoves>({});
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
  const [participation, setParticipation] = useState<
    Record<ParticipationFilter, boolean>
  >({
    organizer: true,
    invited: true,
    informed: true,
  });
  const selectionSequence = useRef(0);
  const [selected, setSelected] = useState<{
    sequence: number;
    accountId: string;
    event: CalendarEvent;
  } | null>(null);
  // What happened to the open card on the server since it was opened.
  const [remote, setRemote] = useState<"changed" | "missing" | null>(null);
  const accountId = account?.status === "signed-in" ? account.profile.id : null;
  currentAccount.current = accountId;
  useEffect(() => {
    setParticipation({ organizer: true, invited: true, informed: true });
    setMemoryOpen(false);
    setRemindersOpen(false);
    setCreating(false);
    setCreatedId(null);
    setSelected(null);
    setMoves({});
    setRemote(null);
  }, [accountId]);
  useEffect(() => setRemote(null), [selected?.event.key]);
  const expired = useCallback(() => {
    setAccount(null);
    setRevision((value) => value + 1);
  }, []);
  const calendar = useSmallCalendar(accountId, date, view, expired);
  const showCreated = (result: MeetingView) => {
    setCreatedId(result.eventId ?? null);
    const visible = calendarRange(date, view);
    const start = Date.parse(result.draft.startsAt);
    // A meeting inside the range on screen is added in place: no navigation, no new query.
    const inRange =
      calendar.my &&
      start >= Date.parse(visible.start) &&
      start < Date.parse(visible.end);
    if (inRange && result.eventId)
      calendar.addEvent(eventFromCreatedMeeting(result.draft, result.eventId));
    if (!inRange) setDate(calendarDateAt(result.draft.startsAt));
    calendar.setMy(true);
    calendar.refreshAfterWrite(meetingInvalidation(result.draft));
  };
  useEffect(() => {
    const created = (event: Event) => {
      const result = (event as CustomEvent<MeetingView>).detail;
      if (result.draft.organizer.id !== currentAccount.current) return;
      showCreated(result);
    };
    const deleted = (event: Event) => {
      const result = (event as CustomEvent<MeetingDeletion>).detail;
      if (result.accountId !== currentAccount.current) return;
      calendar.refreshAfterWrite(
        result.series
          ? seriesInvalidation({
              lookup: {
                originalEventId: result.series.seriesId,
                date: result.series.originalDate,
              },
            })
          : { eventIds: [result.eventId], windows: [] },
        true,
      );
    };
    events.addEventListener("assistant-meeting-created", created);
    events.addEventListener("assistant-meeting-deleted", deleted);
    return () => {
      events.removeEventListener("assistant-meeting-created", created);
      events.removeEventListener("assistant-meeting-deleted", deleted);
    };
  }, [showCreated]);
  const range = calendarRange(date, view);
  const byId = new Map<string, CalendarEvent>();
  const shownEvents = overlayMoves(calendar.events, moves).filter((event) => {
    if (!calendar.my) return true;
    // Missing role metadata must not silently hide a meeting while any type is enabled.
    if (!event.participation || event.participation === "unknown")
      return Object.values(participation).some(Boolean);
    return participation[event.participation];
  });
  const meetings: Meeting[] = shownEvents.flatMap((event) =>
    splitEventDays(event.startsAt, event.endsAt, range).map((part) => {
      const id = `${event.key}:${part.date}`;
      byId.set(id, event);
      return {
        ...part,
        id,
        title: event.title,
        organizer: event.organizer,
        recurring: event.recurring === true,
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
      !isMoveLocked(moves, event.key) &&
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
    const startsAt = new Date(base + meeting.start * 60000).toISOString();
    const endsAt = new Date(
      base + (meeting.start + meeting.duration) * 60000,
    ).toISOString();
    // Whatever the outcome, the old and the new time may now differ from what is stored.
    const written = {
      eventIds: [event.lookup.id],
      windows: [
        { start: event.startsAt, end: event.endsAt },
        { start: startsAt, end: endsAt },
      ],
    };
    // The card moves at once; the reply or fresh data from Small decides whether it stays.
    setMoves((current) =>
      beginMove(
        current,
        event.key,
        { startsAt: event.startsAt, endsAt: event.endsAt },
        { startsAt, endsAt },
        Date.now(),
      ),
    );
    const finish = (reply: MoveReply) =>
      setMoves((current) => resolveMove(current, event.key, reply, Date.now()));
    try {
      const reply = await window.smallDesktop.calendar.reschedule({
        accountId,
        eventId: event.lookup.id,
        beforeStart: event.startsAt,
        beforeEnd: event.endsAt,
        startsAt,
        endsAt,
      });
      if (currentAccount.current !== accountAtStart) return;
      finish(classifyMoveReply(reply));
      if (reply.ok) notifySuccess("Время события изменено");
      else {
        notifyError("перенести событие", reply.kind);
        if (reply.kind === "auth") expired();
      }
      calendar.refreshAfterWrite(written);
    } catch {
      if (currentAccount.current === accountAtStart) {
        finish("unknown");
        notifyError("перенести событие");
        calendar.refreshAfterWrite(written);
      }
    } finally {
      saving.current = false;
      setSavingTime(false);
    }
  }
  // Data read from Small after a confirmed or unknown move decides what became of it.
  const announced = useRef(new Set<string>());
  useEffect(() => {
    if (!Object.keys(moves).length) return;
    const settle = () => {
      const now = Date.now();
      const { settled } = settleMoves(
        moves,
        calendar.events,
        calendar.fetchedAt,
        now,
      );
      if (!settled.length) return;
      setMoves(
        (current) =>
          settleMoves(current, calendar.events, calendar.fetchedAt, now).moves,
      );
      for (const item of settled) {
        const id = `${item.key}:${moves[item.key]?.since}`;
        if (announced.current.has(id)) continue;
        announced.current.add(id);
        if (item.phase !== "unknown") continue;
        if (item.outcome === "confirmed")
          notifySuccess("Перенос подтверждён: время события изменено.");
        else if (item.outcome === "reverted")
          notifyInfo(
            "Перенос не применён: на сервере прежнее время. Повторное изменение этой встречи может быть заблокировано до проверки.",
          );
        else
          notifyInfo(
            "Событие изменилось на сервере. Показаны актуальные данные.",
          );
      }
    };
    settle();
    const timer = window.setInterval(settle, 1000);
    return () => window.clearInterval(timer);
  }, [moves, calendar.events, calendar.fetchedAt]);
  const pendingCards: Record<string, "saving" | "unknown"> = {};
  for (const [id, event] of byId) {
    const badge = moves[event.key] && moveBadge(moves[event.key]!);
    if (badge) pendingCards[id] = badge;
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
  const [marks, setMarks] = useState<Record<string, CalendarChangeKind>>({});
  const seenChanges = useRef<{ key: string; revision: number } | null>(null);
  useEffect(() => {
    const previous = seenChanges.current;
    seenChanges.current = {
      key: calendar.queryKey,
      revision: calendar.changes.revision,
    };
    const diff = calendar.changes.diff;
    // Moving to another stored range replays nothing; only a new change of the same range counts.
    if (
      !diff ||
      !previous ||
      previous.key !== calendar.queryKey ||
      calendar.changes.revision <= previous.revision
    ) {
      setMarks((current) => (Object.keys(current).length ? {} : current));
      return;
    }
    const cardsOf = (eventKey: string) =>
      [...byId].filter(([, event]) => event.key === eventKey).map(([id]) => id);
    setMarks(calendarChangeMarks(diff, cardsOf, revealed));
    // The open card shows a banner about it, unless it is the echo of our own refresh or write.
    if (selected && !calendar.justRefreshed()) {
      const { key } = selected.event;
      if (diff.removed.includes(key)) setRemote("missing");
      else if (diff.changed.includes(key) || diff.moved.includes(key))
        setRemote((current) => current ?? "changed");
    }
    const timer = window.setTimeout(() => setMarks({}), 2000);
    return () => window.clearTimeout(timer);
  }, [calendar.queryKey, calendar.changes.revision]);
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
          className={`rail-memory ${memoryOpen ? "active" : ""}`}
          aria-label="Память ассистента"
          title="Память ассистента"
          onClick={() => setMemoryOpen(true)}
        >
          <Brain size={20} />
        </button>
        <button
          aria-label="Настройки AI-помощника"
          title="Настройки AI-помощника"
          onClick={() => setAgentSettingsOpen(true)}
        >
          <Sparkles size={20} />
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
        participation={participation}
        toggleParticipation={(type) =>
          setParticipation((current) => ({
            ...current,
            [type]: !current[type],
          }))
        }
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
              <CalendarFreshnessBar
                fetchedAt={calendar.fetchedAt}
                offline={calendar.offline}
                refreshError={calendar.refreshError}
                refreshing={calendar.refreshing}
                refresh={calendar.refresh}
              />
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
              {!unavailable &&
                calendar.my &&
                calendar.events.length > 0 &&
                !shownEvents.length && (
                  <p className="calendar-warning" role="status">
                    Нет встреч выбранных типов.
                  </p>
                )}

              <Calendar
                date={date}
                setDate={setDate}
                view={view}
                setView={setView}
                events={meetings}
                revealEventId={revealed}
                changes={marks}
                pending={pendingCards}
                select={(meeting) => {
                  const event = byId.get(meeting.id);
                  if (event && accountId)
                    setSelected({
                      accountId,
                      event,
                      sequence: ++selectionSequence.current,
                    });
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
                hideFooter
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
          <span>Team API · Asia/Almaty</span>
        </footer>
      </main>
      {remindersOpen && <Reminders close={() => setRemindersOpen(false)} />}
      {memoryOpen && (
        <MemorySettings
          key={accountId ?? "signed-out"}
          account={account?.status === "signed-in" ? account.profile : null}
          close={() => setMemoryOpen(false)}
        />
      )}
      {agentSettingsOpen && (
        <AgentSettings
          close={() => setAgentSettingsOpen(false)}
          update={(state) =>
            window.dispatchEvent(
              new CustomEvent("small:agent-settings-changed", {
                detail: state,
              }),
            )
          }
        />
      )}
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
          created={showCreated}
        />
      )}
      {selected && selected.accountId === accountId && (
        <EventDetails
          key={`${selected.accountId}:${selected.event.key}:${selected.sequence}`}
          accountId={selected.accountId}
          lookup={selected.event.lookup}
          changed={(write, removed) =>
            calendar.refreshAfterWrite(write, removed)
          }
          remote={remote}
          acknowledgeRemote={() => setRemote(null)}
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
