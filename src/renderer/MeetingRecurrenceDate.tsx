import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { ru } from "react-day-picker/locale";
import { calendarToday, validCalendarDate } from "../shared/calendar-time.js";
import { Calendar } from "./ui/shadcn/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/shadcn/popover";

function calendarDay(value: string) {
  return new Date(value + "T12:00:00");
}

export function MeetingRecurrenceDate({
  value,
  min,
  max,
  invalid,
  disabled,
  overlayRoot,
  onChange,
}: {
  value: string;
  min?: string | undefined;
  max?: string | undefined;
  invalid: boolean;
  disabled: boolean;
  overlayRoot: HTMLDivElement | null;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const from = min ? calendarDay(min) : undefined;
  const to = max ? calendarDay(max) : undefined;
  const selected = validCalendarDate(value) ? calendarDay(value) : undefined;
  const firstMonth = invalid ? (from ?? to) : selected;
  return (
    <div className="meeting-until-field">
      <label htmlFor="meeting-until">Повторять до</label>
      <Popover open={open && !disabled} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id="meeting-until"
            className="shadcn-date-trigger"
            aria-invalid={invalid || undefined}
            aria-describedby="meeting-until-value meeting-recurrence-note"
            disabled={disabled}
          >
            <span id="meeting-until-value">
              {selected
                ? value.split("-").reverse().join(".")
                : "Выберите дату"}
            </span>
            <CalendarDays aria-hidden="true" />
          </button>
        </PopoverTrigger>
        {overlayRoot && (
          <PopoverContent
            container={overlayRoot}
            collisionBoundary={overlayRoot.parentElement}
            aria-label="Календарь повторений"
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <Calendar
              mode="single"
              locale={ru}
              labels={{
                labelPrevious: () => "Предыдущий месяц",
                labelNext: () => "Следующий месяц",
              }}
              required
              autoFocus
              today={calendarDay(calendarToday())}
              selected={invalid ? undefined : selected}
              defaultMonth={firstMonth}
              startMonth={from}
              endMonth={to}
              disabled={[
                ...(from ? [{ before: from }] : []),
                ...(to ? [{ after: to }] : []),
              ]}
              onSelect={(day) => {
                const year = day.getFullYear();
                const month = String(day.getMonth() + 1).padStart(2, "0");
                const date = String(day.getDate()).padStart(2, "0");
                onChange(`${year}-${month}-${date}`);
                setOpen(false);
              }}
            />
          </PopoverContent>
        )}
      </Popover>
    </div>
  );
}
