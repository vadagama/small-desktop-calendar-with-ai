import { z } from "zod";
import type {
  CalendarEvent,
  CalendarIssue,
  CalendarIssueKind,
  CalendarResult,
} from "../shared/calendar.js";
import {
  calendarDateAt,
  calendarRange,
  validCalendarDate,
} from "../shared/calendar-time.js";

export class CalendarError extends Error {
  constructor(
    public kind: CalendarIssueKind,
    message: string,
  ) {
    super(message);
  }
}
export interface CalendarSession {
  readCalendar<T>(
    accountId: string,
    action: (
      get: (path: string, body?: unknown) => Promise<Response>,
      participantId?: string,
    ) => Promise<T>,
  ): Promise<T>;
}
const id = z
  .union([
    z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    z.number().int().nonnegative(),
  ])
  .transform(String);
const account = z.strictObject({ accountId: z.string().min(1).max(200) });
const searchText = z.string().trim().min(1).max(200);
const pageNumber = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const peopleQuery = account.extend({ query: searchText, page: pageNumber });
const date = z.string().refine(validCalendarDate);
const querySchema = account.extend({
  date,
  view: z.enum(["day", "week", "month"]),
  myCalendar: z.boolean(),
  calendarIds: z.array(id).max(8),
});
const lookupSchema = z.union([
  z.strictObject({ id }),
  z.strictObject({ originalEventId: id, date }),
]);
const text = z.string().max(20000).nullish();
const timestamp = z.iso.datetime({ offset: true });
const eventSchema = z
  .object({
    id: id.nullish(),
    original_event_id: id.nullish(),
    title: text,
    starts_at: timestamp,
    ends_at: timestamp,
    calendar_ids: z.array(id).max(100).nullish(),
    creator_name: text,
    creator_id: id.nullish(),
    is_informed: z.boolean().nullish(),
    participants: z.array(z.object({ id, name: text, status: text })).nullish(),
    is_recurring: z.boolean().nullish(),
    description: text,
    location: text,
  })
  .refine(
    (e) =>
      Boolean(e.id || e.original_event_id) &&
      Date.parse(e.starts_at) < Date.parse(e.ends_at),
  );
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new CalendarError(
      "invalid",
      "Неизвестный формат данных календаря Small.",
    );
  return result.data;
}
function normalize(value: unknown, participantId?: string): CalendarEvent {
  const e = parse(eventSchema, value);
  const localDate = calendarDateAt(e.starts_at);
  const lookup = e.id
    ? { id: e.id }
    : { originalEventId: e.original_event_id!, date: localDate };
  return {
    key: e.id
      ? `event:${e.id}`
      : `series:${e.original_event_id}:${Date.parse(e.starts_at)}`,
    lookup,
    title: e.title || "Занято",
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    calendarIds: e.calendar_ids ?? [],
    accepted:
      e.participants?.some(
        (p) => p.id === participantId && p.status === "accepted",
      ) ?? false,
    participation:
      Boolean(participantId) && e.creator_id === participantId
        ? "organizer"
        : e.is_informed === true
          ? "informed"
          : e.is_informed === false
            ? "invited"
            : "unknown",
    ...(e.original_event_id
      ? { recurring: true }
      : typeof e.is_recurring === "boolean"
        ? { recurring: e.is_recurring }
        : {}),
    participants:
      e.participants?.map((p) => ({
        id: p.id,
        name: p.name ?? "",
        status: p.status ?? "unknown",
        organizer: p.id === e.creator_id,
      })) ?? [],
    organizer: e.creator_name ?? "",
    description: e.description ?? "",
    location: e.location ?? "",
  };
}
export async function calendarJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    const kind =
      response.status === 401
        ? "auth"
        : response.status === 403
          ? "denied"
          : response.status === 404
            ? "not-found"
            : "network";
    throw new CalendarError(
      kind,
      kind === "auth"
        ? "Войдите в Small заново."
        : kind === "denied"
          ? "Нет доступа к календарю Small."
          : kind === "not-found"
            ? "Событие больше недоступно."
            : "Не удалось загрузить календарь Small.",
    );
  }
  try {
    const reader = response.body?.getReader();
    if (!reader)
      throw new CalendarError("invalid", "Пустой ответ календаря Small.");
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8 * 1024 * 1024) {
        await reader.cancel();
        throw new CalendarError(
          "invalid",
          "Ответ Small слишком большой. Данные неполные.",
        );
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof CalendarError) throw error;
    throw new CalendarError(
      "invalid",
      "Неизвестный формат ответа календаря Small.",
    );
  }
}
export class CalendarService {
  constructor(private session: CalendarSession) {}
  /** One search page, never evidence of a complete team or an unambiguous name. */
  async searchPeople(input: unknown) {
    const q = parse(peopleQuery, input);
    return this.session.readCalendar(q.accountId, async (get) => {
      const params = new URLSearchParams({
        q: q.query,
        per_page: "10",
        page: String(q.page),
      });
      const body = parse(
        z.object({
          data: z.object({
            items: z
              .array(
                z.object({
                  person_guid: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
                  person_full_fio: z.string().trim().min(1).max(500),
                  position_name: z.string().max(500).nullish(),
                }),
              )
              .max(10),
            pagination: z.object({
              current_page: pageNumber,
              last_page: pageNumber,
            }),
          }),
        }),
        await calendarJson(
          await get(`/gate/employee/api/search/persons?${params}`),
        ),
      ).data;
      const { current_page: current, last_page: last } = body.pagination;
      if (
        current !== q.page ||
        last < current ||
        new Set(body.items.map((person) => person.person_guid)).size !==
          body.items.length
      )
        throw new CalendarError(
          "invalid",
          "Неизвестный формат страниц каталога Small.",
        );
      return {
        people: body.items.map((person) => ({
          participantId: person.person_guid,
          name: person.person_full_fio,
          position: person.position_name ?? "",
        })),
        page: current,
        nextPage: current < last ? current + 1 : null,
      };
    });
  }
  async calendars(input: unknown) {
    const { accountId } = parse(account, input);
    return this.session.readCalendar(accountId, async (get) => {
      const value = await calendarJson(
        await get("/gate/team/api/calendars/public"),
      );
      return parse(
        z.object({
          data: z
            .array(z.object({ id, name: z.string().min(1).max(500) }))
            .max(1000),
        }),
        value,
      ).data;
    });
  }
  async events(input: unknown): Promise<CalendarResult> {
    const q = parse(querySchema, input);
    const range = calendarRange(q.date, q.view);
    return this.session.readCalendar(
      q.accountId,
      async (get, participantId) => {
        const events = new Map<string, CalendarEvent>();
        const issues: CalendarIssue[] = [];
        const sources = q.myCalendar ? ["my"] : [...new Set(q.calendarIds)];
        const params = new URLSearchParams({
          start_date: range.start,
          end_date: range.end,
        });
        for (const source of sources) {
          try {
            const body = parse(
              z.object({
                data: z.union([
                  z.array(z.unknown()),
                  z.record(z.string(), z.unknown()),
                ]),
                pagination: z.unknown().optional(),
                meta: z.unknown().optional(),
              }),
              await calendarJson(
                await get(
                  `/gate/team/api/calendars/${source}/events?${params}`,
                ),
              ),
            );
            const items = Array.isArray(body.data)
              ? body.data
              : Object.values(body.data);
            if (items.length > 5000 || body.pagination || body.meta)
              issues.push({
                source,
                kind: "invalid",
                message:
                  "Полнота ответа Small не подтверждена: лимит или метаданные пагинации.",
              });
            let invalid = false;
            for (const item of items.slice(0, 5000)) {
              try {
                const e = normalize(item, participantId);
                if (
                  Date.parse(e.startsAt) < Date.parse(range.end) &&
                  Date.parse(e.endsAt) > Date.parse(range.start)
                )
                  events.set(e.key, e);
              } catch {
                invalid = true;
              }
            }
            if (invalid)
              issues.push({
                source,
                kind: "invalid",
                message:
                  "Часть событий имеет неизвестный формат. Данные неполные.",
              });
          } catch (error) {
            if (error instanceof CalendarError && error.kind === "auth")
              throw error;
            issues.push({
              source,
              kind: error instanceof CalendarError ? error.kind : "network",
              message:
                error instanceof CalendarError
                  ? error.message
                  : "Не удалось загрузить календарь Small. Занятость неизвестна.",
            });
          }
        }
        return { events: [...events.values()], issues };
      },
    );
  }
  async detail(input: unknown) {
    const { accountId, lookup } = parse(
      account.extend({ lookup: lookupSchema }),
      input,
    );
    return this.session.readCalendar(accountId, async (get, participantId) => {
      const path =
        "id" in lookup
          ? `/gate/team/api/calendar/events/${lookup.id}`
          : `/gate/team/api/calendar/events/generated?${new URLSearchParams({ original_event_id: lookup.originalEventId, date: lookup.date })}`;
      const raw = parse(
        eventSchema,
        parse(
          z.object({ data: z.unknown() }),
          await calendarJson(await get(path)),
        ).data,
      );
      if (
        "id" in lookup
          ? raw.id !== lookup.id
          : raw.original_event_id !== lookup.originalEventId ||
            calendarDateAt(raw.starts_at) !== lookup.date
      ) {
        throw new CalendarError(
          "invalid",
          "Карточка Small не совпадает с запрошенным событием.",
        );
      }
      return normalize(raw, participantId);
    });
  }
}

