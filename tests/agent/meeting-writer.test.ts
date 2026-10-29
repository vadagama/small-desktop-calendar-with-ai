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
