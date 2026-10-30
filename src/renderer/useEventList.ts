import { startTransition, useEffect, useState } from "react";
import type { CalendarView } from "../shared/calendar.js";
import type { EventListResult } from "../shared/event-list.js";

export function useEventList(
  accountId: string | null,
  setDate: (date: string) => void,
  setView: (view: CalendarView) => void,
) {
  const [active, setActive] = useState(false);
  const [result, setResult] = useState<EventListResult | null>(null);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    setResult(null);
    setStale(false);
    return window.smallDesktop.calendar.subscribeEventList((next) => {
      if (!accountId || next.accountId !== accountId) return;
      setResult(next);
      setStale(false);
      setDate(next.query.from);
      setView("month");
      setActive(true);
    });
  }, [accountId, setDate, setView]);
  useEffect(
    () =>
      window.smallDesktop.calendar.subscribe((change) => {
        if (!result) return;
        if (
          change.type === "events" &&
          change.query.accountId === accountId &&
          Object.values(change.diff).some((keys) => keys.length > 0)
        )
          startTransition(() => setStale(true));
        if (change.type === "status" && change.status !== "online")
          startTransition(() => setStale(true));
      }),
    [accountId, result],
  );
  return {
    active,
    setActive,
    result: result?.accountId === accountId ? result : null,
    stale,
    clear: () => {
      setResult(null);
      setStale(false);
    },
  };
}
