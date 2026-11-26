import { createInterface } from "node:readline";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { ModelMessage } from "ai";
import { z } from "zod";
import { AgentSettingsStore } from "../src/main/agent-settings.js";
import {
  AssistantMemoryStore,
  MemoryError,
} from "../src/main/assistant-memory.js";
import { AvailabilityService } from "../src/main/availability.js";
import { isAvailabilityRequest } from "../src/main/availability-request.js";
import { AvailabilitySessions } from "../src/main/availability-session.js";
import {
  CalendarError,
  CalendarService,
  isCalendarReadPath,
  type CalendarSession,
} from "../src/main/calendar.js";
import { CalendarConversation } from "../src/main/calendar-conversation.js";
import { createCalendarToolExecutor } from "../src/main/calendar-tools.js";
import { mayRunCalendarTool } from "../src/main/calendar-tool-policy.js";
import { EventChangeService } from "../src/main/event-change.js";
import { LocalCipher, LocalSecrets } from "../src/main/local-secrets.js";
import { MemoryProposals } from "../src/main/memory-proposals.js";
import { useMemorySelection } from "../src/main/memory-tools.js";
import { ParticipantMemory } from "../src/main/participant-memory.js";
import { ProfileError, ProfileStore } from "../src/main/profiles.js";
import { TopicRuleStore } from "../src/main/topic-rules.js";
import type {
  AgentControl,
  AgentEvent,
  AgentHistoryEvent,
} from "../src/shared/assistant.js";
import type { AgentSettingsState } from "../src/shared/agent-settings.js";
import {
  memoryWrite,
  type MemoryChange,
} from "../src/shared/assistant-memory.js";
import {
  analysisQuery,
  availabilityOpeningSchema,
} from "../src/shared/availability-analysis.js";
import type {
  CalendarToolCall,
  CalendarToolExecutor,
} from "../src/shared/calendar-tools.js";
import type { SmallAuthState } from "../src/shared/small-auth.js";
import { addDateDays } from "../src/shared/calendar-time.js";
import { createVoiceController } from "../src/main/voice/controller.js";

const profileDir = process.argv[2] ?? "";
if (!profileDir) throw new Error("Assistant profile required");
const vault = join(profileDir, "local-vault");
const secrets = new LocalSecrets(vault, new LocalCipher(vault));
const profiles = new ProfileStore(profileDir, secrets);
const settings = new AgentSettingsStore(profileDir);
const topics = new TopicRuleStore(profileDir);
const memory = new AssistantMemoryStore(profileDir, secrets);
const participants = new ParticipantMemory(profileDir, memory);
const availability = new AvailabilitySessions();
const voiceOwner = {};
let voice: ReturnType<typeof createVoiceController> | undefined;
const owner = 1;
let epoch = 0;

const send = (message: unknown) =>
  process.stdout.write(JSON.stringify(message) + "\n");
const emit = (name: string, data: unknown) =>
  send({ type: "event", name, data });
let nextId = 0;
const pending = new Map<number, (data: unknown) => void>();
function goCall<T>(
  method: string,
  input?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const abort = () => {
      pending.delete(id);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    pending.set(id, (data) => {
      signal?.removeEventListener("abort", abort);
      resolve(data as T);
    });
    send({ type: "call", id, method, input });
  });
}

type Session = {
  account: Extract<SmallAuthState, { status: "signed-in" }>["profile"];
  revision: number;
};
async function session(signal?: AbortSignal): Promise<Session | null> {
  const result = await goCall<{ state?: SmallAuthState; revision: number }>(
    "auth",
    undefined,
    signal,
  );
  return result.state?.status === "signed-in"
    ? { account: result.state.profile, revision: result.revision }
    : null;
}

function calendarSession(current: Session, signal?: AbortSignal) {
  const transport: CalendarSession = {
    async readCalendar(accountId, action) {
      if (accountId !== current.account.id)
        throw new CalendarError("auth", "Аккаунт Small изменился.");
      signal?.throwIfAborted();
      return action(async (path, body) => {
        signal?.throwIfAborted();
        if (
          body === undefined
            ? !isCalendarReadPath(path)
            : !isAvailabilityRequest(path, body)
        )
          throw new CalendarError("denied", "Операция календаря недоступна.");
        const result = await goCall<{ status: number; body: string }>(
          "read-calendar",
          { accountId, revision: current.revision, path, body },
          signal,
        );
        const status = result.status || 503;
        return new Response(
          [204, 205, 304].includes(status) ? null : result.body,
          { status },
        );
      }, current.account.participantId);
    },
  };
  return {
    calendar: new CalendarService(transport),
    availability: new AvailabilityService(transport),
    changes: new EventChangeService(transport),
  };
}

