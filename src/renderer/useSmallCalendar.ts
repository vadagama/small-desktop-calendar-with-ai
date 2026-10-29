import { startTransition, useEffect, useRef, useState } from "react";
import type {
  CalendarEvent,
  CalendarView,
  SmallCalendar,
} from "../shared/calendar.js";
import { isEmptyDiff } from "../shared/calendar-diff.js";
import type { EventInvalidation } from "../shared/calendar-invalidation.js";
import {
  adoptConfirmedEvents,
  calendarQueryKey,
  insertCalendarEvent,
  deriveCalendarView,
  pruneAffectedCalendarStore,
  sameCalendarQuery,
  storeCalendarResult,
  type CalendarConnection,
  type CalendarFailure,
  type CalendarStore,
} from "../shared/calendar-view-state.js";

export function useSmallCalendar(
  accountId: string | null,
  date: string,
  view: CalendarView,
  expired: () => void,
) {
  const [reload, setReload] = useState(0);
  // A manual refresh or a reload after a write must reach Small; navigation may use the cache.
  const forced = useRef(false);
  const refreshedAt = useRef(0);
  // Events this session inserted itself after Small confirmed a create, until a read returns them.
  const ownEvents = useRef(new Set<string>());
  const takeOwnEvents = (confirmed: { key: string }[]) => {
    const mine = new Set(ownEvents.current);
    for (const event of confirmed) ownEvents.current.delete(event.key);
    return mine;
  };
  // Only the user's own refresh asks Small for the calendar list again; a write cannot change it.
  const manual = useRef(false);
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
  const [store, setStore] = useState<CalendarStore>({});
  const [failure, setFailure] = useState<CalendarFailure | null>(null);
  const [connection, setConnection] = useState<CalendarConnection>("online");
  const [pending, setPending] = useState(false);
  const my = selection.accountId === accountId ? selection.my : true;
  const ids = selection.accountId === accountId ? selection.ids : [];
  // `reload` is deliberately not part of the key: a refresh keeps the events on screen.
  const key = calendarQueryKey({ accountId, date, view, my, ids });
  useEffect(() => {
    setStore({});
    setFailure(null);
    setConnection("online");
  }, [accountId]);
  useEffect(() => {
    if (!accountId) {
      setCatalog(null);
      setSelection({ accountId: null, my: true, ids: [] });
      return;
    }
    let active = true;
    const refresh = manual.current;
    manual.current = false;
    void window.smallDesktop.calendar
      .calendars({ accountId, ...(refresh ? { refresh } : {}) })
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
    const allowStale = !forced.current;
    forced.current = false;
    setPending(true);
    void window.smallDesktop.calendar
      .events({
        accountId,
        date,
        view,
        myCalendar: my,
        calendarIds: ids,
        allowStale,
      })
      .then((reply) => {
        if (!active) return;
        if (!reply.ok && reply.kind === "auth") expired();
        if (reply.ok) {
          const mine = takeOwnEvents(reply.data.events);
          setStore((previous) =>
            storeCalendarResult(
              adoptConfirmedEvents(previous, key, mine, reply.data.events),
              key,
              reply.data,
              Date.now(),
            ),
          );
          setFailure(null);
        } else setFailure({ key, message: reply.error });
      })
      .catch(() => {
        if (active)
          setFailure({
            key,
            message:
              "Не удалось загрузить события Small. Занятость неизвестна.",
          });
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
    // key includes every query field; a changed key hides the old result immediately.
  }, [key, reload, expired]);
  useEffect(() => {
    if (!accountId) return;
    return window.smallDesktop.calendar.subscribe((change) => {
      if (change.type === "status") {
        setConnection(change.status === "offline" ? "offline" : "online");
        if (change.status === "auth-expired") expired();
        return;
      }
      if (!sameCalendarQuery(change.query, { accountId, date, view, my, ids }))
        return;
      const mine = takeOwnEvents(change.result.events);
      const apply = () => {
        setStore((previous) =>
          storeCalendarResult(
            adoptConfirmedEvents(previous, key, mine, change.result.events),
            key,
            change.result,
            Date.now(),
          ),
        );
        setFailure(null);
      };
      // Only a real change may animate; a silent revalidation must not start a transition.
      if (isEmptyDiff(change.diff)) apply();
      else startTransition(apply);
    });
    // key includes every query field, so the closure above always matches it.
  }, [accountId, key, expired]);
  const renew = (write?: EventInvalidation, removed = false) => {
    forced.current = true;
    refreshedAt.current = Date.now();
    // Small already confirmed the delete: take the event off the screen at once and let the
    // renewal below only reconcile, instead of waiting for the network.
    if (write && removed) {
      const gone = new Set(write.eventIds);
      startTransition(() =>
        setStore((previous) => {
          const data = previous[key];
          if (!data) return previous;
          const events = data.events.filter(
            (event) => !("id" in event.lookup && gone.has(event.lookup.id)),
          );
          return events.length === data.events.length
            ? previous
            : { ...previous, [key]: { ...data, events } };
        }),
      );
    }
    if (write)
      setStore((previous) => pruneAffectedCalendarStore(previous, key, write));
    setReload((value) => value + 1);
  };
  const current = deriveCalendarView({
    accountId,
    key,
    data: store[key] ?? null,
    failure,
    connection,
    pending,
  });
  const list = catalog?.accountId === accountId ? catalog : null;
  return {
    calendars: list?.calendars ?? [],
    catalogError: list?.error ?? "",
    my,
    ids,
    ...current,
    queryKey: key,
    /** True shortly after our own refresh or write, so its result is not "news". */
    justRefreshed: () => Date.now() - refreshedAt.current < 5_000,
    /** Renews the current range from Small. Takes no argument: it is used as a click handler. */
    refresh: () => {
      manual.current = true;
      renew();
    },
    /** Shows a meeting Small just created at once; the renewal after the write confirms it. */
    addEvent: (event: CalendarEvent) => {
      ownEvents.current.add(event.key);
      startTransition(() =>
        setStore((previous) => insertCalendarEvent(previous, key, event)),
      );
    },
    /** Renews the current range and forgets the other ranges the write may have changed. */
    refreshAfterWrite: (write: EventInvalidation, removed = false) =>
      renew(write, removed),
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
