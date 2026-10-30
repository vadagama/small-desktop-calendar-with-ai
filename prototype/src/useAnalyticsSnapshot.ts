import { useCallback, useEffect, useRef, useState } from "react";
import { refreshDue } from "./analytics-model";
import type { DataState, Meeting } from "./types";

const key = "small-prototype-analytics-snapshot-v1";
export interface AnalyticsSnapshot {
  updatedAt: string;
  events: Meeting[];
  version: number;
}
function initial(events: Meeting[]): AnalyticsSnapshot {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    if (
      value &&
      Number.isFinite(Date.parse(value.updatedAt)) &&
      Number.isInteger(value.version) &&
      Array.isArray(value.events) &&
      value.events.every(
        (e: Meeting) =>
          typeof e.id === "string" &&
          typeof e.title === "string" &&
          typeof e.organizer === "string" &&
          typeof e.date === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(e.date) &&
          Number.isFinite(e.start) &&
          Number.isFinite(e.duration) &&
          ["personal", "team", "room"].includes(e.calendar) &&
          Array.isArray(e.people),
      )
    )
      return value;
  } catch {
    /* A damaged demo snapshot is rebuilt from fixtures. */
  }
  return {
    updatedAt: new Date().toISOString(),
    events: [...events],
    version: 1,
  };
}
export function useAnalyticsSnapshot(events: Meeting[], state: DataState) {
  const [snapshot, setSnapshot] = useState(() => initial(events));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState(false);
  const input = useRef({ events, state });
  input.current = { events, state };
  const active = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(() => {
    if (active.current) return;
    active.current = true;
    setRefreshing(true);
    setError("");
    timer.current = setTimeout(() => {
      const { events: latest, state: status } = input.current;
      if (status === "error" || status === "denied" || status === "loading") {
        setError(
          status === "denied"
            ? "Нет доступа. Верните обычное состояние в настройках и повторите обновление."
            : "Обновление не удалось. Показан последний успешный снимок; повторите попытку.",
        );
      } else
        setSnapshot((old) => ({
          updatedAt: new Date().toISOString(),
          events: status === "empty" ? [] : [...latest],
          version: old.version + 1,
        }));
      setRefreshing(false);
      active.current = false;
    }, 700);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(snapshot));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [snapshot]);
  useEffect(() => {
    // Browser demo: catch up while open and on focus, never claim collection while closed.
    const check = () => {
      if (
        refreshDue(snapshot.updatedAt, new Date()) &&
        input.current.state === "ready"
      )
        refresh();
    };
    check();
    const interval = setInterval(check, 60_000);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", check);
    };
  }, [snapshot.updatedAt, refresh]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      active.current = false;
    },
    [],
  );
  return { snapshot, refreshing, error, storageError, refresh };
}
