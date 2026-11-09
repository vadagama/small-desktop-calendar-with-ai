import { AvailabilitySessions } from "./availability-session.js";
import {
  availabilityAnalysisChannels,
  availabilityOpeningSchema,
} from "../shared/availability-analysis.js";
import { eventListChannel } from "../shared/event-list-channel.js";
import type { CalendarConversation } from "./calendar-conversation.js";
import { WindowConversations } from "./window-conversations.js";
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
import { SmallAuthError } from "./small-auth.js";
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
    context: { ownerId: number; requestId: string },
  ) => Promise<CalendarToolExecutor | null>,
  resolveSettings: () => Promise<AgentSettingsState>,
) {
  const conversations = new WindowConversations();
  const jobs = new Map<number, Job>();
  const workers = new Set<UtilityProcess>();
  const trusted = (event: IpcMainInvokeEvent) =>
    !event.sender.isDestroyed() &&
    event.senderFrame === event.sender.mainFrame &&
    event.senderFrame?.url === rendererUrl;
  const availabilityOwners = new WeakSet<WebContents>();
  const availabilitySessions = new AvailabilitySessions();
  ipcMain.handle(
    availabilityAnalysisChannels.context,
    (event, input: unknown) => {
      if (!trusted(event)) return;
      if (input === null) {
        availabilitySessions.close(
          event.sender.id,
          jobs.get(event.sender.id)?.requestId,
        );
        return;
      }
      const parsed = availabilityOpeningSchema.safeParse(input);
      if (!parsed.success) return;
      availabilitySessions.set(event.sender.id, parsed.data);
    },
  );
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
      const conversationId =
        parsed.data.conversationId ?? parsed.data.requestId;
      const state = conversations.get(owner, conversationId);
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
      if (!availabilityOwners.has(owner)) {
        availabilityOwners.add(owner);
        owner.once("destroyed", () => {
          availabilitySessions.destroy(ownerId);
        });
      }
      owner.on("did-start-navigation", job.stop);
      let worker: UtilityProcess;
      let profile: ModelConnection | null;
      let calendar: CalendarToolExecutor | null = null;
      let configuration: AgentSettingsState;
      try {
        configuration = await resolveSettings();
        profile = await resolveProfile(job.controller.signal);
        if (!profile && process.env.SMALL_TEST_SYNTHETIC !== "1")
          throw new ProfileError(
            "Модель не настроена. Откройте настройки модели и сохраните API-ключ.",
          );
        if (profile)
          calendar = await resolveCalendar(
            parsed.data.prompt,
            job.controller.signal,
            state,
            { ownerId, requestId: parsed.data.requestId },
          );
        if (!calendar) state.bindAccount(null);
        const context = state.boundAccount
          ? availabilitySessions.context(ownerId, state.boundAccount)
          : undefined;
        if (
          calendar &&
          context &&
          state.matchesAccount(context.query.accountId)
        ) {
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
        } else {
          state.clearAvailability();
          if (context) availabilitySessions.destroy(ownerId);
        }

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
              error instanceof ProfileError || error instanceof SmallAuthError
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
            availability: state.availability,
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
              showEventList: "event-list",
              listMeetings: "schedule",
              meetingAnalytics: "analytics",
              searchPeople: "people-search",
              selectParticipants: "people-search",
              participantMemory: "people-search",
              assistantMemory: "people-search",
              findSlots: "availability",
              showAvailabilityAnalysis: "availability",
              prepareMeetingDraft: "meeting-draft",
              prepareMeetingDeletion: "meeting-delete",
            } as const;
            const skillId = skillForTool[message.name];
            const copiesMeeting =
              message.name === "selectParticipants" &&
              typeof message.input === "object" &&
              message.input !== null &&
              "sourceEventKey" in message.input;
            if (
              (message.name !== "assistantMemory" &&
                !configuration.settings.skills.some(
                  (skill) => skill.id === skillId && skill.enabled,
                )) ||
              (copiesMeeting &&
                !configuration.settings.skills.some(
                  (skill) => skill.id === "schedule" && skill.enabled,
                ))
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
                if (jobs.get(ownerId) !== job || job.controller.signal.aborted)
                  return;
                if (
                  result.ok &&
                  "kind" in result.data &&
                  result.data.kind === "event-list"
                )
                  job.owner.send(eventListChannel, result.data);
                if (
                  result.ok &&
                  "kind" in result.data &&
                  result.data.kind === "availability-analysis" &&
                  availabilitySessions.deliver(
                    ownerId,
                    job.requestId,
                    message.callId,
                  )
                )
                  job.owner.send(
                    availabilityAnalysisChannels.open,
                    result.data,
                  );
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
      availabilitySessions.clear();
      for (const job of [...jobs.values()]) finish(job, true);
    },
  };
}
