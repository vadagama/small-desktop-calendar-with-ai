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
  protectedPeople: CalendarPerson[] = [],
) {
  const [people, setPeople] = useState<PeoplePage | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const protectedIds = protectedPeople.map((person) => person.participantId);
  const [selected, setSelected] = useState<CalendarPerson[]>(() => [
    ...protectedPeople,
    ...initialPeople.filter(
      (person) => !protectedIds.includes(person.participantId),
    ),
  ]);
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
    if (page === 1) setPeople(null);
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
      } else
        setPeople((previous) =>
          page > 1 && previous
            ? {
                ...reply.data,
                people: [
                  ...previous.people,
                  ...reply.data.people.filter(
                    (person) =>
                      !previous.people.some(
                        (old) => old.participantId === person.participantId,
                      ),
                  ),
                ],
              }
            : reply.data,
        );
    } catch {
      if (version === searchVersion.current)
        setSearchError("Не удалось найти сотрудников. Повторите поиск.");
    } finally {
      if (version === searchVersion.current) setSearching(false);
    }
  }
  function toggle(person: CalendarPerson) {
    if (protectedIds.includes(person.participantId)) return;
    invalidate();
    setSelected((current) =>
      current.some((p) => p.participantId === person.participantId)
        ? current.filter((p) => p.participantId !== person.participantId)
        : current.length < 20
          ? [...current, person]
          : current,
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
    protectedIds,
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
