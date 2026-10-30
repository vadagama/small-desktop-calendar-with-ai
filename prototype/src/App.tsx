import "./analytics.css";
import { groupListEvents, type ListFilter } from "./event-list";
import { useEffect, useRef, useState } from "react";
import {
  Menu,
  CalendarDays,
  ChartNoAxesCombined,
  Settings2,
  Plus,
  UsersRound,
  Brain,
  Sparkles,
} from "lucide-react";
import { Calendar } from "./CalendarView";
import { Sidebar } from "./Sidebar";
import { Assistant } from "./Assistant";
import { Analytics } from "./Analytics";
import { CreateDialog, EventDialog, SettingsDialog } from "./Dialogs";
import { MemorySettings } from "./MemorySettings";
import { createDemoMemory } from "./memory-demo";
import {
  AssistantSettingsDialog,
  defaultAssistantSettings,
} from "./AssistantSettingsDialog";
import { conflicts, TODAY } from "./calendar";
import { ANALYTICS_DEMO_EVENTS } from "./analytics-fixtures";
import { dashboards } from "./analytics-model";
import type { Dashboard, Panel, Period } from "./analytics-model";
import { useAnalyticsSnapshot } from "./useAnalyticsSnapshot";
import type {
  CalendarId,
  DataState,
  Draft,
  Layout,
  Meeting,
  View,
} from "./types";
const PANELS_KEY = "small-prototype-panels-v1";
function readPanels(): {
  main: "calendar" | Dashboard;
  side: Exclude<Panel, "calendar"> | "closed";
  linked: boolean;
} {
  try {
    const saved = JSON.parse(localStorage.getItem(PANELS_KEY) || "{}");
    return {
      main:
        saved.main === "calendar" || Object.hasOwn(dashboards, saved.main)
          ? saved.main
          : "calendar",
      side:
        saved.side === "assistant" ||
        saved.side === "closed" ||
        Object.hasOwn(dashboards, saved.side)
          ? saved.side
          : "assistant",
      linked: saved.linked === true,
    };
  } catch {
    return { main: "calendar", side: "assistant", linked: false };
  }
}
const LAYOUT_KEY = "small-ui-prototype-layout-v1";
function readLayout(): { layout: Layout; ratio: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "{}");
    return {
      layout: ["right", "left", "bottom", "top"].includes(saved.layout)
        ? saved.layout
        : "right",
      ratio:
        typeof saved.ratio === "number" && Number.isFinite(saved.ratio)
          ? Math.min(76, Math.max(35, saved.ratio))
          : 68,
    };
  } catch {
    return { layout: "right", ratio: 68 };
  }
}
export default function App({
  AssistantPanel = Assistant,
  ProfileControl,
}: {
  AssistantPanel?: typeof Assistant;
  ProfileControl?: React.ReactNode;
} = {}) {
  const [events, setEvents] = useState<Meeting[]>(ANALYTICS_DEMO_EVENTS);
  const [date, setDate] = useState(TODAY);
  const [miniMonth, setMiniMonth] = useState(TODAY);
  const [view, setView] = useState<View>("week");
  const [listFilter, setListFilter] = useState<ListFilter | null>(null);
  const [enabled, setEnabled] = useState<CalendarId[]>([
    "personal",
    "team",
    "room",
  ]);
  const [settings, setSettings] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memory, setMemory] = useState(createDemoMemory);
  const [assistantSettingsOpen, setAssistantSettingsOpen] = useState(false);
  const [assistantSettings, setAssistantSettings] = useState(
    defaultAssistantSettings,
  );
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [panels, setPanels] = useState(readPanels);
  const [section, setSection] = useState(
    readPanels().main === "calendar" ? "calendar" : "analytics",
  );
  const [mainKind, setMainKind] = useState<Dashboard>(() => {
    const main = readPanels().main;
    return main === "calendar" ? "load" : main;
  });
  const [sharedPeriod, setSharedPeriod] = useState<Period>("week");
  const [analysisContext, setAnalysisContext] = useState<{
    id: number;
    title: string;
    text: string;
  }>();
  const [sidebar, setSidebar] = useState(false);
  const [config, setConfig] = useState(readLayout);
  const [state, setState] = useState<DataState>("ready");
  const analyticsData = useAnalyticsSnapshot(events, state);
  useEffect(() => {
    try {
      localStorage.setItem(
        PANELS_KEY,
        JSON.stringify({
          ...panels,
          main: section === "calendar" ? "calendar" : mainKind,
        }),
      );
    } catch {
      /* In-memory composition remains available. */
    }
  }, [panels, section, mainKind]);
  const [notice, setNotice] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const workspace = useRef<HTMLDivElement>(null);
  const moving = useRef(false);
  const layout = config.layout;
  const vertical = layout === "bottom" || layout === "top";
  const reversed = layout === "left" || layout === "top";
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(config));
    } catch {
      /* Layout remains usable when storage is unavailable. */
    }
  }, [config]);
  useEffect(() => {
    if (state !== "loading") return;
    const timer = setTimeout(() => setState("ready"), 1800);
    return () => clearTimeout(timer);
  }, [state]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const updateDate = (next: string) => {
    setDate(next);
    setMiniMonth(next);
  };
  const swap = () =>
    setConfig((c) => ({
      ...c,
      layout: (
        { right: "left", left: "right", top: "bottom", bottom: "top" } as const
      )[c.layout],
    }));
  function add(draft: Draft) {
    if (state !== "ready" && state !== "empty")
      return "Календарь недоступен. Восстановите доступ перед добавлением встречи.";
    if (
      events.some(
        (e) =>
          e.title === draft.title &&
          e.date === draft.date &&
          e.start === draft.start,
      )
    )
      return "Такая демо-встреча уже есть в календаре.";
    if (conflicts(state === "empty" ? [] : events, draft.people, draft))
      return "У выбранных демо-участников есть пересечение. Выберите другое время.";
    const event: Meeting = {
      organizer: "Алексей",
      ...draft,
      id: crypto.randomUUID(),
      color: "green",
      calendar: "personal",
      location: "Онлайн",
      created: true,
      participation: "organizer",
    };
    setEvents((old) => (state === "empty" ? [event] : [...old, event]));
    setState("ready");
    updateDate(draft.date);
    setSection("calendar");
    setView("day");
    setEnabled((old) =>
      old.includes("personal") ? old : [...old, "personal"],
    );
    setNotice("Демо-встреча добавлена. Приглашения не отправлялись.");
  }
  function resize(clientX: number, clientY: number) {
    const rect = workspace.current?.getBoundingClientRect();
    if (!rect) return;
    const size = vertical ? rect.height : rect.width;
    const offset = vertical ? clientY - rect.top : clientX - rect.left;
    const ratio = ((reversed ? size - offset : offset) / size) * 100;
    setConfig((c) => ({ ...c, ratio: Math.min(76, Math.max(35, ratio)) }));
  }
  function preset(value: string) {
    if (value === "planning") {
      setSection("calendar");
      setPanels((old) => ({ ...old, side: "load" }));
    }
    if (value === "review") {
      setSection("analytics");
      setMainKind("load");
      setPanels((old) => ({ ...old, side: "assistant" }));
    }
    if (value === "overview") {
      setSection("analytics");
      setMainKind("calendars");
      setPanels((old) => ({ ...old, side: "organizers" }));
    }
    setConfig((old) => ({ ...old, layout: "right", ratio: 58 }));
  }
  const explain = (title: string, text: string) => {
    setPanels((old) => ({ ...old, side: "assistant" }));
    setAnalysisContext({ id: Date.now(), title, text });
  };
  const dashboard = (
    kind: Dashboard,
    changeKind: (kind: Dashboard) => void,
  ) => (
    <Analytics
      kind={kind}
      changeKind={changeKind}
      date={date}
      linked={panels.linked}
      sharedPeriod={sharedPeriod}
      setSharedPeriod={setSharedPeriod}
      setDate={updateDate}
      data={analyticsData}
      select={setSelected}
      openCalendar={(event) => {
        updateDate(event.date);
        setView("day");
        setSection("calendar");
        setEnabled((old) =>
          old.includes(event.calendar) ? old : [...old, event.calendar],
        );
      }}
      explain={explain}
      empty={state === "empty"}
    />
  );
  const visibleEvents =
    state === "empty" ? [] : events.filter((e) => enabled.includes(e.calendar));
  return (
    <div className={`app-shell ${sidebar ? "sidebar-open" : ""}`}>
      <nav className="icon-rail" aria-label="Разделы Small">
        <div className="small-emblem" title="Small">
          <UsersRound size={22} />
        </div>
        <button
          className={section === "calendar" ? "active" : ""}
          aria-label="Календарь"
          onClick={() => setSection("calendar")}
        >
          <CalendarDays size={19} />
        </button>
        <button
          className={section === "analytics" ? "active" : ""}
          aria-label="Аналитика"
          title="Аналитика"
          onClick={() => setSection("analytics")}
        >
          <ChartNoAxesCombined size={19} />
        </button>
        <button
          className={`rail-memory ${memoryOpen ? "active" : ""}`}
          aria-label="Память ассистента"
          title="Память ассистента"
          aria-pressed={memoryOpen}
          onClick={() => {
            setSidebar(false);
            setMemoryOpen(true);
          }}
        >
          <Brain size={20} />
        </button>
        <button
          className={assistantSettingsOpen ? "active" : ""}
          aria-label="Настройки AI-помощника"
          title="Настройки AI-помощника"
          aria-pressed={assistantSettingsOpen}
          onClick={() => {
            setSidebar(false);
            setAssistantSettingsOpen(true);
          }}
        >
          <Sparkles size={20} />
        </button>
        <button
          className="rail-settings"
          aria-label="Настройки пространства"
          title="Настройки пространства"
          onClick={() => setSettings(true)}
        >
          <Settings2 size={19} />
        </button>
        {ProfileControl ?? (
          <>
            <button
              className="rail-avatar"
              aria-label="Профиль"
              title="Профиль"
              popoverTarget="profile-popover"
            >
              А
            </button>
            <div
              id="profile-popover"
              className="profile-popover"
              popover="auto"
            >
              <strong>Алексей</strong>
              <p>Демо-профиль</p>
            </div>
          </>
        )}
      </nav>
      <Sidebar
        showRooms={() => {
          setEnabled(["room"]);
          setSection("calendar");
        }}
        showAll={() => {
          setEnabled(["personal", "team", "room"]);
          setSection("calendar");
        }}
        date={date}
        setDate={updateDate}
        miniMonth={miniMonth}
        setMiniMonth={setMiniMonth}
        enabled={enabled}
        toggle={(id) =>
          setEnabled((old) =>
            old.includes(id) ? old.filter((c) => c !== id) : [...old, id],
          )
        }
        create={() => setCreating(true)}
        section={section}
        setSection={(s) => {
          setSection(s);
          setSidebar(false);
        }}
      />
      {sidebar && (
        <button
          className="sidebar-scrim"
          aria-label="Закрыть навигацию"
          onClick={() => setSidebar(false)}
        />
      )}
      <main className="main-shell">
        <header className="workspace-header">
          <div className="workspace-title">
            <button
              className="icon-button mobile-menu"
              aria-label="Открыть навигацию"
              onClick={() => setSidebar(!sidebar)}
            >
              <Menu size={20} />
            </button>
            <h1>Календарь Small</h1>
            <span className="prototype-tag">Демо-прототип</span>
          </div>
          <div className="inline">
            <button
              className="primary header-create"
              aria-label="Новая встреча"
              onClick={() => setCreating(true)}
            >
              Создать <Plus size={15} />
            </button>
          </div>
        </header>
        <div className="panel-tools" aria-label="Состав рабочего пространства">
          <label>
            Основная панель
            <select
              aria-label="Основная панель"
              value={section === "calendar" ? "calendar" : mainKind}
              onChange={(e) => {
                if (e.target.value === "calendar") setSection("calendar");
                else {
                  setMainKind(e.target.value as Dashboard);
                  setSection("analytics");
                }
              }}
            >
              <option value="calendar">Календарь</option>
              {Object.entries(dashboards).map(([id, title]) => (
                <option value={id} key={id}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Рядом
            <select
              aria-label="Соседняя панель"
              value={panels.side}
              onChange={(e) =>
                setPanels((old) => ({
                  ...old,
                  side: e.target.value as typeof old.side,
                }))
              }
            >
              <option value="assistant">Ассистент</option>
              {Object.entries(dashboards).map(([id, title]) => (
                <option value={id} key={id}>
                  {title}
                </option>
              ))}
              <option value="closed">Скрыть панель</option>
            </select>
          </label>
          <label className="linked-periods">
            <input
              type="checkbox"
              checked={panels.linked}
              onChange={(e) =>
                setPanels((old) => ({ ...old, linked: e.target.checked }))
              }
            />
            Связать периоды
          </label>
          <select
            aria-label="Готовая раскладка"
            value=""
            onChange={(e) => preset(e.target.value)}
          >
            <option value="" disabled>
              Раскладки
            </option>
            <option value="planning">Планирование</option>
            <option value="review">Разбор недели</option>
            <option value="overview">Обзор</option>
          </select>
        </div>
        <div
          ref={workspace}
          className={`workspace ${vertical ? "vertical" : ""} ${reversed ? "reversed" : ""} ${dragOver ? "drop-active" : ""} ${panels.side === "closed" ? "solo" : ""}`}
          data-layout={layout}
          style={
            { "--calendar-ratio": `${config.ratio}%` } as React.CSSProperties
          }
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("text/plain")) {
              e.preventDefault();
              setDragOver(true);
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node))
              setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (
              ["calendar", "assistant", "analytics"].includes(
                e.dataTransfer.getData("text/plain"),
              )
            )
              swap();
          }}
        >
          <div className="calendar-container">
            {section === "analytics" ? (
              dashboard(mainKind, setMainKind)
            ) : (
              <Calendar
                date={date}
                setDate={updateDate}
                listFilter={listFilter}
                setListFilter={setListFilter}
                view={view}
                setView={setView}
                events={visibleEvents}
                select={setSelected}
                change={(updated) => {
                  if (
                    conflicts(
                      events.filter((e) => e.id !== updated.id),
                      updated.people,
                      updated,
                    )
                  ) {
                    setNotice(
                      "Изменение отменено: у участников есть пересечение с другой встречей.",
                    );
                    return;
                  }
                  setEvents((old) =>
                    old.map((e) => (e.id === updated.id ? updated : e)),
                  );
                  setNotice("Время демо-встречи изменено.");
                }}
                state={state}
                retry={() => setState("loading")}
                swap={swap}
              />
            )}
          </div>
          {panels.side !== "closed" && (
            <div
              className="splitter"
              role="separator"
              tabIndex={0}
              aria-label="Размер панелей"
              aria-orientation={vertical ? "horizontal" : "vertical"}
              aria-valuemin={35}
              aria-valuemax={76}
              aria-valuenow={Math.round(config.ratio)}
              onPointerDown={(e) => {
                if (window.innerWidth < 760) return;
                moving.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                e.preventDefault();
              }}
              onPointerMove={(e) => {
                if (moving.current) resize(e.clientX, e.clientY);
              }}
              onPointerUp={(e) => {
                moving.current = false;
                if (e.currentTarget.hasPointerCapture(e.pointerId))
                  e.currentTarget.releasePointerCapture(e.pointerId);
              }}
              onPointerCancel={() => {
                moving.current = false;
              }}
              onKeyDown={(e) => {
                if (
                  !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                    e.key,
                  )
                )
                  return;
                e.preventDefault();
                const increase =
                  e.key === "ArrowRight" || e.key === "ArrowDown";
                setConfig((c) => ({
                  ...c,
                  ratio: Math.min(
                    76,
                    Math.max(35, c.ratio + (increase !== reversed ? 3 : -3)),
                  ),
                }));
              }}
            >
              <span />
            </div>
          )}
          {panels.side !== "closed" && (
            <div className="assistant-container">
              {panels.side === "assistant" ? (
                <AssistantPanel
                  showEventList={(filter) => {
                    setListFilter(filter);
                    updateDate(filter.from);
                    setView("list");
                    setSection("calendar");
                    return groupListEvents(visibleEvents, filter).reduce(
                      (sum, group) => sum + group.events.length,
                      0,
                    );
                  }}
                  events={events}
                  add={add}
                  state={state}
                  swap={swap}
                  analytics={() => setSection("analytics")}
                  analysisContext={analysisContext}
                />
              ) : (
                dashboard(panels.side, (kind) =>
                  setPanels((old) => ({ ...old, side: kind })),
                )
              )}
            </div>
          )}
        </div>
        <footer className="workspace-footer">
          <span>
            Small Calendar <span className="footer-dot">·</span> UI Validation
          </span>
          <span>Изменения встреч сбрасываются при перезагрузке</span>
        </footer>
      </main>
      {settings && (
        <SettingsDialog
          close={() => setSettings(false)}
          layout={layout}
          setLayout={(next) => setConfig((c) => ({ ...c, layout: next }))}
          state={state}
          setState={setState}
          reset={() => setConfig({ layout: "right", ratio: 68 })}
        />
      )}
      {creating && (
        <CreateDialog close={() => setCreating(false)} add={add} date={date} />
      )}
      {memoryOpen && (
        <MemorySettings
          memory={memory}
          change={setMemory}
          close={() => setMemoryOpen(false)}
        />
      )}
      {assistantSettingsOpen && (
        <AssistantSettingsDialog
          values={assistantSettings}
          close={() => setAssistantSettingsOpen(false)}
          save={(values) => {
            setAssistantSettings(values);
            setAssistantSettingsOpen(false);
          }}
        />
      )}
      {selected && (
        <EventDialog
          event={selected}
          close={() => setSelected(null)}
          remove={() => {
            setEvents((old) => old.filter((e) => e.id !== selected.id));
            setSelected(null);
            setNotice("Демо-встреча убрана из календаря.");
          }}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <span className="status-dot" />
          {notice}
        </div>
      )}
    </div>
  );
}