async function validateMemory(
  account: string,
  change: MemoryChange,
  current: Session,
) {
  if (change.action !== "group" && change.action !== "preset") return;
  const { calendar } = calendarSession(current);
  const state = await memory.read(account);
  const people = await useMemorySelection(
    change.value,
    state,
    account,
    calendar,
    AbortSignal.timeout(30_000),
    current.account.participantId,
  );
  if (people && (change.action === "group" || change.value.participantIds))
    change.value.people = people;
}
const proposals = new MemoryProposals(memory, async (account, change) => {
  const current = await session();
  if (current?.account.id !== account)
    throw new MemoryError("Аккаунт Small изменился.", "unavailable");
  await validateMemory(account, change, current);
});
const requestSchema = z.strictObject({
  requestId: z.uuid(),
  conversationId: z.string().min(1).max(100).optional(),
  prompt: z.string().trim().min(1).max(2000),
});
const cancelledRequests = new Set<string>();
let conversationId = "";
let conversation = new CalendarConversation();
let job:
  | {
      requestId: string;
      controller: AbortController;
      timer: NodeJS.Timeout;
      worker?: Worker;
    }
  | undefined;
type Job = NonNullable<typeof job>;

function sendAssistant(data: AgentEvent) {
  emit("small:assistant", data);
}
function finish(current: Job, abort = false, error?: string) {
  if (job !== current) return;
  job = undefined;
  clearTimeout(current.timer);
  current.controller.abort();
  if (error)
    sendAssistant({
      requestId: current.requestId,
      type: "chunk",
      chunk: { type: "error", errorText: error },
    });
  if (abort)
    sendAssistant({
      requestId: current.requestId,
      type: "chunk",
      chunk: { type: "abort" },
    });
  sendAssistant({ requestId: current.requestId, type: "end" });
  if (current.worker) {
    const worker = current.worker;
    if (abort) {
      worker.postMessage({ type: "cancel" } satisfies AgentControl);
      setTimeout(() => void worker.terminate(), 250).unref();
    } else void worker.terminate();
  }
}
function resetAssistant() {
  epoch++;
  if (job) finish(job, true);
  conversation = new CalendarConversation();
  conversationId = "";
  availability.clear();
}
function start(input: unknown) {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "Некорректный запрос ассистенту" };
  if (job)
    return { ok: false, error: "Дождитесь ответа или остановите запрос" };
  const request = parsed.data;
  if (cancelledRequests.delete(request.requestId))
    return { ok: false, error: "Запрос остановлен" };
  const id = request.conversationId ?? request.requestId;
  if (id !== conversationId) {
    conversation = new CalendarConversation();
    conversationId = id;
  }
  const current: Job = {
    requestId: request.requestId,
    controller: new AbortController(),
    timer: setTimeout(
      () =>
        finish(
          current,
          true,
          "Ассистент не ответил вовремя. Попробуйте ещё раз.",
        ),
      120_000,
    ),
  };
  job = current;
  void run(current, request, conversation);
  return { ok: true };
}

async function run(
  currentJob: Job,
  request: z.infer<typeof requestSchema>,
  state: CalendarConversation,
) {
  const signal = currentJob.controller.signal;
  try {
    const configuration = await settings.read();
    const model = await profiles.resolveActive(signal);
    const synthetic = process.env.SMALL_WAILS_TEST_SYNTHETIC === "1";
    if (!model && !synthetic)
      throw new ProfileError(
        "Модель не настроена. Откройте настройки модели и сохраните API-ключ.",
      );
    const current = model ? await session(signal) : null;
    state.bindAccount(current?.account.id ?? null);
    let execute: CalendarToolExecutor | null = null;
    if (current) {
      const account = current.account;
      const {
        calendar,
        availability: availabilityService,
        changes,
      } = calendarSession(current, signal);
      try {
        state.forgetMemoryEvidence((await memory.read(account.id)).revision);
      } catch {
        state.forgetMemoryEvidence(undefined);
      }
      execute = createCalendarToolExecutor(
        account.id,
        request.prompt,
        signal,
        calendar,
        availabilityService,
        account.name,
        undefined,
        state,
        participants,
        account.participantId,
        () => topics.read(),
        changes,
        {
          store: memory,
          proposals,
          ownerId: owner,
          epoch: current.revision,
          messageId: request.requestId,
          directory: calendar,
        },
      );
    }
    const context = current
      ? availability.context(owner, current.account.id)
      : undefined;
    if (context && current && state.matchesAccount(context.query.accountId)) {
      state.availability = context;
      state.selected = context.people.map((p) => p.participantId);
      state.selectionConfirmed = true;
      for (const person of context.people)
        state.people.set(person.participantId, person);
      state.taskPreferences = {
        ...state.taskPreferences,
        durationMinutes: context.query.durationMinutes,
        timeFrom: context.query.timeFrom,
        timeTo: context.query.timeTo,
      };
    } else state.clearAvailability();

    signal.throwIfAborted();
    const worker = new Worker(new URL("./agent-worker.mjs", import.meta.url), {
      env: {},
      stdout: true,
      stderr: true,
    });
    worker.stdout.resume();
    worker.stderr.resume();
    currentJob.worker = worker;
    worker.on("error", () =>
      finish(currentJob, false, "Ассистент остановился. Попробуйте ещё раз."),
    );
    worker.on("exit", () =>
      finish(currentJob, false, "Ассистент остановился. Попробуйте ещё раз."),
    );
    worker.on(
      "message",
      (event: AgentEvent | AgentHistoryEvent | CalendarToolCall) => {
        if (job !== currentJob || event.requestId !== request.requestId) return;
        if (event.type === "history")
          state.commit(request.prompt, event.messages as ModelMessage[]);
        else if (event.type === "end") finish(currentJob);
        else if (event.type === "chunk") sendAssistant(event);
        else if (
          current &&
          execute &&
          z.uuid().safeParse(event.callId).success
        ) {
          void tool(currentJob, current, configuration, execute, event, worker);
        }
      },
    );
    worker.postMessage({
      type: "start",
      request,
      profile: model,
      calendar: execute !== null,
      configuration,
      history: state.messages,
      availability: state.availability,
    } satisfies AgentControl);
  } catch (error) {
    finish(
      currentJob,
      false,
      error instanceof ProfileError
        ? error.message
        : "Не удалось запустить ассистента",
    );
  }
}

