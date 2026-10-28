import { useEffect, useRef, useState } from "react";
import {
  Menu,
  CalendarDays,
  ChartNoAxesCombined,
  Settings2,
  Plus,
  UsersRound,
} from "lucide-react";
import { Calendar } from "./CalendarView";
import { Sidebar } from "./Sidebar";
import { Assistant } from "./Assistant";
import { Analytics } from "./Analytics";
import { CreateDialog, EventDialog, SettingsDialog } from "./Dialogs";
import { conflicts, TODAY } from "./calendar";
import { DEMO_EVENTS } from "./data";
import type {
  CalendarId,
  DataState,
  Draft,
  Layout,
  Meeting,
  View,
} from "./types";
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
export default function App() {
  const [events, setEvents] = useState<Meeting[]>(DEMO_EVENTS);
  const [date, setDate] = useState(TODAY);
  const [miniMonth, setMiniMonth] = useState(TODAY);
  const [view, setView] = useState<View>("week");
  const [enabled, setEnabled] = useState<CalendarId[]>([
    "personal",
    "team",
    "room",
  ]);
  const [settings, setSettings] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [section, setSection] = useState("calendar");
  const [sidebar, setSidebar] = useState(false);
  const [config, setConfig] = useState(readLayout);
  const [state, setState] = useState<DataState>("ready");
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
          aria-label="Обзор недели"
          onClick={() => setSection("analytics")}
        >
          <ChartNoAxesCombined size={19} />
        </button>
        <button
          className="rail-settings"
          aria-label="Настройки пространства"
          title="Настройки пространства"
          onClick={() => setSettings(true)}
        >
          <Settings2 size={19} />
        </button>
        <button
          className="rail-avatar"
          aria-label="Профиль"
          title="Профиль"
          popoverTarget="profile-popover"
        >
          А
        </button>
        <div id="profile-popover" className="profile-popover" popover="auto">
          <strong>Алексей</strong>
          <p>Демо-профиль</p>
        </div>
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
        <div
          ref={workspace}
          className={`workspace ${vertical ? "vertical" : ""} ${reversed ? "reversed" : ""} ${dragOver ? "drop-active" : ""}`}
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
              ["calendar", "assistant"].includes(
                e.dataTransfer.getData("text/plain"),
              )
            )
              swap();
          }}
        >
          <div className="calendar-container">
            {section === "analytics" ? (
              <Analytics
                events={visibleEvents}
                date={date}
                back={() => setSection("calendar")}
              />
            ) : (
              <Calendar
                date={date}
                setDate={updateDate}
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
              const increase = e.key === "ArrowRight" || e.key === "ArrowDown";
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
          <div className="assistant-container">
            <Assistant
              events={events}
              add={add}
              state={state}
              swap={swap}
              analytics={() => setSection("analytics")}
            />
          </div>
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
