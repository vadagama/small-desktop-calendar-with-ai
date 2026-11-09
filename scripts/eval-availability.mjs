/** Run with node --import tsx. Only synthetic calendar/memory data reaches the model. */
import { readFile, mkdtemp, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { createProfileModel } from "../src/agent/provider.ts";
import { streamCalendarTurn } from "../src/agent/calendar-runtime.ts";
import { createCalendarToolExecutor } from "../src/main/calendar-tools.ts";
import { CalendarConversation } from "../src/main/calendar-conversation.ts";
import { AssistantMemoryStore } from "../src/main/assistant-memory.ts";
import { MemoryProposals } from "../src/main/memory-proposals.ts";
import { ProfileStore } from "../src/main/profiles.ts";
import { LocalCipher, LocalSecrets } from "../src/main/local-secrets.ts";
const cases = JSON.parse(
  await readFile(
    new URL("../tests/fixtures/availability-prompts.json", import.meta.url),
    "utf8",
  ),
);
let profile;
if (
  process.env.AVAILABILITY_EVAL_BASE_URL &&
  process.env.AVAILABILITY_EVAL_MODEL &&
  process.env.AVAILABILITY_EVAL_API_KEY
) {
  profile = {
    id: "personal",
    baseURL: process.env.AVAILABILITY_EVAL_BASE_URL,
    modelId: process.env.AVAILABILITY_EVAL_MODEL,
    apiKey: process.env.AVAILABILITY_EVAL_API_KEY,
  };
} else if (process.argv.includes("--configured-profile")) {
  const directory = join(
    homedir(),
    "Library",
    "Application Support",
    "Small Calendar",
  );
  try {
    await access(join(directory, "llm-profiles.json"));
    const vault = join(directory, "local-vault");
    profile = await new ProfileStore(
      directory,
      new LocalSecrets(vault, new LocalCipher(vault)),
    ).resolveActive();
  } catch {
    console.log(
      JSON.stringify({
        status: "unavailable",
        reason:
          "Configured model profile could not be resolved. No secrets or settings were changed.",
      }),
    );
    process.exit(2);
  }
}
if (!profile) {
  console.log(
    JSON.stringify({
      status: "unavailable",
      reason:
        "Configure an eval model through environment or --configured-profile.",
    }),
  );
  process.exit(2);
}
const people = [
  { participantId: "anna", name: "Анна Тестовая", position: "Тимлид" },
  { participantId: "ivan", name: "Иван Тестовый", position: "Тимлид" },
  { participantId: "alex1", name: "Александр Тестовый", position: "Отдел A" },
  { participantId: "alex2", name: "Александр Тестовый", position: "Отдел B" },
];
const results = [];
for (const entry of cases.filter(
  (c) =>
    !process.env.AVAILABILITY_EVAL_CASE ||
    c.id === process.env.AVAILABILITY_EVAL_CASE,
)) {
  const trace = [];
  const directory = await mkdtemp(join(tmpdir(), "availability-eval-"));
  const values = new Map();
  const store = new AssistantMemoryStore(directory, {
    get: async (k) => values.get(k) ?? null,
    set: async (k, v) => {
      values.set(k, v);
    },
    remove: async (k) => {
      values.delete(k);
    },
  });
  try {
    await store.write("synthetic", {
      revision: 0,
      requestId: crypto.randomUUID(),
      change: {
        action: "group",
        value: {
          name: "Тимлиды",
          participantIds: ["anna", "ivan"],
          people: people.slice(0, 2),
        },
      },
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    let opening;
    const conversation = new CalendarConversation();
    conversation.bindAccount("synthetic");
    const context = entry.context
      ? {
          kind: "availability-analysis",
          query: {
            accountId: "synthetic",
            participantIds: entry.context.participants,
            date: entry.context.date,
            period: entry.context.period,
            durationMinutes: entry.context.durationMinutes,
            includeWeekends: false,
            bufferMinutes: 0,
            timeFrom: "09:00",
            timeTo: "18:00",
          },
          people: people.filter((p) =>
            entry.context.participants.includes(p.participantId),
          ),
        }
      : undefined;
    if (context) {
      conversation.availability = context;
      conversation.selected = context.query.participantIds;
      conversation.selectionConfirmed = true;
      for (const person of context.people)
        conversation.people.set(person.participantId, person);
    }
    try {
      const execute = createCalendarToolExecutor(
        "synthetic",
        entry.prompt,
        controller.signal,
        {
          events: async () => ({ events: [], issues: [] }),
          searchPeople: async (input) => ({
            people: people.filter(
              (p) =>
                p.name
                  .toLocaleLowerCase()
                  .includes(input.query.toLocaleLowerCase()) ||
                input.query
                  .toLocaleLowerCase()
                  .includes(p.name.split(" ")[0].toLocaleLowerCase()) ||
                (/саш|алекс/iu.test(input.query) &&
                  p.participantId.startsWith("alex")),
            ),
            page: 1,
            nextPage: null,
          }),
        },
        {
          find: async () => {
            throw Error("Legacy slot cards are not the dashboard");
          },
        },
        "Тестовый организатор",
        undefined,
        conversation,
        undefined,
        "self",
        undefined,
        undefined,
        {
          store,
          proposals: new MemoryProposals(store),
          ownerId: 1,
          epoch: 1,
          messageId: entry.id,
        },
      );
      const result = await streamCalendarTurn(
        createProfileModel(profile),
        {
          prompt: entry.prompt,
          now: "2026-11-09T05:00:00Z",
          availability: context,
          abortSignal: controller.signal,
        },
        async (name, input) => {
          // No mutation tool can affect production; all state belongs to this temp fixture.
          if (
            name === "prepareMeetingDraft" ||
            name === "prepareMeetingDeletion"
          )
            return {
              ok: false,
              kind: "denied",
              error: "Тест доступности не создаёт встречи",
            };
          const reply = await execute(name, input);
          trace.push({
            name,
            input,
            ok: reply.ok,
            ...(!reply.ok ? { error: reply.error } : {}),
          });
          if (reply.ok && reply.data.kind === "availability-analysis")
            opening = reply.data;
          return reply;
        },
      );
      await result.consumeStream();
      const expected = entry.expected;
      let passed = expected.open === false ? !opening : Boolean(opening);
      if (passed && opening) {
        passed =
          opening.query.period === expected.period &&
          opening.query.date === expected.date &&
          opening.query.durationMinutes === expected.durationMinutes &&
          expected.participants.length ===
            opening.query.participantIds.length &&
          expected.participants.every((id) =>
            opening.query.participantIds.includes(id),
          );
      }
      results.push({
        id: entry.id,
        passed,
        ...(!passed ? { trace } : {}),
        opened: Boolean(opening),
        ...(opening
          ? {
              period: opening.query.period,
              date: opening.query.date,
              durationMinutes: opening.query.durationMinutes,
              participantIds: opening.query.participantIds,
            }
          : {}),
      });
    } catch {
      results.push({
        id: entry.id,
        passed: false,
        error: "Model/transport failed; inspect configured service separately.",
      });
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  console.log(JSON.stringify(results.at(-1)));
}
console.log(
  JSON.stringify({
    model: profile.modelId,
    passed: results.filter((r) => r.passed).length,
    total: results.length,
  }),
);
if (results.some((r) => !r.passed)) process.exitCode = 1;
