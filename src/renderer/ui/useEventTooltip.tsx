import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { time } from "./calendar";
import type { Meeting } from "./types";

export function useEventTooltip() {
  const id = useId();
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [active, setActive] = useState<{
    event: Meeting;
    x: number;
    y: number;
    anchorTop: number;
  } | null>(null);
  function cancel() {
    clearTimeout(timer.current);
  }
  function hide() {
    cancel();
    setActive(null);
  }
  function leave() {
    cancel();
    timer.current = setTimeout(() => setActive(null), 120);
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    window.addEventListener("pointerdown", hide, true);
    window.addEventListener("keydown", key);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      cancel();
      window.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);
  function show(event: Meeting, target: HTMLElement) {
    cancel();
    const r = target.getBoundingClientRect();
    const width = Math.min(260, window.innerWidth - 16);
    const x = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const y = r.bottom + 6;
    timer.current = setTimeout(
      () => setActive({ event, x, y, anchorTop: r.top }),
      300,
    );
  }
  useLayoutEffect(() => {
    const element = tooltipRef.current;
    if (!active || !element) return;
    element.showPopover();
    const height = element.getBoundingClientRect().height;
    const y =
      active.y + height > window.innerHeight - 8
        ? Math.max(8, active.anchorTop - height - 6)
        : active.y;
    element.style.top = `${y}px`;
  }, [active]);
  return {
    hide,
    bind: (event: Meeting) => ({
      "aria-describedby": active?.event.id === event.id ? id : undefined,
      onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
        if (e.buttons === 0) show(event, e.currentTarget);
      },
      onFocus: (e: React.FocusEvent<HTMLElement>) => {
        if (e.currentTarget.matches(":focus-visible"))
          show(event, e.currentTarget);
      },
      onMouseLeave: leave,
      onBlur: hide,
    }),
    tooltip:
      active &&
      createPortal(
        <div
          ref={tooltipRef}
          id={id}
          role="tooltip"
          popover="manual"
          className="event-tooltip"
          style={{ left: active.x, top: active.y }}
          onMouseEnter={cancel}
          onMouseLeave={leave}
        >
          <strong>{active.event.title}</strong>
          <p>
            {active.event.timeLabel ??
              `${time(active.event.start)}–${time(active.event.start + active.event.duration)}`}{" "}
            · {active.event.duration} мин
          </p>
          <p>Организатор: {active.event.organizer}</p>
        </div>,
        document.body,
      ),
  };
}
