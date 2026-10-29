import { RefreshCw } from "lucide-react";
import {
  describeFreshness,
  type CalendarFreshnessInput,
} from "../shared/calendar-freshness.js";

/** Shown only when the data on screen may be out of date; otherwise it renders nothing. */
export function CalendarFreshnessBar({
  fetchedAt,
  offline,
  refreshError,
  refreshing,
  refresh,
}: CalendarFreshnessInput & { refreshing: boolean; refresh: () => void }) {
  const text = describeFreshness({ fetchedAt, offline, refreshError });
  if (!text) return null;
  return (
    <div
      className="calendar-freshness calendar-freshness-warning"
      role="status"
    >
      <span className="calendar-freshness-dot" aria-hidden="true" />
      <span>{text}</span>
      <button
        className="secondary"
        aria-label="Обновить календарь"
        disabled={refreshing}
        onClick={refresh}
      >
        <RefreshCw size={14} className={refreshing ? "spinning" : undefined} />
        Обновить
      </button>
    </div>
  );
}