async function tool(
  currentJob: Job,
  current: Session,
  config: AgentSettingsState,
  execute: CalendarToolExecutor,
  event: CalendarToolCall,
  worker: Worker,
) {
  const signal = currentJob.controller.signal;
  try {
    let result = mayRunCalendarTool(event, config)
      ? await execute(event.name, event.input)
      : ({ ok: false, kind: "denied", error: "Навык отключён" } as const);
    signal.throwIfAborted();
    if (result.ok && "kind" in result.data) {
      if (result.data.kind === "meeting-draft") {
        const registered = await goCall<boolean>(
          "register-draft",
          { revision: current.revision, draft: result.data },
          signal,
        );
        if (!registered)
          result = {
            ok: false,
            kind: "invalid",
            error: "Черновик недоступен для текущего аккаунта.",
          };
      } else if (result.data.kind === "event-list")
        emit("small:event-list", result.data);
      else if (
        result.data.kind === "availability-analysis" &&
        availability.deliver(owner, event.requestId, event.callId)
      )
        emit("small:availability", result.data);
    }
    if (job === currentJob)
      worker.postMessage({
        type: "calendar-result",
        callId: event.callId,
        result,
      } satisfies AgentControl);
  } catch {
    finish(currentJob, true);
  }
}

async function memoryAction(action: string, input: unknown) {
  const generation = epoch;
  const assertCurrent = () => {
    if (generation !== epoch)
      throw new MemoryError("Аккаунт Small изменился.", "unavailable");
  };
  try {
    const current = await session();
    assertCurrent();
    if (!current)
      return {
        ok: false,
        kind: "denied",
        error: "Войдите в Small, чтобы управлять памятью.",
      };
    const account = current.account.id;
    let state;
    switch (action) {
      case "memory.read":
        state = await memory.read(account);
        break;
      case "memory.write": {
        const q = memoryWrite.parse(input);
        await validateMemory(account, q.change, current);
        assertCurrent();
        state = await memory.write(account, q, undefined, assertCurrent);
        break;
      }
      case "memory.reset":
        state = await memory.reset(account, assertCurrent);
        break;
      case "memory.confirm":
        state = await proposals.confirm(
          account,
          z.strictObject({ id: z.uuid() }).parse(input).id,
          owner,
          current.revision,
          assertCurrent,
        );
        break;
    }
    assertCurrent();
    return { ok: true, accountId: account, state };
  } catch (error) {
    return {
      ok: false,
      kind: error instanceof MemoryError ? error.kind : "invalid",
      error:
        error instanceof MemoryError || error instanceof CalendarError
          ? error.message
          : "Не удалось прочитать или сохранить память.",
    };
  }
}

