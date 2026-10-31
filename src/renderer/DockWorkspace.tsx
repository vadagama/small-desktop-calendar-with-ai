import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DockviewReact,
  themeLight,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
  type IDockviewHeaderActionsProps,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { GripVertical } from "lucide-react";
import { WorkspaceSettings } from "./WorkspaceSettings";

export type Placement = "left" | "right" | "above" | "below";
const smallTheme = { ...themeLight, name: "small-prototype", gap: 6 };
const positions = {
  left: "left",
  right: "right",
  above: "top",
  below: "bottom",
} as const;
const opposite: Record<Placement, Placement> = {
  left: "right",
  right: "left",
  above: "below",
  below: "above",
};
const Panels = createContext<{ calendar: ReactNode; assistant: ReactNode }>({
  calendar: null,
  assistant: null,
});
const components = {
  calendar: () => useContext(Panels).calendar,
  assistant: () => useContext(Panels).assistant,
};
const Headers = createContext<{
  swap: () => void;
  assistantHeader: (element: HTMLDivElement | null) => void;
} | null>(null);
function PanelTab({ api }: IDockviewPanelHeaderProps) {
  return (
    <span className="dock-tab-label">
      <GripVertical size={14} />
      {api.title}
    </span>
  );
}
function HeaderActions({ activePanel }: IDockviewHeaderActionsProps) {
  const { swap, assistantHeader } = useContext(Headers)!;
  if (activePanel?.id === "assistant")
    return <div className="dock-header-actions" ref={assistantHeader} />;
  return (
    <div className="dock-header-actions">
      <span className="subtle">Asia/Almaty · UTC+5</span>
      <button
        className="icon-button"
        aria-label="Поменять панели местами"
        title="Поменять панели местами"
        onClick={swap}
      >
        <GripVertical size={15} />
      </button>
    </div>
  );
}

export function DockWorkspace({
  calendar,
  assistant,
  settingsOpen,
  hidden = false,
  closeSettings,
}: {
  hidden?: boolean;
  settingsOpen: boolean;
  closeSettings: () => void;
  calendar: (swap: () => void) => ReactNode;
  assistant: (swap: () => void, headerTarget: HTMLElement | null) => ReactNode;
}) {
  const api = useRef<DockviewApi | null>(null);
  const [assistantHeader, setAssistantHeader] = useState<HTMLDivElement | null>(
    null,
  );
  const [placement, setPlacement] = useState<Placement>("right");
  const ready = useCallback(({ api: dock }: DockviewReadyEvent) => {
    api.current = dock;
    dock.addPanel({
      id: "calendar",
      component: "calendar",
      title: "Календарь",
      minimumWidth: 300,
      minimumHeight: 160,
      renderer: "always",
    });
    dock.addPanel({
      id: "assistant",
      component: "assistant",
      title: "Ассистент",
      minimumWidth: 280,
      minimumHeight: 260,
      initialWidth: Math.max(280, dock.width * 0.32),
      position: { referencePanel: "calendar", direction: "right" },
      renderer: "always",
    });
    dock.onDidLayoutChange(() => {
      const c = dock
        .getPanel("calendar")!
        .group.element.getBoundingClientRect();
      const a = dock
        .getPanel("assistant")!
        .group.element.getBoundingClientRect();
      if (!c.width || !a.width) return;
      setPlacement(
        a.right <= c.left
          ? "left"
          : a.bottom <= c.top
            ? "above"
            : c.bottom <= a.top
              ? "below"
              : "right",
      );
    });
    dock.onWillShowOverlay((event) => {
      if (event.position === "center") event.preventDefault();
    });
  }, []);
  function move(next: Placement) {
    const dock = api.current;
    if (!dock) return;
    const target = dock.getPanel("calendar")!;
    dock
      .getPanel("assistant")!
      .api.moveTo({ group: target.group, position: positions[next] });
  }
  const swap = () => move(opposite[placement]);
  function resize(delta: number) {
    const panel = api.current?.getPanel("assistant");
    if (!panel) return;
    const vertical = placement === "above" || placement === "below";
    panel.group.api.setSize(
      vertical
        ? { height: panel.group.api.height + delta }
        : { width: panel.group.api.width + delta },
    );
  }
  return (
    <div
      className="dock-workspace"
      hidden={hidden}
      data-assistant-placement={placement}
    >
      <Panels.Provider
        value={{
          calendar: calendar(swap),
          assistant: assistant(swap, assistantHeader),
        }}
      >
        <Headers.Provider value={{ swap, assistantHeader: setAssistantHeader }}>
          <div className="small-dock">
            <DockviewReact
              components={components}
              defaultTabComponent={PanelTab}
              rightHeaderActionsComponent={HeaderActions}
              theme={smallTheme}
              disableFloatingGroups
              dndStrategy="pointer"
              onReady={ready}
              onWillDrop={(event) => {
                if (event.position === "center") event.preventDefault();
              }}
            />
          </div>
        </Headers.Provider>
      </Panels.Provider>
      {settingsOpen && (
        <WorkspaceSettings
          placement={placement}
          move={move}
          resize={resize}
          close={closeSettings}
        />
      )}
    </div>
  );
}
