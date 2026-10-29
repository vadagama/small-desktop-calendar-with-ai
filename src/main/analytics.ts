import {
  calendarDateAt,
  calendarRange,
  validCalendarDate,
} from "../shared/calendar-time.js";
import type { CalendarEvent, CalendarIssue } from "../shared/calendar.js";
import { OccurrenceSet } from "../shared/occurrence-key.js";
import type { CalendarService } from "./calendar.js";
import { collectEvents, schedulePeriod } from "./schedule.js";
import type {
  AnalyticsBucket,
  AnalyticsEvent,
  AnalyticsResult,
  EventGroup,
  TopicRule,
} from "../shared/analytics.js";

const uncategorized = "Без категории";
const dayMs = 86400000;
export const analyticsRules = [
  "Период — полуоткрытый интервал [начало, конец) в Asia/Almaty; встреча учитывается, если пересекает его.",
  "Время встречи на границе считается только внутри периода.",
  "В основной итог входят встречи, где вы организатор или приняли приглашение.",
  "Остальные встречи (нет подтверждённого ответа, включая не принятые и информирующие) показаны отдельной группой.",
  "Отклонённые встречи исключены из итога и только пересчитаны.",
  "Встречи на 24 часа и дольше или с границами ровно в полночь помечены «возможно, весь день» и не входят в часы.",
  "Сумма длительностей считает пересечения дважды; занятое время — объединение интервалов.",
  "Регулярные — только встречи серий, подтверждённых календарём.",
  "Тема — по правилам ключевых слов названия; иначе «Без категории».",
] as const;

function isMidnight(instant: number) {
  const date = calendarDateAt(new Date(instant).toISOString());
  return Date.parse(calendarRange(date, "day").start) === instant;
}

function group(
  event: CalendarEvent,
  participantId: string,
  start: number,
  end: number,
): EventGroup {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return "invalid";
  if (end - start >= dayMs || (isMidnight(start) && isMidnight(end)))
    return "possible-all-day";
  const own = event.participants?.find((p) => p.id === participantId);
  if (own?.status === "declined") return "declined";
  if (event.participation === "organizer" || own?.status === "accepted")
    return "confirmed";
  return "unconfirmed";
}

function topic(title: string, rules: TopicRule[]) {
  const text = title.toLowerCase();
  for (const rule of rules)
    for (const keyword of rule.keywords) {
      const word = keyword.trim().toLowerCase();
      if (word && text.includes(word))
        return {
          topic: rule.topic,
          rule: `${rule.topic}: «${keyword.trim()}»`,
        };
    }
  return { topic: uncategorized, rule: null };
}

function buckets(map: Map<string, AnalyticsBucket>, limit?: number) {
  const all = [...map.values()].sort(
    (a, b) =>
      b.minutes - a.minutes ||
      b.count - a.count ||
      a.name.localeCompare(b.name),
  );
  return limit ? all.slice(0, limit) : all;
}

function add(map: Map<string, AnalyticsBucket>, name: string, minutes: number) {
  const bucket = map.get(name) ?? { name, count: 0, minutes: 0 };
  bucket.count++;
  bucket.minutes += minutes;
  map.set(name, bucket);
}

