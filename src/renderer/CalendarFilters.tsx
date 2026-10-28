import { RefreshCw } from "lucide-react";
import type { useSmallCalendar } from "./useSmallCalendar";

export function CalendarFilters({
  calendar,
  enabled,
}: {
  calendar: ReturnType<typeof useSmallCalendar>;
  enabled: boolean;
}) {
  return (
    <aside className="sidebar" aria-label="Календари Small">
      <div className="sidebar-tabs">
        <strong>Календари</strong>
      </div>
      <div className="small-calendar-filters">
        <label className="calendar-choice">
          <input
            type="radio"
            name="calendar-mode"
            checked={calendar.my}
            onChange={() => calendar.setMy(true)}
          />
          Мой календарь
        </label>
        <label className="calendar-choice">
          <input
            type="radio"
            name="calendar-mode"
            checked={!calendar.my}
            onChange={() => calendar.setMy(false)}
          />
          Публичные календари
        </label>
        {!calendar.my && (
          <>
            <p className="form-note">Выберите до 8 календарей.</p>
            {calendar.calendars.map((entry) => (
              <label key={entry.id} className="calendar-choice">
                <input
                  type="checkbox"
                  checked={calendar.ids.includes(entry.id)}
                  disabled={
                    !calendar.ids.includes(entry.id) && calendar.ids.length >= 8
                  }
                  onChange={() => calendar.toggle(entry.id)}
                />
                {entry.name}
              </label>
            ))}
          </>
        )}
        {calendar.catalogError && (
          <p className="form-error" role="alert">
            {calendar.catalogError}
          </p>
        )}
        <button
          className="secondary"
          disabled={!enabled}
          onClick={calendar.refresh}
        >
          <RefreshCw size={15} />
          Обновить
        </button>
        <p className="form-note">Asia/Almaty · только чтение</p>
      </div>
    </aside>
  );
}
