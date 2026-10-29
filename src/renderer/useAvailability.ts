import { useEffect, useRef, useState } from "react";
import type {
  CalendarPerson,
  PeoplePage,
  SlotsQuery,
  SlotsResult,
} from "../shared/calendar.js";

export function useAvailability(
  accountId: string,
  expired: () => void,
  initialPeople: CalendarPerson[] = [],
) {
  const [people, setPeople] = useState<PeoplePage | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [selected, setSelected] = useState<CalendarPerson[]>(initialPeople);
  const [slots, setSlots] = useState<SlotsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const searchVersion = useRef(0),
    slotVersion = useRef(0);
  useEffect(
    () => () => {
      searchVersion.current++;
      slotVersion.current++;
    },
    [],
  );
  function resetSearch() {
    searchVersion.current++;
    setPeople(null);
    setSearchError("");
    setSearching(false);
  }
  function invalidate() {
    slotVersion.current++;
    setSlots(null);
    setError("");
    setLoading(false);
  }
  async function search(query: string, page = 1) {
    const version = ++searchVersion.current;
    setSearching(true);
    setSearchError("");
    setPeople(null);
    try {
      const reply = await window.smallDesktop.calendar.people({
        accountId,
        query,
        page,
      });
      if (version !== searchVersion.current) return;
      if (!reply.ok) {
        setSearchError(reply.error);
        if (reply.kind === "auth") expired();
      } else setPeople(reply.data);
    } catch {
      if (version === searchVersion.current)
        setSearchError("Не удалось найти сотрудников. Повторите поиск.");
    } finally {
      if (version === searchVersion.current) setSearching(false);
    }
  }
  function toggle(person: CalendarPerson) {
    invalidate();
    setSelected((current) =>
      current.some((p) => p.participantId === person.participantId)
        ? current.filter((p) => p.participantId !== person.participantId)
        : [...current, person],
    );
  }
  async function find(
    date: string,
    durationMinutes: number,
    includeWeekends = false,
  ) {
    const version = ++slotVersion.current;
    const query: SlotsQuery = {
      accountId,
      participantIds: selected.map((p) => p.participantId),
      date,
      durationMinutes,
      ...(includeWeekends ? { includeWeekends } : {}),
    };
    setLoading(true);
    setSlots(null);
    setError("");
    try {
      const reply = await window.smallDesktop.calendar.slots(query);
      if (version !== slotVersion.current) return;
      if (!reply.ok) {
        setError(reply.error);
        if (reply.kind === "auth") expired();
      } else setSlots(reply.data);
    } catch {
      if (version === slotVersion.current)
        setError("Не удалось проверить занятость. Повторите поиск.");
    } finally {
      if (version === slotVersion.current) setLoading(false);
    }
  }
  return {
    people,
    searching,
    searchError,
    selected,
    slots,
    loading,
    error,
    resetSearch,
    invalidate,
    search,
    toggle,
    find,
  };
}
