import assert from "node:assert/strict";
import { test } from "node:test";
import { createCalendarToolExecutor } from "../../src/main/calendar-tools.js";
import { CalendarError } from "../../src/main/calendar.js";
import type { CalendarEvent } from "../../src/shared/calendar.js";

const event: CalendarEvent = {
  key: "event-a",
  lookup: { id: "a" },
  title: "Тестовая встреча",
  startsAt: "2026-11-02T14:00:00+05:00",
  endsAt: "2026-11-02T14:30:00+05:00",
  calendarIds: [],
  organizer: "Тестовый организатор",
  description: "",
  location: "",
};
function fixture(
  overrides: Partial<CalendarEvent> = {},
  denied = false,
  incomplete = false,
) {
  const previews: unknown[] = [];
  const execute = createCalendarToolExecutor(
    "account-a",
    "Удали встречу в понедельник",
    new AbortController().signal,
    {
      searchPeople: async () => ({ people: [], page: 1, nextPage: null }),
      events: async () => ({
        events: [{ ...event, ...overrides }],
        issues: incomplete
          ? [{ source: "my", kind: "network", message: "Недоступно" }]
          : [],
      }),
    },
    {
      find: async () => {
        throw new Error("Unused");
      },
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      preview: async (input) => {
        previews.push(input);
        if (denied) throw new CalendarError("denied", "Только организатор");
        return {
          eventId: "a",
          kind: "cancel",
          before: { ...event, participantIds: [] },
          afterTitle: null,
          checkedAt: new Date().toISOString(),
        };
      },
    },
  );
  return { execute, previews };
}
const input = { key: "event-a", date: "2026-11-02" };
test("assistant deletion prepares an account-bound confirmation from fresh calendar data", async () => {
  const { execute, previews } = fixture();
  const result = await execute("prepareMeetingDeletion", input);
  assert.equal(result.ok, true);
  if (result.ok)
    assert.deepEqual(result.data, {
      kind: "meeting-delete",
      accountId: "account-a",
      eventId: "a",
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
    });
  assert.deepEqual(previews, [
    { accountId: "account-a", eventId: "a", change: { kind: "cancel" } },
  ]);
});
test("deletion refuses invented keys, account injection, incomplete calendars and recurring instances", async () => {
  for (const [overrides, query, incomplete] of [
    [{}, { ...input, key: "made-up" }, false],
    [{}, { ...input, accountId: "other" }, false],
    [{ recurring: true }, input, false],
    [{ originalEventId: "series" }, input, false],
    [{ lookup: { originalEventId: "series", date: input.date } }, input, false],
    [{}, input, true],
  ] as const) {
    const { execute, previews } = fixture(overrides, false, incomplete);
    assert.equal((await execute("prepareMeetingDeletion", query)).ok, false);
    assert.equal(previews.length, 0);
  }
});
test("deletion propagates organizer permission refusal", async () => {
  const { execute } = fixture({}, true);
  assert.deepEqual(await execute("prepareMeetingDeletion", input), {
    ok: false,
    kind: "denied",
    error: "Только организатор",
  });
});
