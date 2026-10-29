import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  describeFreshness,
  type CalendarFreshnessInput,
} from "../shared/calendar-freshness.js";

function useNow(periodMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), periodMs);
    return () => window.clearInterval(timer);
  }, [periodMs]);
  return now;
}

export function CalendarFreshnessBar({
  fetchedAt,
  offline,
  refreshError,
  refreshing,
  refresh,
}: Omit<CalendarFreshnessInput, "now"> & { refresh: () => void }) {
  const now = useNow(30_000);
  const label = describeFreshness({
    fetchedAt,
    now,
    offline,
    refreshError,
    refreshing,
  });
  if (!label) return null;
  return (
    <div
      className={`calendar-freshness calendar-freshness-${label.tone}`}
      // The age text ticks every 30 s; only problems are worth announcing.
      role={label.tone === "warning" ? "status" : undefined}
    >
      <span className="calendar-freshness-dot" aria-hidden="true" />
      <span>{label.text}</span>
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