/** GET-only route guard shared with the trusted Chromium transport. */
export function isCalendarReadPath(path: string): boolean {
  if (!path.startsWith("/") || path.includes("#")) return false;
  const url = new URL(path, "https://team.small.kz");
  if (url.origin !== "https://team.small.kz") return false;
  if (
    ["from-template", "busy-intervals", "find-slots"].some((name) =>
      url.pathname.endsWith("/" + name),
    )
  )
    return false;
  const entries = [...url.searchParams.keys()];
  if (new Set(entries).size !== entries.length) return false;
  if (url.pathname === "/gate/employee/api/search/persons") {
    const page = url.searchParams.get("page") ?? "";
    return (
      entries.length === 3 &&
      entries.every((key) => ["q", "per_page", "page"].includes(key)) &&
      searchText.safeParse(url.searchParams.get("q")).success &&
      url.searchParams.get("per_page") === "10" &&
      /^[1-9][0-9]*$/.test(page) &&
      pageNumber.safeParse(Number(page)).success
    );
  }
  if (url.pathname === "/gate/team/api/calendars/public")
    return entries.length === 0;
  if (
    /^\/gate\/team\/api\/calendars\/[A-Za-z0-9_-]{1,128}\/events$/.test(
      url.pathname,
    )
  ) {
    return (
      entries.length === 2 &&
      entries.every((k) => k === "start_date" || k === "end_date") &&
      timestamp.safeParse(url.searchParams.get("start_date")).success &&
      timestamp.safeParse(url.searchParams.get("end_date")).success
    );
  }
  if (url.pathname === "/gate/team/api/calendar/events/generated") {
    return (
      entries.length === 2 &&
      entries.every((k) => k === "original_event_id" || k === "date") &&
      id.safeParse(url.searchParams.get("original_event_id")).success &&
      date.safeParse(url.searchParams.get("date")).success
    );
  }
  return (
    /^\/gate\/team\/api\/calendar\/events\/[A-Za-z0-9_-]{1,128}$/.test(
      url.pathname,
    ) && entries.length === 0
  );
}
