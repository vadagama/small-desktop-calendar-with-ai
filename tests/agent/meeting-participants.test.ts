import assert from "node:assert/strict";
import { test } from "node:test";
import { createCalendarToolExecutor } from "../../src/main/calendar-tools.js";
import type { CalendarEvent } from "../../src/shared/calendar.js";
const event: CalendarEvent = {
  key: "event:meeting",
  lookup: { id: "meeting" },
  title: "Synthetic meeting",
  startsAt: "2099-11-20T10:00:00+05:00",
  endsAt: "2099-11-20T11:00:00+05:00",
  calendarIds: ["7"],
  participation: "organizer",
  organizerId: "self",
  organizer: "Organizer",
  description: "Keep agenda",
  location: "Room",
  recurring: false,
  participants: [
    { id: "self", name: "Organizer", status: "accepted", organizer: true },
    { id: "existing", name: "Existing", status: "accepted", organizer: false },
  ],
  notificationRecipients: [{ id: "informed", name: "Informed" }],
  attachments: [{ id: "file", name: "Synthetic" }],
};
function setup(value = event) {
  const execute = createCalendarToolExecutor(
    "account",
    "Добавь нового участника",
    new AbortController().signal,
    {
      events: async () => ({ events: [value], issues: [] }),
      detail: async () => value,
      searchPeople: async () => ({
        people: [
          { participantId: "new", name: "New Person", position: "Tester" },
        ],
        page: 1,
        nextPage: null,
      }),
    },
    {
      find: async () => {
        throw Error("No scheduling needed");
      },
    },
    "Organizer",
    undefined,
    undefined,
    undefined,
    "self",
  );
  return execute;
}
const input = { key: event.key, date: "2099-11-20", participantIds: ["new"] };
test("assistant prepares additive participant change preserving all existing event fields", async () => {
  const execute = setup();
  await execute("searchPeople", { query: "New", page: 1 });
  await execute("selectParticipants", { participantIds: ["new"] });
  const result = await execute("prepareMeetingParticipants", input);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const data = result.data as unknown as {
    kind: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  };
  assert.deepEqual(data.after.attachments, ["file"]);
  assert.deepEqual(data.after.notification_recipient_ids, ["informed"]);
  assert.equal(data.kind, "meeting-participants");
  assert.deepEqual(data.after, {
    ...data.before,
    participant_ids: ["self", "existing", "new"],
  });
  assert.deepEqual(data.before.participant_ids, ["self", "existing"]);
});
test("assistant participant change rejects unverified people and non-organizers", async () => {
  assert.equal((await setup()("prepareMeetingParticipants", input)).ok, false);
  const execute = setup({
    ...event,
    participation: "invited",
    organizerId: "other",
  });
  await execute("searchPeople", { query: "New", page: 1 });
  await execute("selectParticipants", { participantIds: ["new"] });
  assert.equal((await execute("prepareMeetingParticipants", input)).ok, false);
});

test("participant preparation refuses series, past events, and already invited people", async () => {
  for (const value of [
    {
      ...event,
      startsAt: "2000-11-20T10:00:00+05:00",
      endsAt: "2000-11-20T11:00:00+05:00",
    },
    { ...event, recurring: true },
    { ...event, originalEventId: "series" },
    {
      ...event,
      participants: [
        ...event.participants!,
        { id: "new", name: "New Person", status: "pending", organizer: false },
      ],
    },
  ]) {
    const execute = setup(value);
    await execute("searchPeople", { query: "New", page: 1 });
    await execute("selectParticipants", { participantIds: ["new"] });
    assert.equal(
      (
        await execute("prepareMeetingParticipants", {
          ...input,
          date: value.startsAt.slice(0, 10),
        })
      ).ok,
      false,
    );
  }
});
