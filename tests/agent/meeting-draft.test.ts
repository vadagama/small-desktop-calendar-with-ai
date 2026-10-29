import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareMeetingDraft } from "../../src/main/meeting-draft.js";

const input = {
  title: "Синтетическая встреча",
  agenda: "Обсудить план",
  participantIds: ["person-a"],
  startsAt: "2099-10-29T09:30:00+05:00",
  location: "",
  conference: { mode: "automatic" },
};
const organizer = { id: "account-a", name: "Организатор теста" };
const signal = new AbortController().signal;
const availability = {
  find: async (query: unknown) => {
    assert.deepEqual(query, {
      accountId: "account-a",
      participantIds: ["person-a"],
      date: "2099-10-29",
      durationMinutes: 30,
    });
    return {
      slots: [{ start: input.startsAt, end: "2099-10-29T10:00:00+05:00" }],
      participantIds: ["person-a"],
      date: "2099-10-29",
      durationMinutes: 30,
      timezone: "Asia/Almaty" as const,
    };
  },
};
test("prepares a read-only 30-minute draft with bound organizer and generated link", async () => {
  const draft = await prepareMeetingDraft(
    organizer,
    input,
    availability,
    signal,
  );
  assert.equal(draft.kind, "meeting-draft");
  assert.equal(draft.status, "preview");
  assert.equal(draft.durationMinutes, 30);
  assert.equal(draft.endsAt, "2099-10-29T05:00:00.000Z");
  assert.deepEqual(draft.organizer, organizer);
  assert.match(
    draft.conferenceUrl!,
    /^https:\/\/meet\.small\.kz\/[a-f0-9-]{36}$/,
  );
  assert.equal(draft.recurrence, "none");
  assert.equal(draft.visibility, "private");
});
test("keeps a user supplied HTTPS link and allows an explicit no-conference draft", async () => {
  const custom = await prepareMeetingDraft(
    organizer,
    {
      ...input,
      conference: { mode: "custom", url: "https://meet.example.test/room" },
    },
    availability,
    signal,
  );
  assert.equal(custom.conferenceUrl, "https://meet.example.test/room");
  const none = await prepareMeetingDraft(
    organizer,
    { ...input, conference: { mode: "none" } },
    availability,
    signal,
  );
  assert.equal(none.conferenceUrl, null);
});
test("does not produce a draft for an unavailable slot or unknown availability", async () => {
  await assert.rejects(
    prepareMeetingDraft(
      organizer,
      input,
      {
        find: async () => ({
          ...(await availability.find({
            accountId: "account-a",
            participantIds: ["person-a"],
            date: "2099-10-29",
            durationMinutes: 30,
          })),
          slots: [],
        }),
      },
      signal,
    ),
    /не подтверждён/,
  );
  await assert.rejects(
    prepareMeetingDraft(
      organizer,
      input,
      {
        find: async () => {
          throw new Error("availability failure");
        },
      },
      signal,
    ),
  );
});
test("rejects injected identity, recurrence, invalid date and unsafe conference URLs before I/O", async () => {
  const noRead = {
    find: async () => {
      assert.fail("invalid drafts must not read availability");
    },
  };
  for (const invalid of [
    { ...input, organizer: { id: "other" } },
    { ...input, recurrence: "weekly" },
    { ...input, startsAt: "2099-02-30T09:30:00+05:00" },
    { ...input, title: " " },
    { ...input, participantIds: ["person-a", "person-a"] },
    { ...input, conference: { mode: "custom", url: "javascript:alert(1)" } },
    {
      ...input,
      conference: { mode: "custom", url: "https://user:password@example.test" },
    },
  ])
    await assert.rejects(
      prepareMeetingDraft(organizer, invalid, noRead, signal),
    );
});
test("drops draft preparation after cancellation, including a late availability result", async () => {
  const controller = new AbortController();
  await assert.rejects(
    prepareMeetingDraft(organizer, input, availability, AbortSignal.abort()),
    { name: "AbortError" },
  );
  await assert.rejects(
    prepareMeetingDraft(
      organizer,
      input,
      {
        find: async (query) => {
          const result = await availability.find(query);
          controller.abort();
          return result;
        },
      },
      controller.signal,
    ),
    { name: "AbortError" },
  );
});

test("draft tool enforces the directory-verified complete participant selection before any read", async () => {
  const { createCalendarToolExecutor } =
    await import("../../src/main/calendar-tools.js");
  for (const prompt of [
    "Подготовь встречу",
    "Участники: [person-a, person-b]",
  ]) {
    const execute = createCalendarToolExecutor(
      organizer.id,
      prompt,
      signal,
      {
        searchPeople: async () => {
          throw new Error("unused");
        },
      },
      {
        find: async () => {
          assert.fail("unconfirmed participants must not reach API");
        },
      },
      organizer.name,
    );
    const result = await execute("prepareMeetingDraft", input);
    assert.equal(result.ok, false);
  }
  const execute = createCalendarToolExecutor(
    organizer.id,
    "Участники: [person-a]",
    signal,
    {
      searchPeople: async () => ({
        people: [
          {
            participantId: "person-a",
            name: "Тестовый участник",
            position: "",
          },
        ],
        page: 1,
        nextPage: null,
      }),
    },
    {
      find: async (query: unknown) => {
        const { includeWeekends, ...rest } = query as Record<string, unknown>;
        assert.equal(includeWeekends, true);
        return availability.find(rest);
      },
    },
    organizer.name,
  );
  await execute("searchPeople", { query: "Тестовый", page: 1 });
  await execute("selectParticipants", { participantIds: ["person-a"] });
  const result = await execute("prepareMeetingDraft", input);
  assert.ok(
    result.ok &&
      "kind" in result.data &&
      result.data.kind === "meeting-draft" &&
      result.data.organizer.name === organizer.name,
  );
});

test("includes the session participant GUID, not the account ID, in draft and availability", async () => {
  for (const ids of [["person-a"], ["person-a", "organizer-guid"]]) {
    const result = await prepareMeetingDraft(
      { ...organizer, participantId: "organizer-guid" },
      { ...input, participantIds: ids },
      {
        find: async (value: unknown) => {
          assert.deepEqual(
            (value as { participantIds: string[] }).participantIds,
            ["person-a", "organizer-guid"],
          );
          return {
            slots: [
              { start: input.startsAt, end: "2099-10-29T10:00:00+05:00" },
            ],
            participantIds: ["person-a", "organizer-guid"],
            date: "2099-10-29",
            durationMinutes: 30,
            timezone: "Asia/Almaty" as const,
          };
        },
      },
      signal,
    );
    assert.deepEqual(result.participantIds, ["person-a", "organizer-guid"]);
  }
});
