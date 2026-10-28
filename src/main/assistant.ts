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
) {
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
    if (cancel) {
      job.controller.abort();
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
        }, 30_000),
        stop: () => finish(job, true),
      };
      jobs.set(ownerId, job);
      owner.once("destroyed", job.stop);
      owner.on("did-start-navigation", job.stop);
      let worker: UtilityProcess;
      let profile: ModelConnection | null;
      try {
        profile = await resolveProfile(job.controller.signal);
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
          } satisfies AgentControl);
        else worker.kill();
      });
      worker.on("message", (message: AgentEvent) => {
        if (jobs.get(ownerId) !== job || message.requestId !== job.requestId)
          return;
        if (message.type === "end") finish(job);
        else send(job, message);
      });
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
      for (const job of [...jobs.values()]) finish(job, true);
    },
  };
}