async function invoke(method: string, input: unknown) {
  try {
    switch (method) {
      case "voice.request": {
        voice ??= createVoiceController(
          join(profileDir, "voice"),
          process.argv[3] ?? "",
        );
        if (
          input &&
          typeof input === "object" &&
          "action" in input &&
          input.action === "transcribe" &&
          "pcm" in input
        ) {
          if (
            typeof input.pcm !== "string" ||
            input.pcm.length > 10_240_000 ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(input.pcm)
          )
            return { ok: false, error: "Некорректный аудиосигнал" };
          const buffer = Buffer.from(input.pcm, "base64");
          input = {
            ...input,
            pcm: buffer.buffer.slice(
              buffer.byteOffset,
              buffer.byteOffset + buffer.byteLength,
            ),
          };
        }
        return voice.request(input, { owner: voiceOwner });
      }
      case "reminders.events": {
        const current = await session();
        if (!current) return { account: "", events: [] };
        const day = z.iso.date().parse(input);
        const { calendar } = calendarSession(
          current,
          AbortSignal.timeout(22_000),
        );
        const events = [];
        for (const date of [day, addDateDays(day, 1)]) {
          const { events: found, issues } = await calendar.events({
            accountId: current.account.id,
            date,
            view: "day",
            myCalendar: true,
            calendarIds: [],
          });
          if (issues.length) throw new Error("Календарь неполон");
          events.push(...found);
        }
        return { account: current.account.id, events };
      }
      case "reminders.detail": {
        const current = await session();
        const inputRecord = z
          .object({
            account: z.string(),
            lookup: z.union([
              z.object({ id: z.string() }),
              z.object({ originalEventId: z.string(), date: z.iso.date() }),
            ]),
          })
          .parse(input);
        if (!current || current.account.id !== inputRecord.account) return null;
        return calendarSession(
          current,
          AbortSignal.timeout(22_000),
        ).calendar.detail({
          accountId: inputRecord.account,
          lookup: inputRecord.lookup,
        });
      }
      case "assistant.start":
        return start(input);
      case "assistant.cancel":
        if (typeof input !== "string" || !z.uuid().safeParse(input).success)
          return null;
        if (job && job.requestId === input) finish(job, true);
        else {
          cancelledRequests.add(input);
          if (cancelledRequests.size > 64)
            cancelledRequests.delete(cancelledRequests.values().next().value!);
        }
        return null;
      case "session.reset":
        resetAssistant();
        return null;
      case "availability.read":
      case "availability.slots": {
        const current = await session();
        if (!current)
          return { ok: false, kind: "auth", error: "Войдите в Small." };
        const query =
          method === "availability.read" ? analysisQuery.parse(input) : input;
        const service = calendarSession(current).availability;
        try {
          const data = await (method === "availability.read"
            ? service.analyze(query)
            : service.find(query));
          return { ok: true, data };
        } catch (error) {
          if (error instanceof CalendarError)
            return { ok: false, kind: error.kind, error: error.message };
          return {
            ok: false,
            kind: "network",
            error: "Не удалось проверить доступность.",
          };
        }
      }
      case "availability.context": {
        if (input === null) availability.close(owner, job?.requestId);
        else {
          const parsed = availabilityOpeningSchema.safeParse(input);
          if (parsed.success) availability.set(owner, parsed.data);
        }
        return null;
      }
      case "profiles.read":
        return { ok: true, state: await profiles.state() };
      case "profiles.save":
        resetAssistant();
        return { ok: true, state: await profiles.save(input) };
      case "profiles.activate":
        resetAssistant();
        return { ok: true, state: await profiles.activate(input) };
      case "profiles.remove":
        resetAssistant();
        return { ok: true, state: await profiles.remove(input) };
      case "settings.read":
        return { ok: true, state: await settings.read() };
      case "settings.save":
        return { ok: true, state: await settings.save(input) };
      case "settings.reset":
        return { ok: true, state: await settings.reset() };
      case "topics.read":
        return { ok: true, rules: await topics.read() };
      case "topics.save":
        return { ok: true, rules: await topics.save(input) };
      case "memory.read":
      case "memory.write":
      case "memory.confirm":
      case "memory.reset":
        return memoryAction(method, input);
      case "memory.revision":
        return (await memory.read(z.string().min(1).max(200).parse(input)))
          .revision;
      default:
        return { ok: false, error: "Операция ассистента недоступна" };
    }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof ProfileError
          ? error.message
          : "Не удалось выполнить операцию ассистента",
    };
  }
}

createInterface({ input: process.stdin, crlfDelay: Infinity })
  .on("line", (line) => {
    if (line.length > 16 * 1024 * 1024) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.type === "result") {
      const resolve = pending.get(message.id);
      pending.delete(message.id);
      resolve?.(message.data);
    } else if (
      message.type === "request" &&
      Number.isSafeInteger(message.id) &&
      typeof message.method === "string"
    ) {
      void invoke(message.method, message.input).then((data) =>
        send({ type: "reply", id: message.id, data }),
      );
    }
  })
  .on("close", async () => {
    if (job) finish(job, true);
    await voice?.stop().catch(() => {});
    process.exit(0);
  });
