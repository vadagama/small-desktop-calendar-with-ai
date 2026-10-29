import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import type { MeetingDraft } from "../../src/shared/meeting-draft.js";
import { SmallMeetingWriter } from "../../src/main/meeting-writer.js";
import { meetingPayload } from "../../src/main/meeting-request.js";
function draft(): MeetingDraft {
  return {
    kind: "meeting-draft",
    status: "preview",
    id: randomUUID(),
    revision: 1,
    title: "Synthetic",
    agenda: "Plan",
    organizer: { id: "a", name: "A" },
    participantIds: ["p"],
    startsAt: "2099-10-29T04:30:00.000Z",
    endsAt: "2099-10-29T05:00:00.000Z",
    durationMinutes: 30,
    timezone: "Asia/Almaty",
    location: "",
    conferenceUrl: "https://meet.small.kz/test",
    recurrence: "none",
    visibility: "private",
    availabilityCheckedAt: "2026-10-29T00:00:00.000Z",
  };
}
test("verification requires the exact event ID, fields and full participant set", async () => {
  const d = draft();
  let event: unknown = {
    ...meetingPayload(d),
    id: "42",
    participants: [{ id: "p" }],
  };
  let reads = 0;
  const service = new SmallMeetingWriter(
    {
      createCalendarEvent: async () => {
        throw new Error("no writes");
      },
      readCalendar: async (_account, run) =>
        run(async () => {
          reads++;
          return Response.json({ data: event });
        }),
    },
    { events: async () => ({ events: [], issues: [] }) },
    {
      find: async () => {
        throw new Error("unused");
      },
    },
  );
  assert.equal(await service.verify(d, "42"), true);
  for (const change of [
    { title: "different" },
    { description: "missing agenda" },
    { location: "other" },
    { is_public: true },
    { is_recurring: true },
    { participants: [] },
    { id: "43" },
    { ends_at: "2099-10-29T05:30:00Z" },
  ]) {
    event = {
      ...meetingPayload(d),
      id: "42",
      participants: [{ id: "p" }],
      ...change,
    };
    assert.equal(await service.verify(d, "42"), false);
  }
  assert.equal(await service.verify(d), false);
  assert.equal(reads, 9);
  await assert.rejects(service.verify(d, "../42"));
});

test("room conflicts and incomplete room reads prevent creation", async () => {
  const d = draft();
  d.options = {
    calendarIds: [7],
    attachmentIds: [],
    notificationRecipientIds: [],
    recurrence: null,
  };
  for (const incomplete of [true, false]) {
    const service = new SmallMeetingWriter(
      {
        createCalendarEvent: async () => {
          throw new Error("no write");
        },
        readCalendar: async () => {
          throw new Error("unused");
        },
      },
      {
        events: async () => ({
          issues: incomplete
            ? [{ kind: "denied", source: "7", message: "denied" }]
            : [],
          events: incomplete
            ? []
            : [
                {
                  key: "room",
                  lookup: { id: "7" },
                  title: "Busy",
                  startsAt: d.startsAt,
                  endsAt: d.endsAt,
                  calendarIds: ["7"],
                  description: "",
                  organizer: "",
                  location: "",
                },
              ],
        }),
      },
      {
        find: async () => ({
          slots: [{ start: d.startsAt, end: d.endsAt }],
          participantIds: d.participantIds,
          date: "2099-10-29",
          durationMinutes: 30,
          timezone: "Asia/Almaty",
        }),
      },
    );
    await assert.rejects(service.preflight(d), /Переговорная/);
  }
});

test("a later recurrence conflict blocks the whole series before create", async () => {
  const d = draft();
  d.options = {
    calendarIds: [],
    attachmentIds: [],
    notificationRecipientIds: [],
    recurrence: { FREQ: "WEEKLY", BYDAY: ["TH"], UNTIL: "2099-11-05" },
  };
  d.recurrence = "weekly";
  const checked: string[] = [];
  const service = new SmallMeetingWriter(
    {
      createCalendarEvent: async () => {
        throw new Error("no writes");
      },
      readCalendar: async () => {
        throw new Error("unused");
      },
    },
    { events: async () => ({ events: [], issues: [] }) },
    {
      find: async (input) => {
        const q = input as { date: string };
        checked.push(q.date);
        return {
          slots:
            q.date === "2099-10-29"
              ? [{ start: d.startsAt, end: d.endsAt }]
              : [],
          participantIds: d.participantIds,
          date: q.date,
          durationMinutes: 30,
          timezone: "Asia/Almaty",
        };
      },
    },
  );
  await assert.rejects(service.preflight(d), /Время больше не свободно/);
  assert.deepEqual(checked, ["2099-10-29", "2099-11-05"]);
});

test("verification accepts empty nullable fields and server-added calendars", async () => {
  const d = draft();
  d.agenda = "";
  d.conferenceUrl = "";
  d.options = {
    calendarIds: [7],
    attachmentIds: [],
    notificationRecipientIds: [],
    recurrence: null,
  };
  let calendars = [7, 99];
  const writer = new SmallMeetingWriter(
    {
      createCalendarEvent: async () => {
        throw Error("no writes");
      },
      readCalendar: async (_account, run) =>
        run(async () =>
          Response.json({
            data: {
              ...meetingPayload(d),
              id: 42,
              description: null,
              location: null,
              calendar_ids: calendars,
              participants: [{ id: "p" }],
            },
          }),
        ),
    },
    { events: async () => ({ events: [], issues: [] }) },
    {
      find: async () => {
        throw Error("unused");
      },
    },
  );
  assert.equal(await writer.verify(d, "42"), true);
  calendars = [99];
  assert.equal(await writer.verify(d, "42"), false);
  d.options.calendarIds = [];
  assert.equal(await writer.verify(d, "42"), true);
  d.agenda = "Required description";
  assert.equal(await writer.verify(d, "42"), false);
});
