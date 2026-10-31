import { Help } from "./ui/Help";
import { helpArticles } from "./help-content";
import { EventList } from "./ui/EventList";
import { monthRange } from "./ui/event-list";
import { eventListMeetings } from "./event-list-meetings";
import { useEventList } from "./useEventList";
import { seriesInvalidation } from "../shared/calendar-invalidation.js";
import { Reminders } from "./Reminders";
import { Bell, Brain, Sparkles, CircleHelp } from "lucide-react";
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
import { Calendar } from "./ui/CalendarView";
import type { Meeting, Slot } from "./ui/types";
import { DesktopAssistant } from "./Assistant";
import { DockWorkspace } from "./DockWorkspace";
import { SmallAccount } from "./SmallAccount";
import { SmallAuthNotice } from "./SmallAuthNotice";
import { openSmallAccount, requireSmallAccount } from "./useSmallAccount";
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
import type { SmallAuthState, SmallAuthStatus } from "../shared/small-auth.js";

export function DesktopWorkspace() {
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpPrompt, setHelpPrompt] = useState<{ id: string; text: string }>();
  const consumeHelpPrompt = useCallback(() => setHelpPrompt(undefined), []);
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
  const [needsAuth, setNeedsAuth] = useState(false);
  const [authStatus, setAuthStatus] = useState<SmallAuthStatus>("checking");
  const updateAuthStatus = useCallback((status: SmallAuthStatus) => {
    setAuthStatus(status);
    if (status === "required" || status === "signed-out") setNeedsAuth(true);
    else if (status === "verified") setNeedsAuth(false);
  }, []);
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
  const identityId =
    account?.status === "signed-in" ? account.profile.id : null;
  const accountId = needsAuth ? null : identityId;
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
  }, [identityId]);
  useEffect(() => setRemote(null), [selected?.event.key]);
  const expired = useCallback(() => {
    requireSmallAccount();
  }, []);
  const calendar = useSmallCalendar(accountId, date, view, expired);
  const list = useEventList(accountId, setDate, setView);
  const listResult = list.active ? list.result : null;
  const listRange = listResult?.query ?? monthRange(date);
  const navigateDate = (next: string) => {
    list.clear();
    setDate(next);
  };
  const navigateView = (next: CalendarView) => {
    list.clear();
    list.setActive(false);
    setView(next);
  };
  // Manual source/type changes return to the live month and its selected calendars.
  useEffect(() => {
    list.clear();
  }, [
    calendar.my,
    JSON.stringify(calendar.ids),
    JSON.stringify(participation),
  ]);
  const showCreated = (result: MeetingView) => {
    list.clear();
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
      list.clear();
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
  const listEvents = listResult?.events ?? shownEvents;
  const listMeetings = eventListMeetings(
    listEvents,
    listRange.from,
    listRange.to,
    calendar.calendars,
  );
  const selectListMeeting = (meeting: Meeting) => {
    const event = listEvents.find((event) => event.key === meeting.id);
    if (event && accountId)
      setSelected({ accountId, event, sequence: ++selectionSequence.current });
  };
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
    ? authStatus === "checking"
      ? "Проверяю доступ к Small…"
      : "Не удалось проверить доступ к Small. Проверьте подключение через профиль."
    : calendar.loading
      ? "Загружаю календарь Small…"
      : calendar.error ||
        (calendar.issues.length
          ? "Нет подтверждённых данных за этот период."
          : "Выберите хотя бы один календарь.");
  return (
    <div
      className={`app-shell desktop-workspace ${helpOpen ? "help-active" : ""} ${filtersOpen ? "sidebar-open" : ""}`}
    >
      <nav className="icon-rail" aria-label="Разделы Small">
        <div className="small-emblem" title="Small">
          <UsersRound size={22} />
        </div>
        <button
          className={helpOpen ? "" : "active"}
          aria-label="Показать календари"
          aria-controls="small-calendar-filters"
          onClick={() => {
            if (helpOpen) {
              setHelpOpen(false);
              setFiltersOpen(false);
            } else setFiltersOpen((open) => !open);
          }}
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
          onClick={() => {
            setHelpOpen(false);
            setSettingsOpen(true);
          }}
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
        <button
          aria-label="Помощь"
          title="Помощь"
          className={helpOpen ? "active" : ""}
          aria-current={helpOpen ? "page" : undefined}
          onClick={() => {
            setHelpOpen(true);
            setFiltersOpen(false);
          }}
        >
          <CircleHelp size={20} />
        </button>
        <SmallAccount onChange={setAccount} onStatusChange={updateAuthStatus} />
      </nav>
      <CalendarFilters
        calendar={calendar}
        enabled={Boolean(accountId)}
        date={date}
        setDate={navigateDate}
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
            <h1>{helpOpen ? "Помощь" : "Календарь Small"}</h1>
          </div>
          <button
            hidden={helpOpen}
            className="primary header-create"
            aria-label="Создать событие"
            title={
              !accountId ? "Войдите в Small для создания встречи" : undefined
            }
            onClick={() => {
              if (!accountId) {
                openSmallAccount();
                return;
              }
              setInitialPeople([]);
              setInitialSlot(null);
              setCreating(true);
            }}
          >
            Создать <Plus size={16} />
          </button>
        </header>
        <div className="help-section-host" hidden={!helpOpen}>
          <Help
            articles={helpArticles}
            onPrompt={(text) => {
              setHelpOpen(false);
              setHelpPrompt({ id: crypto.randomUUID(), text });
            }}
            onAction={(action) => {
              if (action === "calendar") setHelpOpen(false);
              if (action === "memory") setMemoryOpen(true);
              if (action === "settings") setAgentSettingsOpen(true);
              if (action === "account") openSmallAccount();
              if (action === "notifications") setRemindersOpen(true);
              if (action === "model") {
                setHelpOpen(false);
                window.dispatchEvent(new Event("small:open-model-settings"));
              }
            }}
          />
        </div>
        {!helpOpen && needsAuth && (
          <SmallAuthNotice expired={Boolean(identityId)} />
        )}
        <DockWorkspace
          hidden={helpOpen}
          settingsOpen={settingsOpen}
          closeSettings={() => setSettingsOpen(false)}
          calendar={(swap) => (
            <div className="calendar-container live-calendar">
              {!listResult && (
                <CalendarFreshnessBar
                  fetchedAt={calendar.fetchedAt}
                  offline={calendar.offline}
                  refreshError={calendar.refreshError}
                  refreshing={calendar.refreshing}
                  refresh={calendar.refresh}
                />
              )}
              {!listResult && calendar.issues.length > 0 && (
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
              {!listResult &&
                !unavailable &&
                !calendar.events.length &&
                !calendar.issues.length && (
                  <p className="calendar-warning" role="status">
                    В этом периоде встреч нет.
                  </p>
                )}
              {!listResult &&
                !unavailable &&
                calendar.my &&
                calendar.events.length > 0 &&
                !shownEvents.length && (
                  <p className="calendar-warning" role="status">
                    Нет встреч выбранных типов.
                  </p>
                )}

              <Calendar
                date={date}
                setDate={navigateDate}
                view={view}
                setView={navigateView}
                listView={{
                  active: list.active,
                  open: () => {
                    setView("month");
                    list.setActive(true);
                  },
                  content: (
                    <>
                      {listResult && (!listResult.complete || list.stale) && (
                        <div className="calendar-warning" role="status">
                          {!listResult.complete && (
                            <p>
                              Результаты поиска неполные.{" "}
                              {Array.from(
                                new Set(
                                  listResult.issues.map((i) => i.message),
                                ),
                              ).join(" ")}
                            </p>
                          )}
                          {list.stale && (
                            <p>
                              Календарь обновился или недоступен. Для актуальных
                              результатов повторите поиск ассистенту.
                            </p>
                          )}
                        </div>
                      )}
                      <EventList
                        organizerAlreadyFiltered
                        events={listMeetings}
                        date={date}
                        filter={
                          listResult
                            ? {
                                ...listResult.query,
                                ...(listResult.organizer
                                  ? { organizer: listResult.organizer.name }
                                  : {}),
                              }
                            : null
                        }
                        changeFilter={() => list.clear()}
                        select={selectListMeeting}
                        complete={
                          listResult?.complete ?? !calendar.issues.length
                        }
                      />
                    </>
                  ),
                }}
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
                  needsAuth ? (
                    <></>
                  ) : unavailable && !listResult ? (
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
                key={identityId ?? "signed-out"}
                swap={swap}
                headerTarget={headerTarget}
                helpPrompt={helpPrompt}
                onHelpPromptApplied={consumeHelpPrompt}
              />
            </div>
          )}
        />
      </main>
      {remindersOpen && <Reminders close={() => setRemindersOpen(false)} />}
      {memoryOpen && (
        <MemorySettings
          authRequired={needsAuth}
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
          authRequired={needsAuth}
          created={showCreated}
        />
      )}
      {selected && selected.accountId === accountId && (
        <EventDetails
          key={`${selected.accountId}:${selected.event.key}:${selected.sequence}`}
          accountId={selected.accountId}
          lookup={selected.event.lookup}
          changed={(write, removed) => {
            list.clear();
            calendar.refreshAfterWrite(write, removed);
          }}
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
