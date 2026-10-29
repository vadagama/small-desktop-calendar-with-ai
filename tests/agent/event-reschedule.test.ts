import assert from "node:assert/strict";
import { test } from "node:test";
import { EventRescheduleService } from "../../src/main/event-reschedule.js";
const event = {
  id: "42",
  creator_id: "person-a",
  title: "Synthetic",
  description: "Agenda",
  location: "Room",
  starts_at: "2099-10-29T09:00:00+05:00",
  ends_at: "2099-10-29T10:00:00+05:00",
  timezone: "Asia/Almaty",
  is_recurring: false,
  is_public: false,
  participants: [{ id: "person-a" }],
  notification_recipients: [],
  attachments: [],
  calendar_ids: [1],
};
const input = {
  accountId: "account-a",
  eventId: "42",
  beforeStart: event.starts_at,
  beforeEnd: event.ends_at,
  startsAt: "2099-10-29T10:00:00+05:00",
  endsAt: "2099-10-29T11:00:00+05:00",
};
function fixture(patch = {}, status = 200) {
  let value = { ...event, ...patch };
  const writes: unknown[] = [];
  const service = new EventRescheduleService({
    readCalendar: async (_id, action) =>
      action(async () => Response.json({ data: value }), "person-a"),
    updateCalendarEvent: async (_id, _event, payload) => {
      writes.push(payload);
      if (status === 200)
        value = {
          ...value,
          title: payload.title,
          starts_at: payload.starts_at,
          ends_at: payload.ends_at,
        };
      return Response.json({ data: value }, { status });
    },
  });
  return { service, writes };
}
test("reschedule preserves meeting fields and verifies new interval", async () => {
  const { service, writes } = fixture();
  await service.reschedule(input);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], {
    title: event.title,
    description: event.description,
    location: event.location,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    timezone: "Asia/Almaty",
    is_recurring: false,
    is_public: false,
    participant_ids: ["person-a"],
    notification_recipient_ids: [],
    attachments: [],
    calendar_ids: [1],
  });
});
test("reschedule refuses stale, foreign and recurring meetings before writing", async () => {
  for (const patch of [
    { creator_id: "other" },
    { is_recurring: true },
    { original_event_id: "1" },
    { starts_at: "2099-10-29T08:00:00+05:00" },
  ]) {
    const { service, writes } = fixture(patch);
    await assert.rejects(service.reschedule(input));
    assert.equal(writes.length, 0);
  }
});
test("conflict is never forced or retried", async () => {
  const { service, writes } = fixture({}, 409);
  await assert.rejects(service.reschedule(input));
  assert.equal(writes.length, 1);
});
test("invalid interval cannot write", async () => {
  const { service, writes } = fixture();
  await assert.rejects(
    service.reschedule({ ...input, endsAt: input.startsAt }),
  );
  assert.equal(writes.length, 0);
});

test("incomplete event details cannot erase recipients or attachments", async () => {
  for (const patch of [
    { attachments: undefined },
    { notification_recipients: undefined },
    { calendar_ids: undefined },
  ]) {
    const { service, writes } = fixture(patch);
    await assert.rejects(service.reschedule(input));
    assert.equal(writes.length, 0);
  }
});
test("unconfirmed and failed writes are not retried", async () => {
  let writes = 0;
  const service = new EventRescheduleService({
    readCalendar: async (_id, action) =>
      action(async () => Response.json({ data: event }), "person-a"),
    updateCalendarEvent: async () => {
      writes++;
      return Response.json({ data: event });
    },
  });
  await assert.rejects(service.reschedule(input), /подтвердить/);
  assert.equal(writes, 1);
});
test("only invited identity may reply", async () => {
  let writes = 0;
  for (const participantId of ["outsider", "person-a"]) {
    const service = new EventRescheduleService({
      readCalendar: async (_id, action) =>
        action(async () => Response.json({ data: event }), participantId),
      updateCalendarEvent: async () => {
        throw Error("Unexpected update");
      },
      respondCalendarEvent: async (_id, eventId, status) => {
        assert.equal(eventId, "42");
        assert.equal(status, "accepted");
        writes++;
        return Response.json({ data: { status } });
      },
    });
    if (participantId === "outsider")
      await assert.rejects(
        service.respond({
          accountId: "account-a",
          eventId: "42",
          status: "accepted",
        }),
      );
    else
      await service.respond({
        accountId: "account-a",
        eventId: "42",
        status: "accepted",
      });
  }
  assert.equal(writes, 1);
});

test("rename directly preserves the original time and participants", async () => {
  const { service, writes } = fixture();
  await service.applyChange({
    accountId: input.accountId,
    eventId: "42",
    change: { kind: "rename", title: "Renamed" },
  });
  assert.equal(writes.length, 1);
  const body = writes[0] as Record<string, unknown>;
  assert.equal(body.title, "Renamed");
  assert.equal(body.starts_at, event.starts_at);
  assert.deepEqual(body.participant_ids, ["person-a"]);
});
test("direct changes reject foreign organizers and recurring events", async () => {
  for (const patch of [{ creator_id: "other" }, { is_recurring: true }]) {
    const { service, writes } = fixture(patch);
    await assert.rejects(
      service.applyChange({
        accountId: input.accountId,
        eventId: "42",
        change: { kind: "cancel" },
      }),
    );
    assert.equal(writes.length, 0);
  }
});
test("delete sends one request without a preview and accepts 204", async () => {
  let writes = 0;
  const service = new EventRescheduleService({
    readCalendar: async (_id, action) =>
      action(async () => Response.json({ data: event }), "person-a"),
    updateCalendarEvent: async () => {
      throw new Error("unexpected update");
    },
    deleteCalendarEvent: async () => {
      writes++;
      return new Response(null, { status: 204 });
    },
  });
  await service.applyChange({
    accountId: input.accountId,
    eventId: "42",
    change: { kind: "cancel" },
  });
  assert.equal(writes, 1);
});

test("past days cannot be changed or used as a move destination", async () => {
  const past = {
    starts_at: "2000-01-01T09:00:00+05:00",
    ends_at: "2000-01-01T10:00:00+05:00",
  };
  const { service, writes } = fixture(past);
  await assert.rejects(
    service.reschedule({
      ...input,
      beforeStart: past.starts_at,
      beforeEnd: past.ends_at,
    }),
    /прошедшие/,
  );
  for (const change of [{ kind: "rename", title: "New" }, { kind: "cancel" }]) {
    await assert.rejects(
      service.applyChange({
        accountId: input.accountId,
        eventId: input.eventId,
        change,
      }),
      /прошедшие/,
    );
  }
  assert.equal(writes.length, 0);
  const current = fixture();
  await assert.rejects(
    current.service.reschedule({
      ...input,
      startsAt: past.starts_at,
      endsAt: past.ends_at,
    }),
    /прошедшие/,
  );
  assert.equal(current.writes.length, 0);
});

test("recurring event with an id moves only a single occurrence and preserves its rule", async () => {
  const rule = { FREQ: "WEEKLY", BYDAY: ["TH"] };
  const { service, writes } = fixture({
    is_recurring: true,
    recurrence_rule: rule,
  });
  await service.reschedule(input);
  assert.equal(writes.length, 1);
  assert.equal(
    (writes[0] as Record<string, unknown>).recurring_edit_type,
    "single",
  );
  assert.equal((writes[0] as Record<string, unknown>).is_recurring, true);
  assert.deepEqual(
    (writes[0] as Record<string, unknown>).recurrence_rule,
    rule,
  );
});
