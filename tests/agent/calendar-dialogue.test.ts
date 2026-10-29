import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CalendarConversation } from "../../src/main/calendar-conversation.js";
import { createCalendarToolExecutor } from "../../src/main/calendar-tools.js";
import { ParticipantMemory } from "../../src/main/participant-memory.js";
import type { CalendarPerson, PeoplePage } from "../../src/shared/calendar.js";

const first: CalendarPerson = {
  participantId: "test-first",
  name: "Тестовый Виктор Первый",
  position: "Разработка",
};
const second: CalendarPerson = {
  participantId: "test-second",
  name: "Тестовый Виктор Второй",
  position: "Тестирование",
};
const query = {
  participantIds: [second.participantId],
  date: "2026-11-02",
  durationMinutes: 30,
};

function fixture(memory?: ParticipantMemory) {
  const conversation = new CalendarConversation();
  const availabilityReads: unknown[] = [];
  let directory: PeoplePage = {
    people: [first, second],
    page: 1,
    nextPage: null,
  };
  const turn = (prompt: string, account = "test-account") =>
    createCalendarToolExecutor(
      account,
      prompt,
      new AbortController().signal,
      {
        events: async () => ({ events: [], issues: [] }),
        searchPeople: async () => directory,
      },
      {
        find: async (input) => {
          availabilityReads.push(input);
          return { ...query, slots: [], timezone: "Asia/Almaty" };
        },
      },
      "Тестовый Организатор",
      (draft) => draft,
      conversation,
      memory,
    );
  return {
    conversation,
    availabilityReads,
    turn,
    directory: (page: PeoplePage) => {
      directory = page;
    },
  };
}

test("ambiguous people require another user turn and the chosen composition survives follow-ups", async () => {
  const f = fixture();
  const initial = f.turn("Создай встречу завтра после обеда с Витей");
  assert.equal(
    (await initial("searchPeople", { query: "Виктор", page: 1 })).ok,
    true,
  );
  assert.equal(
    (
      await initial("selectParticipants", {
        participantIds: [second.participantId],
      })
    ).ok,
    false,
  );
  assert.equal((await initial("findSlots", query)).ok, false);
  assert.equal(f.availabilityReads.length, 0);

  const clarification = f.turn("Второй, из тестирования");
  assert.deepEqual(
    await clarification("selectParticipants", {
      participantIds: [second.participantId],
    }),
    {
      ok: true,
      data: { kind: "participants", people: [second] },
    },
  );
  const followup = f.turn("Давай на полчаса");
  assert.equal((await followup("findSlots", query)).ok, true);
  assert.deepEqual(f.availabilityReads, [
    { ...query, accountId: "test-account" },
  ]);
});

test("an incomplete directory page is ambiguous even with only one returned person", async () => {
  const f = fixture();
  f.directory({ people: [first], page: 1, nextPage: 2 });
  const execute = f.turn("Найди Виктора");
  await execute("searchPeople", { query: "Виктор", page: 1 });
  assert.equal(
    (
      await execute("selectParticipants", {
        participantIds: [first.participantId],
      })
    ).ok,
    false,
  );
  assert.equal(f.availabilityReads.length, 0);
});

test("changing account clears prior directory evidence, composition and model history", async () => {
  const f = fixture();
  f.directory({ people: [second], page: 1, nextPage: null });
  const initial = f.turn("Встреча с Тестовым Виктором Вторым");
  await initial("searchPeople", { query: second.name, page: 1 });
  assert.equal(
    (
      await initial("selectParticipants", {
        participantIds: [second.participantId],
      })
    ).ok,
    true,
  );
  f.conversation.commit("Личные данные первого аккаунта", [
    { role: "assistant", content: "Уточнение" },
  ]);

  const switched = f.turn("Продолжим", "another-account");
  assert.deepEqual(f.conversation.messages, []);
  assert.equal(
    (
      await switched("selectParticipants", {
        participantIds: [second.participantId],
      })
    ).ok,
    false,
  );
  assert.equal((await switched("findSlots", query)).ok, false);
  assert.equal(f.availabilityReads.length, 0);
});

