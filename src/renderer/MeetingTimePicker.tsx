import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { clockMinutes } from "../shared/meeting-time.js";
import "./meeting-time.css";

const times = Array.from(
  { length: 96 },
  (_, index) =>
    `${String(Math.floor(index / 4)).padStart(2, "0")}:${String((index % 4) * 15).padStart(2, "0")}`,
);

export function MeetingTimePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const field = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const options =
    Number.isFinite(clockMinutes(value)) && !times.includes(value)
      ? [...times, value].sort()
      : times;

  function show() {
    const menu = popup.current,
      anchor = field.current;
    if (!menu || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const height = Math.min(224, Math.max(below, above));
    menu.style.left = `${Math.min(rect.left, window.innerWidth - Math.max(rect.width, 112) - 12)}px`;
    menu.style.top = `${below >= height ? rect.bottom + 4 : rect.top - height - 4}px`;
    menu.style.width = `${Math.max(rect.width, 112)}px`;
    menu.style.maxHeight = `${height}px`;
    setActive(Math.max(0, options.indexOf(value)));
    menu.showPopover();
    input.current?.focus();
  }
  function select(time: string) {
    onChange(time);
    popup.current?.hidePopover();
    input.current?.focus();
  }
  useLayoutEffect(() => {
    if (!open) return;
    popup.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [open, active]);
  useEffect(() => {
    if (!open) return;
    const close = () => popup.current?.hidePopover();
    const scroll = (event: Event) => {
      if (
        event.target instanceof Node &&
        !popup.current?.contains(event.target)
      )
        close();
    };
    window.addEventListener("resize", close);
    document.addEventListener("scroll", scroll, true);
    return () => {
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [open]);
  return (
    <div className="meeting-time-picker" ref={field}>
      <input
        ref={input}
        aria-label={label}
        role="combobox"
        aria-autocomplete="none"
        aria-expanded={open}
        aria-controls={id}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        type="text"
        inputMode="numeric"
        placeholder="ЧЧ:ММ"
        required
        maxLength={5}
        pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
        value={value}
        onClick={show}
        onChange={(event) => {
          onChange(event.target.value);
          popup.current?.hidePopover();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            popup.current?.hidePopover();
          } else if (event.key === "Tab") popup.current?.hidePopover();
          else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            if (!open) show();
            else
              setActive((index) =>
                Math.max(
                  0,
                  Math.min(
                    options.length - 1,
                    index + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                ),
              );
          } else if (open && event.key === "Enter") {
            event.preventDefault();
            select(options[active]!);
          } else if (open && ["Home", "End"].includes(event.key)) {
            event.preventDefault();
            setActive(event.key === "Home" ? 0 : options.length - 1);
          }
        }}
      />
      <button
        type="button"
        aria-label={`Выбрать время: ${label.toLowerCase()}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => (open ? popup.current?.hidePopover() : show())}
      >
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      <div
        ref={popup}
        id={id}
        popover="auto"
        role="listbox"
        aria-label={`Время: ${label.toLowerCase()}`}
        className="meeting-time-options"
        onToggle={(event) => setOpen(event.newState === "open")}
      >
        {options.map((time, index) => (
          <button
            key={time}
            id={`${id}-${index}`}
            data-index={index}
            type="button"
            role="option"
            aria-selected={time === value}
            tabIndex={-1}
            data-active={active === index}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => select(time)}
          >
            {time}
          </button>
        ))}
      </div>
    </div>
  );
}
