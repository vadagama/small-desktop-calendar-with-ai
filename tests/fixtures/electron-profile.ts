import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AgentSettingsStore } from "../../src/main/agent-settings.js";
import { AssistantMemoryStore } from "../../src/main/assistant-memory.js";
import { EventCache, eventRangeKey } from "../../src/main/event-cache.js";
import {
  EventMutationJournal,
  mutationHash,
} from "../../src/main/event-mutation-journal.js";
import { LocalCipher, LocalSecrets } from "../../src/main/local-secrets.js";
import { MeetingJournal } from "./electron-profile/meeting-journal.js";
import { ParticipantMemory } from "../../src/main/participant-memory.js";
import { ProfileStore } from "../../src/main/profiles.js";
import { ReminderStore } from "./electron-profile/reminder-store.js";
import { TopicRuleStore } from "../../src/main/topic-rules.js";
import type { MemoryChange } from "../../src/shared/assistant-memory.js";

const [mode, directory, date] = process.argv.slice(2);
assert(directory && date);
const account = "fixture-import-a";
const other = "fixture-import-b";
const vault = join(directory, "local-vault");
const cipher = new LocalCipher(vault);
const secrets = new LocalSecrets(vault, cipher);
const profiles = new ProfileStore(directory, secrets);
const settings = new AgentSettingsStore(directory);
const reminders = new ReminderStore(directory);
const memory = new AssistantMemoryStore(directory, secrets);
const topics = new TopicRuleStore(directory);
const cache = new EventCache(join(directory, "event-cache"), cipher);
const key = eventRangeKey({
  date,
  view: "day",
  myCalendar: true,
  calendarIds: [],
});
const event = {
  key: "event:fixture",
  lookup: { id: "fixture" },
  title: "Imported calendar snapshot",
  startsAt: date + "T09:00:00+05:00",
  endsAt: date + "T09:35:00+05:00",
  calendarIds: [],
  organizer: "",
  description: "",
  location: "",
};
const sent = "a".repeat(64);
const profileInput = {
  id: "personal",
  baseURL: "https://example.invalid/v1",
  modelId: "fixture-model",
  apiKey: "synthetic-shared-key-1379",
};
const rules = [{ topic: "Fixture topic", keywords: ["fixture"] }];
const participant = {
  participantId: "fixture-person",
  name: "Fixture Person",
  position: "",
};
if (mode === "write") {
  await settings.save({
    ...(await settings.read()).settings,
    mood: "strict",
    instructions: "Imported instructions",
  });
  await topics.save(rules);
  await profiles.save(profileInput);
  await profiles.activate(profileInput.id);
  await reminders.save({ enabled: false, minutes: 17 });
  await reminders.claim(sent, Date.now(), Date.now());
  await mkdir(join(directory, "assistant-templates"), { recursive: true });
  await writeFile(
    join(directory, "assistant-templates", "welcome.md"),
    "Imported welcome",
  );
  await mkdir(join(directory, "voice"), { recursive: true });
  await writeFile(join(directory, "voice", "source.json"), '"fixture-mic"');
  await writeFile(
    join(directory, "voice", "ggml-large-v3-turbo.bin.part"),
    "partial fixture",
  );

  const remember = new ParticipantMemory(directory, memory);
  await remember.remember(account, participant, "Fixture alias");
  const changes: MemoryChange[] = [
    { action: "preferences", value: { durationMinutes: 35 } },
    { action: "entry", text: "Only account A" },
    {
      action: "group",
      value: {
        name: "Imported group",
        participantIds: [participant.participantId],
      },
    },
  ];
  for (const change of changes) {
    await memory.write(account, {
      revision: (await memory.read(account)).revision,
      requestId: crypto.randomUUID(),
      change,
    });
  }
  const savedMemory = await memory.read(account);
  await memory.write(account, {
    revision: savedMemory.revision,
    requestId: crypto.randomUUID(),
    change: {
      action: "preset",
      value: { name: "Imported format", groupId: savedMemory.groups[0]!.id },
    },
  });
  await new ParticipantMemory(directory).remember(
    other,
    participant,
    "Legacy alias B",
  );
  await memory.write(other, {
    revision: (await memory.read(other)).revision,
    requestId: crypto.randomUUID(),
    change: { action: "entry", text: "Only account B" },
  });
  await secrets.set(
    "small-auth-session-v1",
    JSON.stringify({
      version: 3,
      username: "fixture-a",
      accountId: account,
      expired: false,
      session: JSON.stringify({
        csrf: "00000000-0000-4000-8000-000000000025",
        cookies: [
          {
            name: "fixture-cookie",
            value: "synthetic-session",
            domain: ".small.kz",
            path: "/gate/auth/refresh",
            secure: true,
            httpOnly: true,
            sameSite: "lax",
          },
        ],
      }),
    }),
  );
  await cache.putEvents(account, key, { events: [event], issues: [] });
  await cache.putEvents(other, key, {
    events: [{ ...event, title: "Other account's snapshot" }],
    issues: [],
  });
  await cache.putCatalog(account, "calendars", [
    { id: "room", name: "Imported room" },
  ]);
  await cache.putCatalog(account, JSON.stringify(["people", "fixture", 1]), {
    people: [participant],
    page: 1,
    nextPage: null,
  });
  await new EventMutationJournal(join(directory, "event-mutations")).claim(
    account,
    "fixture-event",
    {
      requestHash: sent,
      resultHash: sent,
      kind: "update",
      acknowledged: false,
    },
  );
  await new EventMutationJournal(join(directory, "event-mutations")).claim(
    "fixture&<\u2028>\\u2029",
    "fixture-special",
    {
      requestHash: sent,
      resultHash: sent,
      kind: "update",
      acknowledged: false,
    },
  );
  await new EventMutationJournal(join(directory, "series-mutations")).claim(
    account,
    "series:fixture-series",
    {
      requestHash: sent,
      resultHash: sent,
      kind: "series-cancel",
      acknowledged: false,
    },
  );
  await new MeetingJournal(join(directory, "meeting-operations")).claim(
    mutationHash([
      account,
      [participant.participantId],
      "2099-01-15T04:00:00.000Z",
      "2099-01-15T04:30:00.000Z",
    ]),
    sent,
  );
} else {
  const savedSettings = await settings.read();
  assert.equal(savedSettings.settings.mood, "strict");
  assert.equal(savedSettings.settings.instructions, "Imported instructions");
  assert.equal(savedSettings.templates.welcome, "Imported welcome");
  assert.deepEqual(await topics.read(), rules);
  assert.equal((await profiles.resolveActive())?.apiKey, profileInput.apiKey);
  const savedReminders = await reminders.read();
  assert.deepEqual(savedReminders.settings, { enabled: false, minutes: 17 });
  assert(savedReminders.sent[sent]);
  const a = await memory.read(account);
  const b = await memory.read(other);
  assert.equal(a.preferences.durationMinutes, 35);
  assert.deepEqual(
    a.entries
      .map((entry) => entry.text)
      .filter((text) => text.startsWith("Only")),
    ["Only account A"],
  );
  assert(a.participants[0]?.aliases.includes("Fixture alias"));
  assert.equal(a.groups[0]?.name, "Imported group");
  assert.equal(a.presets[0]?.groupId, a.groups[0]?.id);
  assert(b.entries.some((entry) => entry.text === "Only account B"));
  assert(!b.entries.some((entry) => entry.text === "Only account A"));
  assert(b.participants[0]?.aliases.includes("Legacy alias B"));
  assert.equal(
    (await cache.getEvents(account, key))?.events[0]?.title,
    event.title,
  );
  assert.equal(
    (await cache.getEvents(other, key))?.events[0]?.title,
    "Other account's snapshot",
  );
  const legacySession = await secrets.get("small-auth-session-v1");
  assert.equal(legacySession !== null, mode === "source");
}
