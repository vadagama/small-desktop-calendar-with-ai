import { editableEvent } from "../shared/event-edit.js";
import { meetingLink } from "../shared/meeting-link.js";
import { calendarDateAt } from "../shared/calendar-time.js";
import type { CalendarEvent } from "../shared/calendar.js";
import { notifySuccess, notifyError } from "./notification-events.js";
import { useEffect, useRef, useState } from "react";
import { useAvailability } from "./useAvailability.js";
import {
  calendarRange,
  calendarToday,
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
  initialPeople,
  initialSlot,
  expired,
  created,
  close,
  authRequired = false,
  editEvent,
  saved,
  disabled = false,
}: {
  account: { id: string; name: string; participantId?: string };
  initialDate: string;
  initialSlot?: import("./ui/types.js").Slot;
  initialPeople?: import("../shared/calendar.js").CalendarPerson[];
  close: () => void;
  expired: () => void;
  created: (result: MeetingView) => void;
  authRequired?: boolean;
  editEvent?: CalendarEvent;
  saved?: () => void;
  disabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    active = useRef(true),
    running = useRef(false);
  const [editing] = useState(editEvent);
  const [before] = useState(() => (editing ? editableEvent(editing) : null));
  const [originalUrl] = useState(() =>
    editing
      ? (meetingLink(editing.location) ??
        meetingLink(editing.description) ??
        "")
      : "",
  );
  const stripLink = (text: string) =>
    text
      .replace(/(?:https:\/\/|meet\.small\.kz\/)[^\s<>]+/gi, (token) =>
        meetingLink(token) === originalUrl ? "" : token,
      )
      .trim();
  const [originalAgenda] = useState(() =>
    editing
      ? originalUrl && !meetingLink(editing.location)
        ? stripLink(editing.description)
        : editing.description
      : "",
  );
  const [title, setTitle] = useState(editing?.title ?? ""),
    [agenda, setAgenda] = useState(originalAgenda),
    [url, setUrl] = useState(originalUrl);
  const [initial] = useState(() => {
    if (editing) {
      const clock = (value: string) =>
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Almaty",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(new Date(value));
      return {
        date: calendarDateAt(editing.startsAt),
        start: clock(editing.startsAt),
        end: clock(editing.endsAt),
      };
    }
    if (!initialSlot) return defaultMeetingSchedule(initialDate);
    const clock = (minute: number) =>
      `${String(Math.floor((minute % 1440) / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    return {
      date: initialSlot.date,
      start: clock(initialSlot.start),
      end: clock(initialSlot.start + initialSlot.duration),
    };
  });
  const [date, setDate] = useState(initial.date),
    [start, setStart] = useState(initial.start),
    [end, setEnd] = useState(initial.end);
  const [room, setRoom] = useState(editing?.calendarIds[0] ?? ""),
    [rooms, setRooms] = useState<SmallCalendar[]>([]),
    [roomError, setRoomError] = useState("");
  const [inform, setInform] = useState(
      !!editing?.notificationRecipients?.length,
    ),
    [repeat, setRepeat] = useState(false),
    [until, setUntil] = useState(addDateDays(initialDate, 28));
  const [days, setDays] = useState<
    NonNullable<MeetingOptions["recurrence"]>["BYDAY"]
  >(["MO"]);
  const [files, setFiles] = useState<{ id: string; name: string }[]>(
    editing?.attachments ?? [],
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [result, setResult] = useState<MeetingView | null>(null);
  const wasAuthRequired = useRef(authRequired);
  useEffect(() => {
    if (wasAuthRequired.current && !authRequired && files.length && !result) {
      setFiles([]);
      setError(
        "Вход восстановлен. Прикрепите файлы заново перед созданием события.",
      );
    }
    wasAuthRequired.current = authRequired;
  }, [authRequired, files.length, result]);
  const people = useAvailability(
      account.id,
      expired,
      editing
        ? (editing.participants ?? []).map((p) => ({
            participantId: p.id,
            name: p.name,
            position: "",
          }))
        : initialPeople?.length
          ? initialPeople
          : account.participantId
            ? [
                {
                  participantId: account.participantId,
                  name: account.name,
                  position: "Организатор",
                },
              ]
            : [],
    ),
    recipients = useAvailability(
      account.id,
      expired,
      (editing?.notificationRecipients ?? []).map((p) => ({
        participantId: p.id,
        name: p.name,
        position: "",
      })),
    );
  const snapshot = JSON.stringify({
    title,
    agenda,
    url,
    date,
    start,
    end,
    room,
    inform,
    repeat,
    until,
    days,
    people: people.selected.map((p) => p.participantId),
    recipients: recipients.selected.map((p) => p.participantId),
    files: files.map((f) => f.id),
  });
  const original = useRef(snapshot);
  const dirty = original.current !== snapshot;
  const endsNextDay = end === "00:00" && start !== "00:00";
  const durationMinutes = (endsNextDay ? 1440 : minutes(end)) - minutes(start);
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
    if (authRequired) {
      expired();
      return;
    }
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
    if (disabled) return;
    if (authRequired) {
      expired();
      return;
    }
    let submitted = false;
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      if (date < calendarToday())
        throw new Error(
          editing
            ? "Нельзя изменять события за прошедшие дни."
            : "Нельзя создавать события в прошедшие дни.",
        );
      const duration = durationMinutes;
      if (!people.selected.length)
        throw new Error("Выберите участников встречи.");
      const timeChanged =
        !editing ||
        date !== initial.date ||
        start !== initial.start ||
        end !== initial.end;
      if (timeChanged && (duration <= 0 || duration > 480))
        throw new Error(
          "Окончание должно быть позже начала; длительность — до 8 часов.",
        );
      const startsAt = new Date(
        Date.parse(calendarRange(date, "day").start) + minutes(start) * 60000,
      ).toISOString();
      if (editing && !("id" in editing.lookup))
        throw new Error("Для редактирования серии выберите область изменений.");
      if (editing && before && "id" in editing.lookup) {
        let description = before.description;
        let location = before.location;
        if (agenda !== originalAgenda || url !== originalUrl) {
          description = [
            agenda,
            url && (!meetingLink(editing.location) || url !== originalUrl)
              ? url
              : "",
          ]
            .filter(Boolean)
            .join("\n\n");
          if (url !== originalUrl && meetingLink(editing.location))
            location = stripLink(location);
        }
        const roomChanged = room !== (editing.calendarIds[0] ?? "");
        if (roomChanged) {
          location = rooms.find((r) => r.id === room)?.name ?? "";
          if (url && meetingLink(editing.location) && url === originalUrl)
            description = [description, url].filter(Boolean).join("\n\n");
        }
        const reply = await window.smallDesktop.calendar.updateEvent({
          accountId: account.id,
          eventId: editing.lookup.id,
          before,
          after: {
            title,
            description,
            location,
            starts_at: timeChanged ? startsAt : before.starts_at,
            ends_at: timeChanged
              ? new Date(Date.parse(startsAt) + duration * 60000).toISOString()
              : before.ends_at,
            calendar_ids: roomChanged
              ? room
                ? [Number(room)]
                : []
              : before.calendar_ids,
            participant_ids: people.selected.map((p) => p.participantId),
            notification_recipient_ids: inform
              ? recipients.selected.map((p) => p.participantId)
              : [],
            attachments: files.map((f) => f.id),
          },
        });
        if (!active.current) return;
        if (!reply.ok) {
          if (reply.kind === "auth") expired();
          throw new Error(reply.error);
        }
        notifySuccess("Изменения сохранены");
        saved?.();
        return;
      }
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
      submitted = true;
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
      if (r.data.phase !== "succeeded") notifyError("создать событие");
      if (r.data.phase === "succeeded") {
        notifySuccess("Событие успешно создано");
        created(r.data);
        close();
      }
    } catch (e) {
      if (active.current) {
        if (submitted) notifyError("создать событие");
        else
          setError(
            e instanceof Error ? e.message : "Не удалось создать встречу.",
          );
      }
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function reconcile() {
    if (authRequired) {
      expired();
      return;
    }
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
        if (r.data.phase === "succeeded") {
          notifySuccess("Событие успешно создано");
          created(r.data);
          close();
        }
      } else setError(r.error);
    } catch {
      if (active.current) setError("Не удалось проверить результат.");
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return {
    editing,
    dirty,
    durationMinutes,
    endsNextDay,
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
