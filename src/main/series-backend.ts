import { z } from "zod";
import { calendarDateAt } from "../shared/calendar-time.js";
import type { CalendarEvent } from "../shared/calendar.js";
import { occurrenceKey } from "../shared/series-scope.js";
import { calendarJson, type CalendarService } from "./calendar.js";
import { collectEvents } from "./schedule.js";
import { SmallAuthError } from "./small-auth.js";
import type {
  BackendWrite,
  SeriesBackend,
  SeriesCard,
  SeriesUpdateBody,
  SeriesView,
} from "./series-adapter.js";

export interface SeriesSession {
  readCalendar<T>(
    accountId: string,
    action: (
      get: (path: string, body?: unknown) => Promise<Response>,
      participantId?: string,
    ) => Promise<T>,
  ): Promise<T>;
  materializeCalendarEvent(
    accountId: string,
    originalEventId: string,
    date: string,
  ): Promise<Response>;
  updateSeriesCalendarEvent(
    accountId: string,
    eventId: string,
    body: SeriesUpdateBody,
  ): Promise<Response>;
  cancelCalendarEvent(
    accountId: string,
    eventId: string,
    reason: string,
  ): Promise<Response>;
}

const id = z
  .union([
    z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    z.number().int().nonnegative(),
  ])
  .transform(String);
const stamp = z.iso.datetime({ offset: true });
/** Same fields the T10 card read requires; anything missing blocks the write. */
const cardSchema = z.object({
  data: z.object({
    id: id.nullish(),
    original_event_id: id.nullish(),
    creator_id: id,
    title: z.string(),
    description: z.string().nullable(),
    location: z.string().nullable(),
    starts_at: stamp,
    ends_at: stamp,
    timezone: z.string().min(1),
    is_recurring: z.boolean(),
    recurrence_rule: z.record(z.string(), z.unknown()),
    is_public: z.boolean(),
    calendar_ids: z.array(z.coerce.number().int().positive()),
    participants: z.array(z.object({ id })),
    notification_recipients: z.array(z.object({ id })),
    attachments: z.array(z.object({ id })),
  }),
});
const created = z.object({ data: z.object({ id }) });

/**
 * Series id of a calendar event: its `original_event_id`, or its own id when it is the
 * recurring template. Events without either are not part of any series.
 */
export function seriesIdOf(event: CalendarEvent) {
  if (event.originalEventId) return event.originalEventId;
  if (event.recurring === true && "id" in event.lookup) return event.lookup.id;
  return null;
}

/**
 * Original date of the slot. Only the unmoved case is knowable from the calendar data;
 * a moved or materialized occurrence keeps its identity only if A4 holds, so the contract
 * probe must confirm it before the gate opens.
 */
const originalDateOf = (event: CalendarEvent) =>
  "originalEventId" in event.lookup
    ? event.lookup.date
    : calendarDateAt(event.startsAt);

export class SmallSeriesBackend implements SeriesBackend {
  constructor(
    private session: SeriesSession,
    private calendar: Pick<CalendarService, "events">,
  ) {}

  async window(accountId: string, seriesId: string, from: string, to: string) {
    const { events, issues } = await collectEvents(
      accountId,
      { from, to },
      this.calendar,
      new AbortController().signal,
    );
    const views: SeriesView[] = [];
    for (const event of events) {
      if (seriesIdOf(event) !== seriesId) continue;
      views.push({
        key: occurrenceKey({ seriesId, originalDate: originalDateOf(event) }),
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        // Unknown organizer stays empty, so the adapter refuses the write.
        organizerId: event.participants?.find((p) => p.organizer)?.id ?? "",
        ...("id" in event.lookup ? { eventId: event.lookup.id } : {}),
      });
    }
    return { views, complete: issues.length === 0 };
  }

  async card(
    accountId: string,
    ref: { seriesId: string; originalDate: string; eventId?: string },
  ): Promise<SeriesCard | null> {
    const path = ref.eventId
      ? `/gate/team/api/calendar/events/${ref.eventId}`
      : `/gate/team/api/calendar/events/generated?${new URLSearchParams({ original_event_id: ref.seriesId, date: ref.originalDate })}`;
    const parsed = cardSchema.safeParse(
      await this.session.readCalendar(accountId, async (get) =>
        calendarJson(await get(path)),
      ),
    );
    if (!parsed.success) return null;
    const e = parsed.data.data;
    const sameSeries = (e.original_event_id ?? e.id) === ref.seriesId;
    if (!e.is_recurring || !sameSeries) return null;
    if (ref.eventId && e.id !== ref.eventId) return null;
    return {
      ...(e.id ? { eventId: e.id } : {}),
      organizerId: e.creator_id,
      title: e.title,
      description: e.description ?? "",
      location: e.location ?? "",
      startsAt: e.starts_at,
      endsAt: e.ends_at,
      timezone: e.timezone,
      isPublic: e.is_public,
      calendarIds: e.calendar_ids,
      participantIds: e.participants.map((p) => p.id),
      notificationRecipientIds: e.notification_recipients.map((p) => p.id),
      attachments: e.attachments.map((p) => p.id),
      recurrenceRule: e.recurrence_rule,
    };
  }

  /**
   * A SmallAuthError is thrown before anything is sent (local refusal, wrong account,
   * signed out); every other failure may have reached the server and stays "unknown".
   */
  private async send(
    request: () => Promise<Response>,
  ): Promise<Response | null> {
    try {
      return await request();
    } catch (error) {
      if (error instanceof SmallAuthError) return null;
      throw error;
    }
  }

  async materialize(
    accountId: string,
    seriesId: string,
    originalDate: string,
  ): Promise<BackendWrite> {
    const response = await this.send(() =>
      this.session.materializeCalendarEvent(accountId, seriesId, originalDate),
    );
    if (!response) return { status: 0, notSent: true };
    if (!response.ok) return { status: response.status };
    const body = created.safeParse(
      await calendarJson(response).catch(() => null),
    );
    return {
      status: response.status,
      ...(body.success ? { eventId: body.data.data.id } : {}),
    };
  }
  async update(
    accountId: string,
    eventId: string,
    body: SeriesUpdateBody,
  ): Promise<BackendWrite> {
    const response = await this.send(() =>
      this.session.updateSeriesCalendarEvent(accountId, eventId, body),
    );
    return response
      ? { status: response.status }
      : { status: 0, notSent: true };
  }
  async cancel(
    accountId: string,
    eventId: string,
    reason: string,
  ): Promise<BackendWrite> {
    const response = await this.send(() =>
      this.session.cancelCalendarEvent(accountId, eventId, reason),
    );
    return response
      ? { status: response.status }
      : { status: 0, notSent: true };
  }
}
