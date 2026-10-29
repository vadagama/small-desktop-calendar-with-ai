import assert from "node:assert/strict";
import { test } from "node:test";
import { EventChangeService } from "../../src/main/event-change.js";
import type { CalendarSession } from "../../src/main/calendar.js";
const event = {
  id: "42",
  creator_id: "a",
  is_recurring: false,
  original_event_id: null,
  title: "Synthetic",
  description: "Agenda https://meet.small.kz/synthetic",
  location: "Room",
  starts_at: "2099-10-29T09:00:00+05:00",
  ends_at: "2099-10-29T09:30:00+05:00",
  participants: [{ id: "a" }, { id: "b" }],
};
function fixture(value: unknown = event, status = 200) {
  const reads: string[] = [];
  const session: CalendarSession = {
    readCalendar: async (account, run) => {
      assert.equal(account, "a");
      return run(async (path, body) => {
        assert.equal(body, undefined);
        reads.push(path);
        return Response.json({ data: value }, { status });
      });
    },
  };
  return { service: new EventChangeService(session), reads };
}
test("rename previews re-read the event and preserve all displayed fields", async () => {
  const { service, reads } = fixture();
  const result = await service.preview({
    accountId: "a",
    eventId: "42",
    change: { kind: "rename", title: " New " },
  });
  assert.equal(result.before.title, "Synthetic");
  assert.equal(result.afterTitle, "New");
  assert.equal(result.before.description, event.description);
  assert.deepEqual(result.before.participantIds, ["a", "b"]);
  assert.equal(result.before.startsAt, event.starts_at);
  assert.equal(result.before.location, "Room");
  assert.equal(result.kind, "rename");
  assert.deepEqual(reads, ["/gate/team/api/calendar/events/42"]);
  const cancel = await service.preview({
    accountId: "a",
    eventId: "42",
    change: { kind: "cancel" },
  });
  assert.equal(cancel.kind, "cancel");
  assert.equal(cancel.afterTitle, null);
  assert.equal(reads.length, 2);
});
test("preview rejects foreign, unknown, recurring and mismatched event identities", async () => {
  for (const patch of [
    { creator_id: "other" },
    { creator_id: undefined },
    { is_recurring: true },
    { is_recurring: undefined },
    { original_event_id: "1" },
    { recurrence_rule: { FREQ: "WEEKLY" } },
    { id: "43" },
    { participants: undefined },
  ]) {
    const { service } = fixture({ ...event, ...patch });
    await assert.rejects(
      service.preview({
        accountId: "a",
        eventId: "42",
        change: { kind: "cancel" },
      }),
    );
  }
});
test("invalid changes and virtual instances cannot reach the transport", async () => {
  const { service, reads } = fixture();
  for (const input of [
    { accountId: "a", eventId: "../42", change: { kind: "cancel" } },
    {
      accountId: "a",
      originalEventId: "42",
      date: "2099-10-29",
      change: { kind: "cancel" },
    },
    { accountId: "a", eventId: "42", change: { kind: "rename", title: "" } },
    { accountId: "a", eventId: "42", change: { kind: "cancel", force: true } },
  ])
    await assert.rejects(service.preview(input));
  assert.equal(reads.length, 0);
});
test("missing or denied events and unchanged titles are not valid previews", async () => {
  for (const status of [403, 404]) {
    const { service } = fixture(event, status);
    await assert.rejects(
      service.preview({
        accountId: "a",
        eventId: "42",
        change: { kind: "cancel" },
      }),
    );
  }
  const { service } = fixture();
  await assert.rejects(
    service.preview({
      accountId: "a",
      eventId: "42",
      change: { kind: "rename", title: "Synthetic" },
    }),
  );
});

test("preview resolves organizer GUID independently from session account ID", async () => {
  const session: CalendarSession = {
    readCalendar: async (_account, run) =>
      run(async () =>
        Response.json({ data: { ...event, creator_id: "guid-a" } }),
      ),
  };
  const service = new EventChangeService(session, async (account) => {
    assert.equal(account, "a");
    return "guid-a";
  });
  const result = await service.preview({
    accountId: "a",
    eventId: "42",
    change: { kind: "cancel" },
  });
  assert.equal(result.kind, "cancel");
});
