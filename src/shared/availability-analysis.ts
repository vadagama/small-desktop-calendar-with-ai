import { z } from "zod";
import {
  addDateDays,
  calendarRange,
  calendarDateAt,
  validCalendarDate,
} from "./calendar-time.js";
import type { CalendarPerson } from "./calendar.js";

export { availabilityAnalysisChannels } from "./availability-channels.js";
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const analysisParams = z.strictObject({
  accountId: z.string().min(1).max(200),
  participantIds: z
    .array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/))
    .min(1)
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length),
  date: z.string().refine(validCalendarDate),
  period: z.enum(["day", "week"]).default("week"),
  durationMinutes: z.number().int().min(1).max(480).default(60),
  includeWeekends: z.boolean().default(false),
  bufferMinutes: z.number().int().min(0).max(120).default(0),
  organizerParticipantId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .optional(),
  timeFrom: clock.default("09:00"),
  timeTo: clock.default("18:00"),
});
export const analysisQuery = analysisParams.refine(
  (q) => q.timeFrom < q.timeTo,
  "Начало окна должно быть раньше окончания",
);
export const analysisToolInput = analysisParams
  .omit({ accountId: true, bufferMinutes: true, organizerParticipantId: true })
  .extend({
    date: z.string().refine(validCalendarDate).optional(),
    participantIds: analysisParams.shape.participantIds.min(0),
    includeSelf: z
      .boolean()
      .default(false)
      .describe(
        "Совместимость: организатор всегда добавляется приложением независимо от значения",
      ),
  });
export type AnalysisQuery = z.infer<typeof analysisQuery>;
export interface AvailabilityInterval {
  start: string;
  end: string;
  state: "free" | "busy" | "unknown" | "outside-hours";
}
export interface TimeInterval {
  start: string;
  end: string;
}
export interface AvailabilityDay {
  date: string;
  participants: {
    participantId: string;
    intervals: AvailabilityInterval[];
    issue?: string;
  }[];
  commonWindows: TimeInterval[];
}
export interface AvailabilityAnalysis {
  query: AnalysisQuery;
  fetchedAt: string;
  days: AvailabilityDay[];
}
export interface AvailabilityOpening {
  kind: "availability-analysis";
  query: AnalysisQuery;
  people: CalendarPerson[];
}
export function analysisDates(q: AnalysisQuery) {
  const first =
    q.period === "week"
      ? calendarDateAt(calendarRange(q.date, "week").start)
      : q.date;
  return Array.from({ length: q.period === "week" ? 7 : 1 }, (_, i) =>
    addDateDays(first, i),
  ).filter((date) => {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    return q.period === "day" || q.includeWeekends || (day !== 0 && day !== 6);
  });
}
/** Small backend TimeSlotValidator: working day 09–18, lunch 13–14. */
export function smallWorkingIntervals(date: string): TimeInterval[] {
  const at = (time: string) => `${date}T${time}:00+05:00`;
  return [
    { start: at("09:00"), end: at("13:00") },
    { start: at("14:00"), end: at("18:00") },
  ];
}
export function partitionAvailability(
  date: string,
  free: TimeInterval[],
  busy: TimeInterval[],
  timeFrom: string,
  timeTo: string,
  now: number,
  workingHours?: TimeInterval[],
): AvailabilityInterval[] {
  const range = calendarRange(date, "day");
  const min = Date.parse(range.start),
    max = Date.parse(range.end);
  const from = Date.parse(`${date}T${timeFrom}:00+05:00`),
    to = Date.parse(`${date}T${timeTo}:00+05:00`);
  const asNumbers = (rows: TimeInterval[]) =>
    rows
      .map((i) => ({ start: Date.parse(i.start), end: Date.parse(i.end) }))
      .filter((i) => i.end > min && i.start < max);
  const working = workingHours ? asNumbers(workingHours) : undefined;
  const f = asNumbers(free),
    b = asNumbers(busy);
  const points = [
    ...new Set(
      [
        min,
        max,
        from,
        to,
        now,
        ...f.flatMap((i) => [i.start, i.end]),
        ...b.flatMap((i) => [i.start, i.end]),
        ...(working?.flatMap((i) => [i.start, i.end]) ?? []),
      ].filter((n) => n >= min && n <= max),
    ),
  ].sort((a, b) => a - b);
  const stamp = (n: number) =>
    new Date(n + 5 * 3600000).toISOString().slice(0, 19) + "+05:00";
  const result: AvailabilityInterval[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]!,
      end = points[i + 1]!;
    const state: AvailabilityInterval["state"] = b.some(
      (x) => x.start < end && x.end > start,
    )
      ? "busy"
      : start < from ||
          end > to ||
          end <= now ||
          (working && !working.some((i) => i.start <= start && i.end >= end))
        ? "outside-hours"
        : f.some((x) => x.start <= start && x.end >= end)
          ? "free"
          : "unknown";
    const previous = result.at(-1);
    if (previous?.state === state) previous.end = stamp(end);
    else result.push({ start: stamp(start), end: stamp(end), state });
  }
  return result;
}
export function commonAvailability(
  rows: AvailabilityInterval[][],
  durationMinutes: number,
): TimeInterval[] {
  if (!rows.length) return [];
  let result = rows[0]!
    .filter((i) => i.state === "free")
    .map(({ start, end }) => ({ start, end }));
  for (const row of rows.slice(1)) {
    result = result.flatMap((a) =>
      row
        .filter((b) => b.state === "free")
        .flatMap((b) => {
          const start =
            Date.parse(a.start) >= Date.parse(b.start) ? a.start : b.start;
          const end = Date.parse(a.end) <= Date.parse(b.end) ? a.end : b.end;
          return Date.parse(start) < Date.parse(end) ? [{ start, end }] : [];
        }),
    );
  }
  return result.filter(
    (i) => Date.parse(i.end) - Date.parse(i.start) >= durationMinutes * 60000,
  );
}

export const availabilityOpeningSchema = z
  .object({
    kind: z.literal("availability-analysis"),
    query: analysisQuery,
    people: z
      .array(
        z.object({
          participantId: z.string().min(1).max(128),
          name: z.string().max(500),
          position: z.string().max(500),
        }),
      )
      .max(20),
  })
  .refine(
    (v) =>
      v.people.length === v.query.participantIds.length &&
      new Set(v.people.map((p) => p.participantId)).size === v.people.length &&
      v.people.every((p) => v.query.participantIds.includes(p.participantId)),
  );

/** Select the clicked segment; personal meetings also require the organizer. */
export function availabilityWindowAt(
  segment: TimeInterval,
  personalWindows: TimeInterval[],
  commonWindows: TimeInterval[],
  durationMinutes: number,
): (TimeInterval & { common: boolean }) | undefined {
  const contains = (window: TimeInterval) =>
    Date.parse(window.start) <= Date.parse(segment.start) &&
    Date.parse(window.end) >= Date.parse(segment.end);
  const common = commonWindows.find(contains);
  const personal = personalWindows.find(contains);
  const window =
    common ??
    (personal ? { start: segment.start, end: personal.end } : undefined);
  if (
    !window ||
    Date.parse(window.end) - Date.parse(window.start) < durationMinutes * 60000
  )
    return;
  return { ...window, common: Boolean(common) };
}
