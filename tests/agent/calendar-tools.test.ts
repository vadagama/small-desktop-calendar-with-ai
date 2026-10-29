import assert from "node:assert/strict";
import { test } from "node:test";
import { createCalendarToolExecutor } from "../../src/main/calendar-tools.js";

const query = {
  participantIds: ["person-a"],
  date: "2026-11-02",
  durationMinutes: 30,
};
function setup(
  prompt = "Найди время завтра с Тестовым Участником",
  organizerParticipantId?: string,
) {
  const calls: unknown[] = [];
  const controller = new AbortController();
  const execute = createCalendarToolExecutor(
    "account-a",
    prompt,
    controller.signal,
    {
      events: async () => ({ events: [], issues: [] }),
      searchPeople: async (input: unknown) => {
        calls.push(input);
        return {
          people: [
            {
              participantId: "person-a",
              name: "Тестовый Участник",
              position: "Тестирование",
            },
          ],
          page: 1,
          nextPage: null,
        };
      },
    },
    {
      find: async (input: unknown) => {
        calls.push(input);
        return { ...query, slots: [], timezone: "Asia/Almaty" as const };
      },
    },
    "account-a",
    undefined,
    undefined,
    undefined,
    organizerParticipantId,
  );
  return { execute, calls, controller };
}
test("binds calendar tools to the account captured outside model input", async () => {
  const { execute, calls } = setup();
  assert.equal(
    (await execute("searchPeople", { query: "Тестовый", page: 1 })).ok,
    true,
  );
  const selected = await execute("selectParticipants", {
    participantIds: ["person-a"],
  });
  assert.deepEqual(selected, {
    ok: true,
    data: {
      kind: "participants",
      people: [
        {
          participantId: "person-a",
          name: "Тестовый Участник",
          position: "Тестирование",
        },
      ],
    },
  });
  const result = await execute("findSlots", query);
  assert.equal(result.ok, true);
  assert.deepEqual(calls.at(-1), { ...query, accountId: "account-a" });
});
test("literal participant IDs cannot bypass directory verification and selection", async () => {
  for (const prompt of [
    "Найди время для команды",
    "Участники: [person-a]",
    "Участники: [person-a, person-b]",
  ]) {
    const { execute, calls } = setup(prompt);
    assert.equal((await execute("findSlots", query)).ok, false);
    assert.equal(calls.length, 0);
  }
});
test("directory results alone do not select participants or authorize unknown IDs", async () => {
  const { execute, calls } = setup();
  await execute("searchPeople", { query: "Тестовый", page: 1 });
  assert.equal((await execute("findSlots", query)).ok, false);
  assert.equal(
    (await execute("selectParticipants", { participantIds: ["person-ab"] })).ok,
    false,
  );
  assert.equal(calls.length, 1);
});
test("availability cannot omit or add participants from the selected composition", async () => {
  const { execute, calls } = setup();
  await execute("searchPeople", { query: "Тестовый", page: 1 });
  assert.equal(
    (await execute("selectParticipants", { participantIds: ["person-a"] })).ok,
    true,
  );
  assert.equal(
    (
      await execute("findSlots", {
        ...query,
        participantIds: ["person-a", "person-b"],
      })
    ).ok,
    false,
  );
  assert.equal(calls.length, 1);
});
test("rejects account injection, unknown tools and extra parameters", async () => {
  const { execute, calls } = setup();
  for (const [name, input] of [
    ["findSlots", { ...query, accountId: "other" }],
    ["deleteEvent", {}],
    ["searchPeople", { query: "A", page: 1, url: "https://invalid" }],
  ] as const)
    assert.equal((await execute(name, input)).ok, false);
  assert.equal(calls.length, 0);
});
test("cancelled jobs cannot start calendar reads", async () => {
  const { execute, calls, controller } = setup();
  controller.abort();
  await assert.rejects(execute("findSlots", query), { name: "AbortError" });
  assert.equal(calls.length, 0);
});
test("unexpected failures do not leak service details", async () => {
  const execute = createCalendarToolExecutor(
    "a",
    "",
    new AbortController().signal,
    {
      events: async () => ({ events: [], issues: [] }),
      searchPeople: async () => {
        throw new Error("private server payload");
      },
    },
    {
      find: async () => {
        throw new Error("unused");
      },
    },
  );
  const result = await execute("searchPeople", { query: "Тест", page: 1 });
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes("private"));
});

test("discards a successful calendar response arriving after cancellation", async () => {
  const controller = new AbortController();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const execute = createCalendarToolExecutor(
    "account-a",
    "",
    controller.signal,
    {
      events: async () => ({ events: [], issues: [] }),
      searchPeople: async () => {
        await waiting;
        return { people: [], page: 1, nextPage: null };
      },
    },
    {
      find: async () => {
        throw new Error("unused");
      },
    },
  );
  const result = execute("searchPeople", { query: "Тест", page: 1 });
  controller.abort();
  release();
  await assert.rejects(result, { name: "AbortError" });
});

