import { z } from "zod";
import {
  CalendarError,
  calendarJson,
  type CalendarSession,
} from "./calendar.js";
import {
  availabilityDate,
  durationMinutes,
  participantIds,
} from "./availability-request.js";
import { calendarRange } from "../shared/calendar-time.js";

const query = z.strictObject({
  accountId: z.string().min(1).max(200),
  participantIds,
  date: availabilityDate,
  durationMinutes,
});
const interval = z
  .strictObject({
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
  })
  .refine((value) => Date.parse(value.start) < Date.parse(value.end));
const slotsResponse = z.strictObject({
  data: z.strictObject({ available_slots: z.array(interval).max(1000) }),
});
// Aggregate/omitted records do not establish that every participant was checked.
const busyResponse = z.strictObject({
  data: z
    .array(
      z.strictObject({
        type: z.literal("participant"),
        participant_id: z.string(),
        busy_slots: z.array(interval).max(5000),
      }),
    )
    .max(20),
});

export class AvailabilityService {
  constructor(
    private session: CalendarSession,
    private now: () => number = Date.now,
  ) {}
  async find(input: unknown) {
    const parsed = query.safeParse(input);
    if (!parsed.success)
      throw new CalendarError(
        "invalid",
        "Проверьте участников, дату и длительность встречи.",
      );
    const q = parsed.data;
    const weekday = new Date(`${q.date}T12:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6)
      throw new CalendarError(
        "invalid",
        "Выберите рабочий день: подбор выполняется без выходных.",
      );
    return this.session.readCalendar(q.accountId, async (request) => {
      const common = {
        participant_ids: q.participantIds,
        timezone: "Asia/Almaty" as const,
      };
      const rawSlots = slotsResponse.safeParse(
        await calendarJson(
          await request("/gate/team/api/calendar/events/find-slots", {
            ...common,
            start_date: q.date,
            duration_minutes: q.durationMinutes,
            include_weekends: false,
          }),
        ),
      );
      if (!rawSlots.success)
        throw new CalendarError(
          "invalid",
          "Small вернул неизвестный формат свободных слотов.",
        );
      const rawBusy = busyResponse.safeParse(
        await calendarJson(
          await request("/gate/team/api/calendar/events/busy-intervals", {
            ...common,
            date: q.date,
          }),
        ),
      );
      if (!rawBusy.success)
        throw new CalendarError(
          "invalid",
          "Формат занятости неизвестен. Свободное время не подтверждено.",
        );
      const records = rawBusy.data.data;
      const ids = new Set(records.map((record) => record.participant_id));
      if (
        records.length !== q.participantIds.length ||
        ids.size !== records.length ||
        q.participantIds.some((id) => !ids.has(id))
      )
        throw new CalendarError(
          "invalid",
          "Нет полной занятости каждого участника. Свободное время не подтверждено.",
        );
      if (
        records.reduce((count, record) => count + record.busy_slots.length, 0) >
        5000
      )
        throw new CalendarError(
          "invalid",
          "В ответе слишком много интервалов занятости. Сузьте состав участников.",
        );
      const busy = records.flatMap((record) =>
        record.busy_slots.map((slot) => ({
          start: Date.parse(slot.start),
          end: Date.parse(slot.end),
        })),
      );
      const range = calendarRange(q.date, "day");
      const now = this.now();
      const slots = rawSlots.data.data.available_slots.filter((slot) => {
        const start = Date.parse(slot.start),
          end = Date.parse(slot.end);
        return (
          start >= now &&
          start >= Date.parse(range.start) &&
          end <= Date.parse(range.end) &&
          end - start === q.durationMinutes * 60000 &&
          !busy.some((taken) => taken.start < end && taken.end > start)
        );
      });
      return {
        slots: [
          ...new Map(
            slots.map((slot) => [
              `${Date.parse(slot.start)}:${Date.parse(slot.end)}`,
              slot,
            ]),
          ).values(),
        ].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
        participantIds: q.participantIds,
        date: q.date,
        durationMinutes: q.durationMinutes,
        timezone: common.timezone,
      };
    });
  }
}
