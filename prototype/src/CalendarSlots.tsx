import { useEffect, useRef, useState } from "react";
import { calendarSelection } from "./calendar-selection";
import { dateLabel, time } from "./calendar";
import type { Slot } from "./types";

export function CalendarSlots({
  date,
  create,
  disabled = false,
}: {
  date: string;
  disabled?: boolean;
  create: (slot: Slot) => void;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ anchor: number; y: number; moved: boolean } | null>(
    null,
  );
  const [preview, setPreview] = useState<ReturnType<
    typeof calendarSelection
  > | null>(null);
  const [focused, setFocused] = useState(18);
  function cancel() {
    gesture.current = null;
    setPreview(null);
  }
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", cancel);
    };
  }, []);
  useEffect(cancel, [date]);
  function selection(y: number) {
    const g = gesture.current!;
    return calendarSelection(
      g.anchor,
      g.moved
        ? (y - grid.current!.getBoundingClientRect().top) / (64 / 60)
        : undefined,
    );
  }
  return (
    <div
      ref={grid}
      className="calendar-slots"
      onPointerDown={(e) => {
        if (disabled || e.button !== 0 || !e.isPrimary) return;
        const cell = (e.target as HTMLElement).closest<HTMLButtonElement>(
          "[data-create-start]",
        );
        if (!cell) return;
        e.preventDefault();
        cell.focus({ preventScroll: true });
        gesture.current = {
          anchor: Number(cell.dataset.createStart),
          y: e.clientY,
          moved: false,
        };
        setPreview(calendarSelection(gesture.current.anchor));
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const g = gesture.current;
        if (!g) return;
        if (Math.abs(e.clientY - g.y) >= 5) g.moved = true;
        if (g.moved) setPreview(selection(e.clientY));
      }}
      onPointerUp={(e) => {
        if (disabled || !gesture.current) return;
        const next = selection(e.clientY);
        cancel();
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
        create({ date, ...next });
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
    >
      {Array.from({ length: 48 }, (_, i) => (
        <button
          key={i}
          type="button"
          disabled={disabled}
          className="calendar-slot"
          data-create-start={i * 30}
          aria-label={`Создать событие ${dateLabel(date)} в ${time(i * 30)}`}
          tabIndex={focused === i ? 0 : -1}
          onFocus={() => setFocused(i)}
          onClick={(e) => {
            if (!disabled && e.detail === 0)
              create({ date, ...calendarSelection(i * 30) });
          }}
          onKeyDown={(e) => {
            const next =
              e.key === "ArrowDown"
                ? Math.min(47, i + 1)
                : e.key === "ArrowUp"
                  ? Math.max(0, i - 1)
                  : e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? 47
                      : null;
            if (next === null) return;
            e.preventDefault();
            grid.current
              ?.querySelector<HTMLButtonElement>(
                `[data-create-start="${next * 30}"]`,
              )
              ?.focus();
          }}
        />
      ))}
      {preview && (
        <div
          className="calendar-selection"
          role="status"
          style={{
            top: preview.start * (64 / 60),
            height: preview.duration * (64 / 60),
          }}
        >
          <strong>
            {time(preview.start)} – {time(preview.start + preview.duration)}
          </strong>
          <span>{preview.duration} мин</span>
        </div>
      )}
    </div>
  );
}