test("slot lookup always includes the organizer while retaining every selected guest", async () => {
  const { execute, calls } = setup(undefined, "organizer-guid");
  await execute("searchPeople", { query: "Тестовый", page: 1 });
  await execute("selectParticipants", { participantIds: ["person-a"] });
  for (const participantIds of [["person-a"], ["person-a", "organizer-guid"]]) {
    const result = await execute("findSlots", { ...query, participantIds });
    assert.equal(result.ok, true);
    assert.deepEqual(
      (calls.at(-1) as { participantIds: string[] }).participantIds,
      ["person-a", "organizer-guid"],
    );
  }
  assert.equal(
    (
      await execute("findSlots", {
        ...query,
        participantIds: ["organizer-guid"],
      })
    ).ok,
    false,
  );
});

test("schedule reads own account without participant selection and rejects account injection", async () => {
  const calls: unknown[] = [];
  const execute = createCalendarToolExecutor(
    "account-a",
    "Какие встречи сегодня?",
    new AbortController().signal,
    {
      searchPeople: async () => {
        throw Error("must not search participants");
      },
      events: async (input) => {
        calls.push(input);
        return { events: [], issues: [] };
      },
    },
    {
      find: async () => {
        throw Error("must not search slots");
      },
    },
  );
  assert.equal(
    (await execute("listMeetings", { period: "today", accountId: "other" })).ok,
    false,
  );
  assert.equal(calls.length, 0);
  const result = await execute("listMeetings", { period: "today" });
  assert.ok(
    result.ok &&
      "kind" in result.data &&
      result.data.kind === "schedule" &&
      result.data.complete,
  );
  assert.equal((calls[0] as { accountId: string }).accountId, "account-a");
});

test("analytics reads only the signed-in account with its participant id and rejects injection", async () => {
  const calls: unknown[] = [];
  const calendar = {
    searchPeople: async () => {
      throw Error("must not search participants");
    },
    events: async (input: unknown) => {
      calls.push(input);
      return {
        events: [
          {
            key: "a",
            lookup: { id: "a" },
            title: "Sync",
            startsAt: "2026-10-29T05:00:00Z",
            endsAt: "2026-10-29T06:00:00Z",
            calendarIds: [],
            organizer: "Анна",
            location: "",
            description: "",
            participation: "invited" as const,
            participants: [
              {
                id: "person-a",
                name: "Я",
                status: "accepted",
                organizer: false,
              },
            ],
          },
        ],
        issues: [],
      };
    },
  };
  const availability = {
    find: async () => {
      throw Error("must not search slots");
    },
  };
  const make = (participantId?: string) =>
    createCalendarToolExecutor(
      "account-a",
      "Сколько часов встреч сегодня?",
      new AbortController().signal,
      calendar,
      availability,
      "Я",
      undefined,
      undefined,
      undefined,
      participantId,
    );
  const execute = make("person-a");
  assert.equal(
    (await execute("meetingAnalytics", { period: "today", accountId: "x" })).ok,
    false,
  );
  assert.equal(calls.length, 0);
  const result = await execute("meetingAnalytics", { period: "today" });
  assert.ok(
    result.ok &&
      "kind" in result.data &&
      result.data.kind === "analytics" &&
      result.data.totals.count === 1,
  );
  assert.equal((calls[0] as { accountId: string }).accountId, "account-a");
  const unknown = await make()("meetingAnalytics", { period: "today" });
  assert.equal(unknown.ok, false);
  assert.equal(calls.length, 1);
});

test("analytics applies saved topic rules and reports an unreadable rules file", async () => {
  const calendar = {
    searchPeople: async () => {
      throw Error("must not search participants");
    },
    events: async () => ({
      events: [
        {
          key: "a",
          lookup: { id: "a" },
          title: "Daily standup",
          startsAt: "2026-10-29T05:00:00Z",
          endsAt: "2026-10-29T05:30:00Z",
          calendarIds: [],
          organizer: "Анна",
          location: "",
          description: "",
          participation: "organizer" as const,
        },
      ],
      issues: [],
    }),
  };
  const make = (
    rules: () => Promise<never[] | { topic: string; keywords: string[] }[]>,
  ) =>
    createCalendarToolExecutor(
      "account-a",
      "Темы встреч",
      new AbortController().signal,
      calendar,
      {
        find: async () => {
          throw Error("must not search slots");
        },
      },
      "Я",
      undefined,
      undefined,
      undefined,
      "person-a",
      rules,
    );
  const ok = await make(async () => [
    { topic: "Процесс", keywords: ["daily"] },
  ])("meetingAnalytics", { period: "today" });
  assert.ok(ok.ok && "kind" in ok.data && ok.data.kind === "analytics");
  assert.deepEqual(
    ok.data.byTopic.map((bucket) => bucket.name),
    ["Процесс"],
  );
  const broken = await make(async () => {
    throw new Error("secret path /Users/x/topic-rules.json");
  })("meetingAnalytics", { period: "today" });
  assert.equal(broken.ok, false);
  assert.ok(!broken.ok && /правила тем/.test(broken.error));
  assert.ok(!broken.ok && !broken.error.includes("/Users/"));
});
