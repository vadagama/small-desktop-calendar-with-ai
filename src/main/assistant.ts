import { CalendarConversation } from "./calendar-conversation.js";
import type { AgentHistoryEvent } from "../shared/assistant.js";
import type { AgentSettingsState } from "../shared/agent-settings.js";
import type {
  CalendarToolExecutor,
  CalendarToolCall,
} from "../shared/calendar-tools.js";
import {
  app,
  ipcMain,
  utilityProcess,
  type IpcMainInvokeEvent,
  type UtilityProcess,
  type WebContents,
} from "electron";
import { z } from "zod";
import {
  assistantChannels,
  type AgentControl,
  type AgentEvent,
  type StartResult,
} from "../shared/assistant.js";
import { ProfileError } from "./profiles.js";
import type { ModelConnection } from "../shared/profiles.js";

const requestSchema = z.strictObject({
  requestId: z.uuid(),
  conversationId: z.string().min(1).max(100).optional(),
  prompt: z.string().trim().min(1).max(2000),
});
interface Job {
  ownerId: number;
  requestId: string;
  owner: WebContents;
  worker?: UtilityProcess;
  controller: AbortController;
  timeout: NodeJS.Timeout;
  stop: () => void;
}

export function registerAssistantHandlers(
  rendererUrl: string,
  workerPath: string,
  resolveProfile: (signal: AbortSignal) => Promise<ModelConnection | null>,
  resolveCalendar: (
    prompt: string,
    signal: AbortSignal,
    conversation: CalendarConversation,
  ) => Promise<CalendarToolExecutor | null>,
  resolveSettings: () => Promise<AgentSettingsState>,
) {
  const conversations = new Map<
    number,
    { id: string; state: CalendarConversation }
  >();
  const jobs = new Map<number, Job>();
  const workers = new Set<UtilityProcess>();
  const trusted = (event: IpcMainInvokeEvent) =>
    !event.sender.isDestroyed() &&
    event.senderFrame === event.sender.mainFrame &&
    event.senderFrame?.url === rendererUrl;
  const send = (job: Job, event: AgentEvent) => {
    if (!job.owner.isDestroyed())
      job.owner.send(assistantChannels.event, event);
  };
  const finish = (job: Job, cancel = false) => {
    if (jobs.get(job.ownerId) !== job) return;
    jobs.delete(job.ownerId);
    clearTimeout(job.timeout);
    job.owner.removeListener("destroyed", job.stop);
    job.owner.removeListener("did-start-navigation", job.stop);
    job.controller.abort();
    if (cancel) {
      send(job, {
        requestId: job.requestId,
        type: "chunk",
        chunk: { type: "abort" },
      });
    }
    send(job, { requestId: job.requestId, type: "end" });
    const worker = job.worker;
    if (!worker) return;
    if (cancel) {
      worker.postMessage({ type: "cancel" } satisfies AgentControl);
      setTimeout(() => worker.kill(), 250).unref();
    } else worker.kill();
  };
  app.on("before-quit", () => {
    for (const worker of workers) worker.kill();
  });

  ipcMain.handle(
    assistantChannels.start,
    async (event, input: unknown): Promise<StartResult> => {
      const parsed = requestSchema.safeParse(input);
      if (!trusted(event) || !parsed.success)
        return { ok: false, error: "Некорректный запрос ассистенту" };
      const owner = event.sender;
      const ownerId = owner.id;
      if (jobs.has(ownerId))
        return { ok: false, error: "Дождитесь ответа или остановите запрос" };
      let conversation = conversations.get(ownerId);
      const conversationId =
        parsed.data.conversationId ?? parsed.data.requestId;
      if (!conversation || conversation.id !== conversationId) {
        conversation = {
          id: conversationId,
          state: new CalendarConversation(),
        };
        conversations.set(ownerId, conversation);
      }
      const state = conversation.state;
      const job: Job = {
        ownerId,
        requestId: parsed.data.requestId,
        owner,
        controller: new AbortController(),
        timeout: setTimeout(() => {
          send(job, {
            requestId: job.requestId,
            type: "chunk",
            chunk: {
              type: "error",
              errorText: "Ассистент не ответил вовремя. Попробуйте ещё раз.",
            },
          });
          finish(job, true);
        }, 120_000),
        stop: () => finish(job, true),
      };
      jobs.set(ownerId, job);
      owner.once("destroyed", job.stop);
      owner.on("did-start-navigation", job.stop);
      let worker: UtilityProcess;
      let profile: ModelConnection | null;
      let calendar: CalendarToolExecutor | null = null;
      let configuration: AgentSettingsState;
      try {
        configuration = await resolveSettings();
        profile = await resolveProfile(job.controller.signal);
        if (profile)
          calendar = await resolveCalendar(
            parsed.data.prompt,
            job.controller.signal,
            state,
          );
        if (!calendar) state.bindAccount(null);
        if (jobs.get(ownerId) !== job) return { ok: true };
        if (!trusted(event)) {
          finish(job, true);
          return { ok: true };
        }
        // Keys travel only over the privileged main/utility channel, never renderer IPC.
        worker = utilityProcess.fork(workerPath, [], {
          env: {},
          serviceName: "Small Assistant",
        });
        job.worker = worker;
        workers.add(worker);
      } catch (error) {
        if (jobs.get(ownerId) !== job) return { ok: true };
        send(job, {
          requestId: job.requestId,
          type: "chunk",
          chunk: {
            type: "error",
            errorText:
              error instanceof ProfileError
                ? error.message
                : "Не удалось запустить ассистента",
          },
        });
        finish(job);
        return { ok: true };
      }
      worker.once("spawn", () => {
        if (jobs.get(ownerId) === job)
          worker.postMessage({
            type: "start",
            request: parsed.data,
            profile,
            calendar: calendar !== null,
            configuration,
            history: state.messages,
          } satisfies AgentControl);
        else worker.kill();
      });
      worker.on(
        "message",
        (message: AgentEvent | CalendarToolCall | AgentHistoryEvent) => {
          if (jobs.get(ownerId) !== job || message.requestId !== job.requestId)
            return;
          if (message.type === "history") {
            state.commit(parsed.data.prompt, message.messages);
            return;
          }
          if (message.type === "calendar-tool") {
            if (!calendar || !z.uuid().safeParse(message.callId).success)
              return;
            const skillForTool: Record<string, string> = {
              searchPeople: "people-search",
              selectParticipants: "people-search",
              participantMemory: "people-search",
              findSlots: "availability",
              prepareMeetingDraft: "meeting-draft",
            } as const;
            const skillId = skillForTool[message.name];
            if (
              !configuration.settings.skills.some(
                (skill) => skill.id === skillId && skill.enabled,
              )
            ) {
              worker.postMessage({
                type: "calendar-result",
                callId: message.callId,
                result: { ok: false, kind: "denied", error: "Навык отключён" },
              } satisfies AgentControl);
              return;
            }
            void calendar(message.name, message.input)
              .then((result) => {
                if (jobs.get(ownerId) === job)
                  worker.postMessage({
                    type: "calendar-result",
                    callId: message.callId,
                    result,
                  } satisfies AgentControl);
              })
              .catch(() => {
                if (jobs.get(ownerId) === job) finish(job, true);
              });
          } else if (message.type === "end") finish(job);
          else send(job, message);
        },
      );
      worker.once("exit", () => {
        workers.delete(worker);
        if (jobs.get(ownerId) !== job) return;
        send(job, {
          requestId: job.requestId,
          type: "chunk",
          chunk: {
            type: "error",
            errorText: "Ассистент остановился. Попробуйте ещё раз.",
          },
        });
        finish(job);
      });
      return { ok: true };
    },
  );
  ipcMain.handle(assistantChannels.cancel, (event, requestId: unknown) => {
    if (!trusted(event) || !z.uuid().safeParse(requestId).success) return;
    const job = jobs.get(event.sender.id);
    if (job && job.requestId === requestId) finish(job, true);
  });
  return {
    trusted,
    cancelActive: () => {
      conversations.clear();
      for (const job of [...jobs.values()]) finish(job, true);
    },
  };
}
