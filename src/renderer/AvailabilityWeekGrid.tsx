import { useLayoutEffect, useRef } from "react";
import {
  availabilityWindowAt,
  commonAvailability,
} from "../shared/availability-analysis.js";
import { calendarRange } from "../shared/calendar-time.js";
import type { CalendarPerson } from "../shared/calendar.js";
import type {
  AvailabilityAnalysis,
  AvailabilityInterval,
  TimeInterval,
} from "../shared/availability-analysis.js";
export const availabilityTime = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
export const availabilityDateLabel = (date: string) =>
  new Date(date + "T12:00:00Z").toLocaleDateString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
export interface AvailabilityChoice extends TimeInterval {
  people: CalendarPerson[];
}
export function AvailabilityWeekGrid({
  data,
  people,
  commonOnly,
  choose,
  disabled,
}: {
  data: AvailabilityAnalysis;
  people: CalendarPerson[];
  commonOnly: boolean;
  choose: (selection: AvailabilityChoice) => void;
  disabled: boolean;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollLeft = 512;
  }, []);
  function track(
    date: string,
    intervals: AvailabilityInterval[],
    who: CalendarPerson[],
    common: TimeInterval[],
    organizerIntervals: AvailabilityInterval[],
  ) {
    const midnight = Date.parse(calendarRange(date, "day").start);
    const personalWindows = commonAvailability(
      [intervals, organizerIntervals],
      data.query.durationMinutes,
    );
    const pieces = intervals.flatMap((interval) => {
      const start = Date.parse(interval.start),
        end = Date.parse(interval.end);
      const points = [
        ...new Set([
          start,
          end,
          ...[...common, ...personalWindows]
            .flatMap((i) => [Date.parse(i.start), Date.parse(i.end)])
            .filter((p) => p > start && p < end),
        ]),
      ].sort((a, b) => a - b);
      return points.slice(0, -1).map((a, index) => ({
        start: a,
        end: points[index + 1]!,
        state: interval.state,
      }));
    });
    return pieces.map((i, index) => {
      const group =
        i.state === "free"
          ? common.find(
              (w) =>
                Date.parse(w.start) <= i.start && Date.parse(w.end) >= i.end,
            )
          : undefined;
      const selection =
        i.state === "free"
          ? availabilityWindowAt(
              {
                start: new Date(i.start).toISOString(),
                end: new Date(i.end).toISOString(),
              },
              personalWindows,
              common,
              data.query.durationMinutes,
            )
          : undefined;
      const state = group ? "common" : i.state;
      const label = {
        free: "Свободен",
        common: "Свободны все",
        busy: "Занят",
        unknown: "Нет данных",
        "outside-hours": "Вне рабочего времени или окна поиска",
      }[state];
      const start = new Date(i.start).toISOString(),
        end = new Date(i.end).toISOString();
      const title = `${who.map((p) => p.name).join(", ")}, ${availabilityDateLabel(date)}, ${availabilityTime(start)}–${availabilityTime(end)}: ${label}${i.state === "free" && !selection ? `; нет подтверждённого окна на ${data.query.durationMinutes} мин с организатором` : ""}`;
      const style = {
        left: ((i.start - midnight) / 60000 / 60) * 64,
        width: ((i.end - i.start) / 60000 / 60) * 64,
      };
      const content =
        i.state === "unknown"
          ? style.width >= 80
            ? "Нет данных"
            : ""
          : i.state === "outside-hours"
            ? ""
            : i.end - i.start >= 90 * 60000
              ? `${availabilityTime(start)}–${availabilityTime(end)}`
              : i.end - i.start >= 60 * 60000
                ? availabilityTime(start)
                : "";
      return selection ? (
        <button
          key={index}
          type="button"
          className={`slot ${state}`}
          style={style}
          title={title}
          aria-label={title}
          disabled={disabled}
          onClick={() =>
            choose({
              start: selection.start,
              end: selection.end,
              people: selection.common ? people : who,
            })
          }
        >
          {content && (
            <span className="availability-slot-label">{content}</span>
          )}
        </button>
      ) : (
        <span
          key={index}
          className={`slot ${state}`}
          style={style}
          role="img"
          aria-label={title}
          title={title}
        >
          {content && (
            <span className="availability-slot-label">{content}</span>
          )}
        </span>
      );
    });
  }
  return (
    <div
      className="demo-grid-scroll"
      ref={scroll}
      tabIndex={0}
      aria-label="Часы 00–24 и даты, прокрутка"
    >
      <table className="availability-grid">
        <caption>
          Часы горизонтально, даты и участники вертикально. Asia/Almaty.
        </caption>
        <colgroup>
          <col className="demo-name-column" />
          <col className="demo-time-column" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Участники · GMT+5</th>
            <th className="demo-hour-axis" scope="col">
              <div>
                {Array.from({ length: 25 }, (_, hour) => (
                  <span
                    key={hour}
                    className={hour === 24 ? "last-hour" : ""}
                    style={{ left: hour === 24 ? undefined : hour * 64 }}
                  >
                    {String(hour).padStart(2, "0")}
                  </span>
                ))}
              </div>
            </th>
          </tr>
        </thead>
        {data.days.map((day) => (
          <tbody key={day.date}>
            <tr>
              <th colSpan={2} scope="rowgroup" className="demo-date-heading">
                <div>{availabilityDateLabel(day.date)}</div>
              </th>
            </tr>
            {(commonOnly ? [null] : people).map((person) => {
              const participant = person
                ? day.participants.find(
                    (p) => p.participantId === person.participantId,
                  )
                : undefined;
              const intervals = person
                ? (participant?.intervals ?? [])
                : day.commonWindows.map((w) => ({
                    ...w,
                    state: "free" as const,
                  }));
              return (
                <tr key={person?.participantId ?? "common"}>
                  <th scope="row" className="demo-person-heading">
                    <div className="demo-person-title">
                      <span className="demo-avatar" aria-hidden>
                        {person
                          ? person.name
                              .split(/\s+/)
                              .slice(0, 2)
                              .map((p) => p[0])
                              .join("")
                          : people.length}
                      </span>
                      <span>
                        <span className="demo-person-name" title={person?.name}>
                          {person?.name ?? "Свободны все"}
                        </span>
                        <span className="demo-person-info">
                          {person?.position ?? `${people.length} участников`}
                        </span>
                      </span>
                    </div>
                  </th>
                  <td className="demo-cells">
                    <div className="demo-day-track">
                      {track(
                        day.date,
                        intervals,
                        person ? [person] : people,
                        day.commonWindows,
                        day.participants.find(
                          (p) =>
                            p.participantId ===
                            data.query.organizerParticipantId,
                        )?.intervals ?? [],
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}
