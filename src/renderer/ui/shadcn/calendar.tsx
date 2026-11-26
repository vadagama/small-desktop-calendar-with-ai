import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, type ComponentProps } from "react";
import { DayPicker, type DayButton } from "react-day-picker";

function CalendarDayButton({
  day: _day,
  modifiers,
  ...props
}: ComponentProps<typeof DayButton>) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return <button ref={ref} type="button" {...props} />;
}

export function Calendar(props: ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      data-slot="calendar"
      showOutsideDays
      className="shadcn-calendar"
      components={{
        Chevron: ({ orientation, ...iconProps }) =>
          orientation === "left" ? (
            <ChevronLeft {...iconProps} />
          ) : (
            <ChevronRight {...iconProps} />
          ),
        DayButton: CalendarDayButton,
      }}
      {...props}
    />
  );
}
