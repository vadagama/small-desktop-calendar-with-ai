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

const interval = z
  .strictObject({
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
  })
  .refine((value) => Date.parse(value.start) < Date.parse(value.end));

const query = z.strictObject({
  accountId: z.string().min(1).max(200),
  participantIds,
  date: availabilityDate,
  durationMinutes,
  includeWeekends: z.boolean().optional(),
  exactInterval: interval.optional(),
  bufferMinutes: z.number().int().min(0).max(120).optional(),
  organizerParticipantId: z.string().min(1).max(128).optional(),
  timeFrom: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  timeTo: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
});
const responseStatus = z.literal("success").optional();
const slotsResponse = z.strictObject({
  status: responseStatus,
  data: z.strictObject({
    available_slots: z.array(interval).max(1000),
    has_more: z.boolean().optional(),
  }),
});
// Aggregate/omitted records do not establish that every participant was checked.
const busyResponse = z.strictObject({
  status: responseStatus,
  data: z
    .array(
      z
        .strictObject({
          type: z.literal("participant"),
          id: z.string().min(1).optional(),
          participant_id: z.string().min(1).optional(),
          busy_slots: z.array(interval).max(5000),
        })
        .refine(
          (record) =>
            Boolean(record.id || record.participant_id) &&
            (!record.id ||
              !record.participant_id ||
              record.id === record.participant_id),
        )
        .transform((record) => ({
          participant_id: record.id ?? record.participant_id!,
          busy_slots: record.busy_slots,
        })),
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
    if (q.timeFrom && q.timeTo && q.timeFrom >= q.timeTo)
      throw new CalendarError(
        "invalid",
        "Начало диапазона должно быть раньше окончания.",
      );
    const weekday = new Date(`${q.date}T12:00:00Z`).getUTCDay();
    const isWeekend = weekday === 0 || weekday === 6;
    if (!q.includeWeekends && isWeekend)
      throw new CalendarError(
        "invalid",
        "Выберите рабочий день: подбор выполняется без выходных.",
      );
    return this.session.readCalendar(q.accountId, async (request) => {
      const common = {
        participant_ids: q.participantIds,
        timezone: "Asia/Almaty" as const,
      };
      // Выходные: сетка слотов Small не применяется, интервал проверяется только по занятости.
      const weekendInterval =
        q.includeWeekends && isWeekend ? q.exactInterval : undefined;
      const rawSlots = weekendInterval
        ? {
            success: true as const,
            data: {
              data: { available_slots: [weekendInterval], has_more: false },
            },
          }
        : slotsResponse.safeParse(
            await calendarJson(
              await request("/gate/team/api/calendar/events/find-slots", {
                ...common,
                start_date: q.date,
                duration_minutes: q.durationMinutes,
                include_weekends: q.includeWeekends ?? false,
              }),
            ),
          );
      if (!rawSlots.success)
        throw new CalendarError(
          "invalid",
          "Small вернул неизвестный формат свободных слотов.",
        );
      if (rawSlots.data.data.has_more)
        throw new CalendarError(
          "invalid",
          "Small вернул неполный список свободных интервалов. Доступность не подтверждена.",
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
      const buffer = (q.bufferMinutes ?? 0) * 60000;
      if (
        buffer &&
        (!q.organizerParticipantId ||
          !q.participantIds.includes(q.organizerParticipantId))
      )
        throw new CalendarError(
          "invalid",
          "Не удалось проверить перерыв организатора.",
        );
      const range = calendarRange(q.date, "day");
      if (buffer) {
        const start = Date.parse(range.start),
          end = Date.parse(range.end);
        const sides = [
          {
            delta: -1,
            needed: rawSlots.data.data.available_slots.some(
              (s) => Date.parse(s.start) - buffer < start,
            ),
          },
          {
            delta: 1,
            needed: rawSlots.data.data.available_slots.some(
              (s) => Date.parse(s.end) + buffer > end,
            ),
          },
        ];
        for (const side of sides) {
          if (!side.needed) continue;
          const date = new Date(`${q.date}T12:00:00Z`);
          date.setUTCDate(date.getUTCDate() + side.delta);
          const neighbor = busyResponse.safeParse(
            await calendarJson(
              await request("/gate/team/api/calendar/events/busy-intervals", {
                participant_ids: [q.organizerParticipantId],
                timezone: "Asia/Almaty",
                date: date.toISOString().slice(0, 10),
              }),
            ),
          );
          if (
            !neighbor.success ||
            neighbor.data.data.length !== 1 ||
            neighbor.data.data[0]?.participant_id !== q.organizerParticipantId
          )
            throw new CalendarError(
              "invalid",
              "Нет полной занятости соседнего дня: перерыв не проверен.",
            );
          records.push(...neighbor.data.data);
        }
      }
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
          padding:
            record.participant_id === q.organizerParticipantId ? buffer : 0,
        })),
      );
      const now = this.now();
      const slots = rawSlots.data.data.available_slots.filter((slot) => {
        const start = Date.parse(slot.start),
          end = Date.parse(slot.end);
        return (
          start >= now &&
          (!q.timeFrom ||
            start >= Date.parse(`${q.date}T${q.timeFrom}:00+05:00`)) &&
          (!q.timeTo || end <= Date.parse(`${q.date}T${q.timeTo}:00+05:00`)) &&
          start >= Date.parse(range.start) &&
          end <= Date.parse(range.end) &&
          end - start === q.durationMinutes * 60000 &&
          !busy.some(
            (taken) =>
              taken.start - taken.padding < end &&
              taken.end + taken.padding > start,
          )
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
