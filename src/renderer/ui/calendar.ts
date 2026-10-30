import type { Meeting, Slot } from "./types.js";
export const TODAY = "2026-10-28";
export const parseDate = (date: string) => new Date(`${date}T12:00:00Z`);
export function addDays(date: string, amount: number) {
  const value = parseDate(date);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
export function weekStart(date: string) {
  return addDays(date, -((parseDate(date).getUTCDay() + 6) % 7));
}
export function monthDays(date: string) {
  const first = `${date.slice(0, 7)}-01`;
  const value = parseDate(first);
  value.setUTCMonth(value.getUTCMonth() + 1);
  const end = value.toISOString().slice(0, 10);
  const result: string[] = [];
  for (
    let day = weekStart(first);
    day < end || result.length % 7;
    day = addDays(day, 1)
  )
    result.push(day);
  return result;
}
export function shiftMonth(date: string, amount: number) {
  const value = parseDate(`${date.slice(0, 7)}-01`);
  value.setUTCMonth(value.getUTCMonth() + amount);
  return value.toISOString().slice(0, 10);
}
export const time = (minutes: number) =>
  `${Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;
export const dateLabel = (
  date: string,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" },
) =>
  new Intl.DateTimeFormat("ru", { timeZone: "UTC", ...options }).format(
    parseDate(date),
  );
export function conflicts(events: Meeting[], people: string[], slot: Slot) {
  return events.some(
    (event) =>
      event.date === slot.date &&
      event.people.some((person) => people.includes(person)) &&
      event.start < slot.start + slot.duration &&
      slot.start < event.start + event.duration,
  );
}
export function findSlots(
  events: Meeting[],
  people: string[],
  date: string,
  duration: number,
): Slot[] {
  if (!Number.isFinite(duration) || duration < 15 || duration > 480) return [];
  const slots: Slot[] = [];
  for (let day = 0; day < 7 && slots.length < 3; day++) {
    const target = addDays(date, day);
    if ([0, 6].includes(parseDate(target).getUTCDay())) continue;
    for (
      let start = 600;
      start + duration <= 1080 && slots.length < 3;
      start += 60
    ) {
      const slot = { date: target, start, duration };
      if (!conflicts(events, people, slot)) slots.push(slot);
    }
  }
  return slots;
}
