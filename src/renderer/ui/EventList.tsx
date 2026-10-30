import { CalendarDays, Repeat2, X } from "lucide-react";
import { useEventTooltip } from "./useEventTooltip";
import { dateLabel, time } from "./calendar";
import { groupListEvents, monthRange, type ListFilter } from "./event-list";
import type { Meeting } from "./types";
import "./event-list.css";
export function EventList({
  events,
  date,
  filter,
  changeFilter,
  select,
  complete = true,
  organizerAlreadyFiltered = false,
}: {
  complete?: boolean;
  organizerAlreadyFiltered?: boolean;
  events: Meeting[];
  date: string;
  filter: ListFilter | null;
  changeFilter: (filter: ListFilter | null) => void;
  select: (event: Meeting) => void;
}) {
  const tooltip = useEventTooltip();
  const range = filter ?? monthRange(date);
  const groups = groupListEvents(
    events,
    organizerAlreadyFiltered ? { from: range.from, to: range.to } : range,
  );
  const count = groups.reduce((total, group) => total + group.events.length, 0);
  return (
    <div className="event-list-view">
      {range.organizer && (
        <div className="event-list-chips" aria-label="Активные фильтры">
          <button
            className="list-filter-chip"
            aria-label="Убрать фильтр организатора"
            onClick={() => changeFilter(null)}
          >
            Организатор: {range.organizer}
            <X size={13} />
          </button>
        </div>
      )}
      <div className="event-list-summary" role="status">
        {complete ? "Найдено событий" : "Загружено событий"}: {count}
      </div>
      <div className="event-list-scroll" aria-label="События по дням">
        {!groups.length && (
          <div className="state-screen">
            <CalendarDays size={26} />
            <h3>
              {complete ? "Событий не найдено" : "Результаты поиска неполные"}
            </h3>
            <p>
              {complete
                ? "В этом периоде и выбранных календарях нет совпадений. Измените месяц или фильтры."
                : "Не удалось проверить все события. Повторите запрос ассистенту."}
            </p>
          </div>
        )}
        {groups.map((group) => (
          <section
            className="event-list-day"
            key={group.date}
            aria-label={dateLabel(group.date)}
          >
            <h3>
              <time dateTime={group.date}>
                {dateLabel(group.date, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  weekday: "long",
                })}
              </time>
              <span>{group.events.length}</span>
            </h3>
            <ul>
              {group.events.map((event) => (
                <li key={event.id}>
                  <button
                    className={`event-list-row calendar-${event.calendar}`}
                    {...tooltip.bind(event)}
                    onClick={() => {
                      tooltip.hide();
                      select(event);
                    }}
                  >
                    <span className="list-calendar-dot" aria-hidden="true" />
                    <span className="list-event-time">
                      {event.timeLabel ??
                        `${time(event.start)}–${time(event.start + event.duration)}`}
                    </span>
                    <span className="list-event-content">
                      <strong>
                        {event.recurring && (
                          <Repeat2
                            size={12}
                            aria-label="Повторяющееся событие"
                          />
                        )}{" "}
                        {event.title}
                      </strong>
                      <small>
                        Организатор: {event.organizer} ·{" "}
                        {event.calendarLabel ??
                          {
                            personal: "Мой календарь",
                            team: "Команда",
                            room: "Переговорные",
                          }[event.calendar]}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {tooltip.tooltip}
    </div>
  );
}
