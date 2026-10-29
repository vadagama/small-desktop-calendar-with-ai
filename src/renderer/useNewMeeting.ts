import { useEffect, useRef, useState } from "react";
import { useAvailability } from "./useAvailability.js";
import {
  calendarRange,
  addDateDays,
  defaultMeetingSchedule,
} from "../shared/calendar-time.js";
import type { MeetingView } from "../shared/meeting-operations.js";
import type { MeetingOptions } from "../shared/meeting-options.js";
import type { SmallCalendar } from "../shared/calendar.js";
const minutes = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return (h ?? NaN) * 60 + (m ?? NaN);
};
export function useNewMeeting({
  account,
  initialDate,
  expired,
  created,
}: {
  account: { id: string; name: string; participantId?: string };
  initialDate: string;
  close: () => void;
  expired: () => void;
  created: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    active = useRef(true),
    running = useRef(false);
  const [title, setTitle] = useState(""),
    [agenda, setAgenda] = useState(""),
    [url, setUrl] = useState("");
  const [initial] = useState(() => defaultMeetingSchedule(initialDate));
  const [date, setDate] = useState(initial.date),
    [start, setStart] = useState(initial.start),
    [end, setEnd] = useState(initial.end);
  const [room, setRoom] = useState(""),
    [rooms, setRooms] = useState<SmallCalendar[]>([]),
    [roomError, setRoomError] = useState("");
  const [inform, setInform] = useState(false),
    [repeat, setRepeat] = useState(false),
    [until, setUntil] = useState(addDateDays(initialDate, 28));
  const [days, setDays] = useState<
    NonNullable<MeetingOptions["recurrence"]>["BYDAY"]
  >(["MO"]);
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [result, setResult] = useState<MeetingView | null>(null);
  const people = useAvailability(
      account.id,
      expired,
      account.participantId
        ? [
            {
              participantId: account.participantId,
              name: account.name,
              position: "Организатор",
            },
          ]
        : [],
    ),
    recipients = useAvailability(account.id, expired);
  const locked = !!result && result.phase !== "preview";
  useEffect(() => {
    active.current = true;
    dialog.current?.showModal();
    void window.smallDesktop.calendar
      .calendars({ accountId: account.id })
      .then((r) => {
        if (!active.current) return;
        if (r.ok) setRooms(r.data.filter((c) => /^\d+$/.test(c.id)));
        else setRoomError(r.error);
      })
      .catch(() => {
        if (active.current) setRoomError("Не удалось загрузить переговорные.");
      });
    return () => {
      active.current = false;
    };
  }, [account.id]);
  async function attach() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await window.smallDesktop.meetings.attach(5 - files.length);
      if (!active.current) return;
      if (r.ok) setFiles((old) => [...old, ...r.files]);
      else setError(r.error);
    } catch {
      if (active.current) setError("Не удалось прикрепить файл.");
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function create() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const duration = minutes(end) - minutes(start);
      if (!people.selected.length)
        throw new Error("Выберите участников встречи.");
      if (duration <= 0 || duration > 480)
        throw new Error(
          "Окончание должно быть позже начала; длительность — до 8 часов.",
        );
      const startsAt = new Date(
        Date.parse(calendarRange(date, "day").start) + minutes(start) * 60000,
      ).toISOString();
      const prepared = await window.smallDesktop.meetings.prepare({
        title,
        agenda,
        participantIds: people.selected.map((p) => p.participantId),
        startsAt,
        durationMinutes: duration,
        location: rooms.find((r) => r.id === room)?.name ?? "",
        conference: url.trim()
          ? { mode: "custom", url: url.trim() }
          : { mode: "none" },
        options: {
          calendarIds: room ? [Number(room)] : [],
          notificationRecipientIds: inform
            ? recipients.selected.map((p) => p.participantId)
            : [],
          attachmentIds: files.map((f) => f.id),
          recurrence: repeat
            ? { FREQ: "WEEKLY", BYDAY: days, UNTIL: until }
            : null,
        },
      });
      if (!active.current) return;
      if (!prepared.ok) throw new Error(prepared.error);
      setResult({
        draft: prepared.data,
        phase: "unknown",
        message:
          "Ответ не получен. Проверьте результат перед повторным созданием.",
      });
      const r = await window.smallDesktop.meetings.confirm({
        id: prepared.data.id,
        revision: prepared.data.revision,
      });
      if (!active.current) return;
      if (!r.ok) {
        setResult({
          draft: prepared.data,
          phase: "unknown",
          message:
            "Ответ не получен. Проверьте результат перед повторным созданием.",
        });
        throw new Error(r.error);
      }
      setResult(r.data);
      if (r.data.phase === "succeeded") created();
    } catch (e) {
      if (active.current)
        setError(
          e instanceof Error ? e.message : "Не удалось создать встречу.",
        );
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function reconcile() {
    if (!result) return;
    setBusy(true);
    setError("");
    try {
      const r = await window.smallDesktop.meetings.reconcile({
        id: result.draft.id,
        revision: result.draft.revision,
      });
      if (!active.current) return;
      if (r.ok) {
        setResult(r.data);
        if (r.data.phase === "succeeded") created();
      } else setError(r.error);
    } catch {
      if (active.current) setError("Не удалось проверить результат.");
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return {
    dialog,
    title,
    setTitle,
    agenda,
    setAgenda,
    url,
    setUrl,
    date,
    setDate,
    start,
    setStart,
    end,
    setEnd,
    room,
    setRoom,
    rooms,
    roomError,
    inform,
    setInform,
    repeat,
    setRepeat,
    until,
    setUntil,
    days,
    setDays,
    files,
    setFiles,
    busy,
    error,
    result,
    people,
    recipients,
    locked,
    attach,
    create,
    reconcile,
  };
}