/** Pure calculation over already loaded events; the model never sees it as input. */
export function analyzeMeetings(input: {
  from: string;
  to: string;
  participantId: string;
  events: CalendarEvent[];
  issues?: CalendarIssue[];
  truncated?: boolean;
  rules?: TopicRule[];
}): AnalyticsResult {
  const { from, to, participantId, rules = [] } = input;
  if (!validCalendarDate(from) || !validCalendarDate(to) || to < from)
    throw new Error("Invalid analytics period");
  const periodStart = Date.parse(calendarRange(from, "day").start);
  const periodEnd = Date.parse(calendarRange(to, "day").end);
  const seen = new Set<string>();
  let duplicates = 0;
  const events: AnalyticsEvent[] = [];
  const groups = Object.fromEntries(
    (
      [
        "confirmed",
        "unconfirmed",
        "declined",
        "possible-all-day",
        "invalid",
      ] as const
    ).map((name) => [name, { count: 0, minutes: 0 }]),
  ) as AnalyticsResult["groups"];
  const intervals: [number, number][] = [];
  const topics = new Map<string, AnalyticsBucket>();
  const organizers = new Map<string, AnalyticsBucket>();
  const participants = new Map<string, AnalyticsBucket>();
  let sum = 0;
  let regularCount = 0;
  let regularMinutes = 0;
  // One view per occurrence first (virtual and materialized collapse into the materialized
  // one, which carries the current time); the identity check below keeps catching repeats.
  const collapsed = new OccurrenceSet();
  for (const event of input.events) collapsed.add(event);
  const unique = collapsed.values();
  duplicates += input.events.length - unique.length;
  for (const event of unique) {
    const identity =
      "id" in event.lookup
        ? `id:${event.lookup.id}`
        : `series:${event.lookup.originalEventId}:${event.lookup.date}`;
    if (seen.has(event.key) || seen.has(identity)) {
      duplicates++;
      continue;
    }
    seen.add(event.key);
    seen.add(identity);
    const start = Date.parse(event.startsAt);
    const end = Date.parse(event.endsAt);
    const kind = group(event, participantId, start, end);
    if (kind !== "invalid" && !(start < periodEnd && end > periodStart))
      continue;
    const clipped =
      kind === "invalid"
        ? 0
        : (Math.min(end, periodEnd) - Math.max(start, periodStart)) / 60000;
    const counted = kind === "possible-all-day" ? 0 : clipped;
    const match = topic(event.title, rules);
    groups[kind].count++;
    groups[kind].minutes += counted;
    events.push({
      key: event.key,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      organizer: event.organizer,
      group: kind,
      minutes: counted,
      regular: event.recurring === true,
      ...match,
    });
    if (kind !== "confirmed") continue;
    sum += clipped;
    intervals.push([Math.max(start, periodStart), Math.min(end, periodEnd)]);
    if (event.recurring === true) {
      regularCount++;
      regularMinutes += clipped;
    }
    add(topics, match.topic, clipped);
    add(organizers, event.organizer.trim() || "Не указан", clipped);
    for (const p of event.participants ?? [])
      if (p.id !== participantId) add(participants, p.name || p.id, clipped);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let busy = 0;
  let open: [number, number] | undefined;
  for (const interval of intervals) {
    if (open && interval[0] <= open[1])
      open[1] = Math.max(open[1], interval[1]);
    else {
      if (open) busy += open[1] - open[0];
      open = [...interval];
    }
  }
  if (open) busy += open[1] - open[0];
  const issues = input.issues ?? [];
  events.sort(
    (a, b) =>
      Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
      a.key.localeCompare(b.key),
  );
  return {
    kind: "analytics",
    from,
    to,
    timezone: "Asia/Almaty",
    complete: issues.length === 0 && input.truncated !== true,
    duplicates,
    totals: {
      count: groups.confirmed.count,
      sumMinutes: sum,
      busyMinutes: busy / 60000,
      overlapMinutes: sum - busy / 60000,
      regularCount,
      regularMinutes,
    },
    groups,
    byTopic: buckets(topics),
    byOrganizer: buckets(organizers),
    topParticipants: buckets(participants, 10),
    unavailable: ["cancellations", "teams", "tags"],
    rules: [...analyticsRules],
    events,
    issues,
  };
}

export const analyticsEventLimit = 1000;

/** Reads "my calendar" for a period and calculates the report; no writes. */
export async function readAnalytics(
  accountId: string,
  participantId: string,
  input: unknown,
  calendar: Pick<CalendarService, "events">,
  signal: AbortSignal,
  rules: TopicRule[] = [],
  now?: string,
) {
  const period = schedulePeriod(input, now);
  const { events, issues } = await collectEvents(
    accountId,
    period,
    calendar,
    signal,
  );
  signal.throwIfAborted();
  const truncated = events.length > analyticsEventLimit;
  const all = truncated
    ? issues.concat({
        source: "my",
        kind: "invalid",
        message: `Прочитаны первые ${analyticsEventLimit} встреч. Уточните более короткий период.`,
      })
    : issues;
  return analyzeMeetings({
    ...period,
    participantId,
    events: events.slice(0, analyticsEventLimit),
    issues: all,
    truncated,
    rules,
  });
}