test("correcting a remembered alias transfers it to the selected person and survives restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "calendar-dialogue-"));
  try {
    const memory = new ParticipantMemory(directory);
    const f = fixture(memory);
    f.directory({ people: [first], page: 1, nextPage: null });
    const initial = f.turn("Запомни первого Виктора как Витю");
    await initial("searchPeople", { query: first.name, page: 1 });
    await initial("selectParticipants", {
      participantIds: [first.participantId],
    });
    assert.equal(
      (
        await initial("participantMemory", {
          action: "remember",
          participantId: first.participantId,
          alias: "Витя",
        })
      ).ok,
      true,
    );

    f.directory({ people: [second], page: 1, nextPage: null });
    const correction = f.turn("Нет, под Витей запомни второго Виктора");
    await correction("searchPeople", { query: second.name, page: 1 });
    await correction("selectParticipants", {
      participantIds: [second.participantId],
    });
    assert.equal(
      (
        await correction("participantMemory", {
          action: "remember",
          participantId: second.participantId,
          alias: "витя",
        })
      ).ok,
      true,
    );

    const remembered = await new ParticipantMemory(directory).read(
      "test-account",
    );
    assert.deepEqual(
      remembered.find((person) => person.participantId === first.participantId)
        ?.aliases,
      [],
    );
    assert.deepEqual(
      remembered.find((person) => person.participantId === second.participantId)
        ?.aliases,
      ["витя"],
    );
    assert.deepEqual(await memory.read("another-account"), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("frequent remembered people are hints and cannot bypass current directory evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "calendar-dialogue-"));
  try {
    const memory = new ParticipantMemory(directory);
    await memory.remember("test-account", second, "Витя");
    for (let i = 0; i < 3; i++) await memory.used("test-account", [second]);
    const f = fixture(memory);
    const execute = f.turn("Создай встречу с Витей");
    const recalled = await execute("participantMemory", { action: "recall" });
    assert.equal(recalled.ok, true);
    assert.equal(
      (
        await execute("selectParticipants", {
          participantIds: [second.participantId],
        })
      ).ok,
      false,
    );
    assert.equal((await execute("findSlots", query)).ok, false);
    assert.equal(f.availabilityReads.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("remembering an alias requires a selected directory person", async () => {
  const directory = await mkdtemp(join(tmpdir(), "calendar-dialogue-"));
  try {
    const memory = new ParticipantMemory(directory);
    const f = fixture(memory);
    const execute = f.turn("Запомни Витю");
    await execute("searchPeople", { query: "Виктор", page: 1 });
    assert.equal(
      (
        await execute("participantMemory", {
          action: "remember",
          participantId: second.participantId,
          alias: "Витя",
        })
      ).ok,
      false,
    );
    assert.deepEqual(await memory.read("test-account"), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("parallel participant selection cannot relabel a pending availability result or draft", async () => {
  for (const tool of ["findSlots", "prepareMeetingDraft"] as const) {
    let release!: () => void;
    const pendingRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    const start = "2099-10-29T14:00:00+05:00";
    const execute = createCalendarToolExecutor(
      "test-account",
      "Подбери время",
      new AbortController().signal,
      {
        events: async () => ({ events: [], issues: [] }),
        searchPeople: async ({ query }) => ({
          people: [query === "first" ? first : second],
          page: 1,
          nextPage: null,
        }),
      },
      {
        find: async () => {
          await pendingRead;
          return {
            participantIds: [first.participantId],
            date: "2099-10-29",
            durationMinutes: 30,
            timezone: "Asia/Almaty",
            slots: [{ start, end: "2099-10-29T14:30:00+05:00" }],
          };
        },
      },
    );
    await execute("searchPeople", { query: "first", page: 1 });
    await execute("searchPeople", { query: "second", page: 1 });
    await execute("selectParticipants", {
      participantIds: [first.participantId],
    });
    const pending = execute(
      tool,
      tool === "findSlots"
        ? {
            participantIds: [first.participantId],
            date: "2099-10-29",
            durationMinutes: 30,
          }
        : {
            participantIds: [first.participantId],
            title: "Тест",
            agenda: "",
            startsAt: start,
            durationMinutes: 30,
            location: "",
            conference: { mode: "none" },
          },
    );
    await execute("selectParticipants", {
      participantIds: [second.participantId],
    });
    release();
    const result = await pending;
    assert.ok(result.ok);
    assert.ok("participantIds" in result.data);
    assert.deepEqual(result.data.participantIds, [first.participantId]);
    if ("kind" in result.data && result.data.kind === "meeting-draft") {
      assert.deepEqual(result.data.participants, [first]);
    } else {
      assert.deepEqual((result.data as { people?: CalendarPerson[] }).people, [
        first,
      ]);
    }
  }
});

test("confirmed alias can resolve a revalidated person in a new chat but frequency and invented aliases cannot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alias-reuse-"));
  try {
    const memory = new ParticipantMemory(directory);
    await memory.remember("test-account", second, "Витя");
    const f = fixture(memory);
    const execute = f.turn("Встреча с Витей");
    const participantIds = [second.participantId];
    assert.equal(
      (
        await execute("selectParticipants", {
          participantIds,
          rememberedAliases: [
            { participantId: second.participantId, alias: "Витя" },
          ],
        })
      ).ok,
      false,
    );
    await execute("searchPeople", { query: "Тестовый Виктор", page: 1 });
    assert.equal(
      (await execute("selectParticipants", { participantIds })).ok,
      false,
    );
    assert.equal(
      (
        await execute("selectParticipants", {
          participantIds,
          rememberedAliases: [
            { participantId: second.participantId, alias: "Другое имя" },
          ],
        })
      ).ok,
      false,
    );
    assert.equal(
      (
        await execute("selectParticipants", {
          participantIds,
          rememberedAliases: [
            { participantId: second.participantId, alias: "Витя" },
          ],
        })
      ).ok,
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
