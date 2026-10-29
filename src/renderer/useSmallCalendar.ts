import { useEffect, useState } from "react";
import type {
  CalendarEvent,
  CalendarIssue,
  CalendarView,
  SmallCalendar,
} from "../shared/calendar.js";

export function useSmallCalendar(
  accountId: string | null,
  date: string,
  view: CalendarView,
  expired: () => void,
) {
  const [reload, setReload] = useState(0);
  const [selection, setSelection] = useState<{
    accountId: string | null;
    my: boolean;
    ids: string[];
  }>({ accountId: null, my: true, ids: [] });
  const [catalog, setCatalog] = useState<{
    accountId: string;
    calendars: SmallCalendar[];
    error: string;
  } | null>(null);
  const [result, setResult] = useState<{
    key: string;
    events: CalendarEvent[];
    issues: CalendarIssue[];
    error: string;
  } | null>(null);
  const my = selection.accountId === accountId ? selection.my : true;
  const ids = selection.accountId === accountId ? selection.ids : [];
  const key = JSON.stringify([accountId, date, view, my, ids, reload]);
  useEffect(() => {
    if (!accountId) {
      setCatalog(null);
      setResult(null);
      setSelection({ accountId: null, my: true, ids: [] });
      return;
    }
    let active = true;
    void window.smallDesktop.calendar
      .calendars({ accountId })
      .then((reply) => {
        if (!active) return;
        if (!reply.ok && reply.kind === "auth") expired();
        setCatalog({
          accountId,
          calendars: reply.ok ? reply.data : [],
          error: reply.ok ? "" : reply.error,
        });
      })
      .catch(() => {
        if (active)
          setCatalog({
            accountId,
            calendars: [],
            error: "Не удалось загрузить список календарей Small.",
          });
      });
    return () => {
      active = false;
    };
  }, [accountId, reload, expired]);
  useEffect(() => {
    if (!accountId) return;
    let active = true;
    void window.smallDesktop.calendar
      .events({ accountId, date, view, myCalendar: my, calendarIds: ids })
      .then((reply) => {
        if (!active) return;
        if (!reply.ok && reply.kind === "auth") expired();
        setResult({
          key,
          events: reply.ok ? reply.data.events : [],
          issues: reply.ok ? reply.data.issues : [],
          error: reply.ok ? "" : reply.error,
        });
      })
      .catch(() => {
        if (active)
          setResult({
            key,
            events: [],
            issues: [],
            error: "Не удалось загрузить события Small. Занятость неизвестна.",
          });
      });
    return () => {
      active = false;
    };
    // key includes every query field; a changed key hides the old result immediately.
  }, [key, expired]);
  const current = result?.key === key && accountId ? result : null;
  const list = catalog?.accountId === accountId ? catalog : null;
  return {
    calendars: list?.calendars ?? [],
    catalogError: list?.error ?? "",
    my,
    ids,
    events: current?.events ?? [],
    issues: current?.issues ?? [],
    error: current?.error ?? "",
    loading: Boolean(accountId) && !current,
    refresh: () => setReload((value) => value + 1),
    setMy: (next: boolean) => setSelection({ accountId, my: next, ids }),
    toggle: (id: string) =>
      setSelection({
        accountId,
        my: false,
        ids: ids.includes(id)
          ? ids.filter((value) => value !== id)
          : [...ids, id].slice(0, 8),
      }),
  };
}
