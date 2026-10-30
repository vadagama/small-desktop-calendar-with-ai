import type { ComponentProps } from "react";
import { Calendar as SharedCalendar } from "../../src/renderer/ui/CalendarView";
import { EventList } from "./EventList";
import type { View } from "./types";
import type { ListFilter } from "./event-list";
type Props = Omit<ComponentProps<typeof SharedCalendar>, "view" | "setView"> & {
  view: View;
  setView: (view: View) => void;
  listFilter: ListFilter | null;
  setListFilter: (filter: ListFilter | null) => void;
};
export function Calendar({
  view,
  setView,
  listFilter,
  setListFilter,
  ...props
}: Props) {
  return (
    <SharedCalendar
      {...props}
      view={view === "list" ? "month" : view}
      setView={setView}
      setDate={(date) => {
        setListFilter(null);
        props.setDate(date);
      }}
      listView={{
        active: view === "list",
        open: () => setView("list"),
        content: (
          <EventList
            key={`${listFilter?.from ?? props.date}:${listFilter?.to ?? ""}:${listFilter?.organizer ?? ""}`}
            events={props.events}
            date={props.date}
            filter={listFilter}
            changeFilter={setListFilter}
            select={props.select}
          />
        ),
      }}
    />
  );
}
