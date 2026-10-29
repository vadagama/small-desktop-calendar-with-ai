import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EventMutationJournal,
  mutationHash,
} from "../../src/main/event-mutation-journal.js";
const directory = mkdtempSync(join(tmpdir(), "event-mutations-"));
after(() => rmSync(directory, { recursive: true, force: true }));
const journal = () =>
  new EventMutationJournal(join(directory, crypto.randomUUID()));
import assert from "node:assert/strict";
import { test, after } from "node:test";
import { EventRescheduleService } from "../../src/main/event-reschedule.js";
import { CalendarError } from "../../src/main/calendar.js";
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
  const service = new EventRescheduleService(
    {
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
    },
    journal(),
  );
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
  const service = new EventRescheduleService(
    {
      readCalendar: async (_id, action) =>
        action(async () => Response.json({ data: event }), "person-a"),
      updateCalendarEvent: async () => {
        writes++;
        return Response.json({ data: event });
      },
    },
    journal(),
  );
  await assert.rejects(service.reschedule(input), /подтвердить/);
  assert.equal(writes, 1);
});
test("only invited identity may reply", async () => {
  let writes = 0;
  for (const participantId of ["outsider", "person-a"]) {
    const service = new EventRescheduleService(
      {
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
      },
      journal(),
    );
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
test("delete verifies absence after an acknowledged 204", async () => {
  let writes = 0;
  const service = new EventRescheduleService(
    {
      readCalendar: async (_id, action) =>
        action(
          async () =>
            writes
              ? new Response(null, { status: 404 })
              : Response.json({ data: event }),
          "person-a",
        ),
      updateCalendarEvent: async () => {
        throw new Error("unexpected update");
      },
      deleteCalendarEvent: async () => {
        writes++;
        return new Response(null, { status: 204 });
      },
    },
    journal(),
  );
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

test("unknown writes remain blocked across restart and changed requests", async () => {
  const log = journal();
  let writes = 0;
  const session = {
    readCalendar: async <T>(
      _id: string,
      action: (
        get: (path: string) => Promise<Response>,
        person?: string,
      ) => Promise<T>,
    ) => action(async () => Response.json({ data: event }), "person-a"),
    updateCalendarEvent: async () => {
      writes++;
      throw Error("timeout");
    },
  };
  await assert.rejects(
    new EventRescheduleService(session, log).reschedule(input),
  );
  await assert.rejects(
    new EventRescheduleService(session, log).reschedule(input),
    /неизвестен/,
  );
  await assert.rejects(
    new EventRescheduleService(session, log).applyChange({
      accountId: input.accountId,
      eventId: "42",
      change: { kind: "rename", title: "Other" },
    }),
    /неизвестен/,
  );
  assert.equal(writes, 1);
});

test("a timed out update that reached the server is reconciled without another write", async () => {
  let value = { ...event };
  let writes = 0;
  const log = journal();
  const service = new EventRescheduleService(
    {
      readCalendar: async (_id, action) =>
        action(async () => Response.json({ data: value }), "person-a"),
      updateCalendarEvent: async (_id, _eventId, body) => {
        writes++;
        value = { ...value, title: body.title };
        throw Error("response lost");
      },
    },
    log,
  );
  const request = {
    accountId: input.accountId,
    eventId: "42",
    change: { kind: "rename", title: "Applied" },
  };
  await service.applyChange(request);
  await service.applyChange(request);
  assert.equal(writes, 1);
  assert.equal(await log.read(input.accountId, "42"), null);
});

test("successful status cannot hide changed fields and a later read can resolve the journal", async () => {
  let value = { ...event };
  let writes = 0;
  const log = journal();
  const session = {
    readCalendar: async <T>(
      _id: string,
      action: (
        get: (path: string) => Promise<Response>,
        person?: string,
      ) => Promise<T>,
    ) => action(async () => Response.json({ data: value }), "person-a"),
    updateCalendarEvent: async () => {
      writes++;
      value = { ...event, title: "Applied", description: "Unexpected change" };
      return Response.json({});
    },
  };
  const request = {
    accountId: input.accountId,
    eventId: "42",
    change: { kind: "rename", title: "Applied" },
  };
  await assert.rejects(
    new EventRescheduleService(session, log).applyChange(request),
    /неизвестен/,
  );
  value.description = event.description;
  await new EventRescheduleService(session, log).applyChange(request);
  assert.equal(writes, 1);
  assert.equal(await log.read(input.accountId, "42"), null);
});

test("delete timeout followed by 404 stays unknown even across restart", async () => {
  let writes = 0;
  const log = journal();
  const session = {
    readCalendar: async <T>(
      _id: string,
      action: (
        get: (path: string) => Promise<Response>,
        person?: string,
      ) => Promise<T>,
    ) =>
      action(
        async () =>
          writes
            ? new Response(null, { status: 404 })
            : Response.json({ data: event }),
        "person-a",
      ),
    updateCalendarEvent: async () => {
      throw Error("unexpected update");
    },
    deleteCalendarEvent: async () => {
      writes++;
      throw Error("response lost");
    },
  };
  const request = {
    accountId: input.accountId,
    eventId: "42",
    change: { kind: "cancel" },
  };
  await assert.rejects(
    new EventRescheduleService(session, log).applyChange(request),
    /неизвестен/,
  );
  await assert.rejects(
    new EventRescheduleService(session, log).applyChange(request),
    /неизвестен/,
  );
  assert.equal(writes, 1);
});

test("acknowledged deletion is reconciled after restart but 403 is not success", async () => {
  let writes = 0;
  let readStatus = 200;
  const log = journal();
  const session = {
    readCalendar: async <T>(
      _id: string,
      action: (
        get: (path: string) => Promise<Response>,
        person?: string,
      ) => Promise<T>,
    ) =>
      action(
        async () =>
          readStatus === 200
            ? Response.json({ data: event })
            : new Response(null, { status: readStatus }),
        "person-a",
      ),
    updateCalendarEvent: async () => {
      throw Error("unexpected update");
    },
    deleteCalendarEvent: async () => {
      writes++;
      readStatus = 403;
      return new Response(null, { status: 204 });
    },
  };
  const request = {
    accountId: input.accountId,
    eventId: "42",
    change: { kind: "cancel" },
  };
  await assert.rejects(
    new EventRescheduleService(session, log).applyChange(request),
    /неизвестен/,
  );
  readStatus = 404;
  await new EventRescheduleService(session, log).applyChange(request);
  assert.equal(writes, 1);
  assert.equal(await log.read(input.accountId, "42"), null);
});

test("journal is scoped by account and contains no event contents", async () => {
  const log = journal();
  let writes = 0;
  const session = {
    readCalendar: async <T>(
      _id: string,
      action: (
        get: (path: string) => Promise<Response>,
        person?: string,
      ) => Promise<T>,
    ) => action(async () => Response.json({ data: event }), "person-a"),
    updateCalendarEvent: async () => {
      writes++;
      throw Error("timeout");
    },
  };
  const request = {
    accountId: input.accountId,
    eventId: "42",
    change: { kind: "rename", title: "Private synthetic title" },
  };
  await assert.rejects(
    new EventRescheduleService(session, log).applyChange(request),
  );
  const entry = await log.read(input.accountId, "42");
  assert.ok(entry);
  assert.ok(!JSON.stringify(entry).includes("Private"));
  await assert.rejects(
    new EventRescheduleService(session, log).applyChange({
      ...request,
      accountId: "another-account",
    }),
  );
  assert.equal(writes, 2);
});

test("exclusive journal claims allow only one operation", async () => {
  const log = journal();
  const entry = {
    requestHash: "a".repeat(64),
    resultHash: "b".repeat(64),
    kind: "update" as const,
    acknowledged: false,
  };
  const results = await Promise.allSettled([
    log.claim("account", "event", entry),
    log.claim("account", "event", entry),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  assert.deepEqual(await log.read("account", "event"), entry);
});

test("corrupt durable state blocks writes instead of resetting the journal", async () => {
  const path = mkdtempSync(join(directory, "corrupt-"));
  writeFileSync(
    join(path, mutationHash([input.accountId, input.eventId]) + ".json"),
    "{",
  );
  let writes = 0;
  const service = new EventRescheduleService(
    {
      readCalendar: async (_id, action) =>
        action(async () => Response.json({ data: event }), "person-a"),
      updateCalendarEvent: async () => {
        writes++;
        return Response.json({});
      },
    },
    new EventMutationJournal(path),
  );
  await assert.rejects(service.reschedule(input));
  assert.equal(writes, 0);
});

test("only an outcome that could not be established is flagged unknown", async () => {
  const flag = (error: unknown) =>
    error instanceof CalendarError ? error.unknownOutcome : undefined;
  // An explicit refusal and failures before the write never reach "unknown".
  for (const make of [
    () => fixture({}, 409),
    () => fixture({ creator_id: "other" }),
    () => fixture({ starts_at: "2099-10-29T08:00:00+05:00" }),
  ])
    await assert.rejects(make().service.reschedule(input), (error) => {
      assert.equal(flag(error), false);
      return true;
    });
  // A write that failed and cannot be verified is unknown, and so is the blocked retry.
  const log = journal();
  const session = {
    readCalendar: async <T>(
      _id: string,
      action: (
        get: (path: string) => Promise<Response>,
        person?: string,
      ) => Promise<T>,
    ) => action(async () => Response.json({ data: event }), "person-a"),
    updateCalendarEvent: async () => {
      throw Error("timeout");
    },
  };
  for (let attempt = 0; attempt < 2; attempt++)
    await assert.rejects(
      new EventRescheduleService(session, log).reschedule(input),
      (error) => {
        assert.equal(flag(error), true);
        return true;
      },
    );
});
