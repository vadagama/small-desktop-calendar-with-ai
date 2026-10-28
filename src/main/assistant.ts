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

const requestSchema = z.strictObject({
  requestId: z.uuid(),
  prompt: z.string().trim().min(1).max(2000),
});
interface Job {
  ownerId: number;
  requestId: string;
  owner: WebContents;
  worker: UtilityProcess;
  timeout: NodeJS.Timeout;
  stop: () => void;
}

export function registerAssistantHandlers(
  rendererUrl: string,
  workerPath: string,
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
    send(job, { requestId: job.requestId, type: "end" });
    if (cancel) {
      job.worker.postMessage({ type: "cancel" } satisfies AgentControl);
      setTimeout(() => job.worker.kill(), 250).unref();
    } else job.worker.kill();
  };
  app.on("before-quit", () => {
    for (const worker of workers) worker.kill();
  });

  ipcMain.handle(
    assistantChannels.start,
    (event, input: unknown): StartResult => {
      const parsed = requestSchema.safeParse(input);
      if (!trusted(event) || !parsed.success)
        return { ok: false, error: "Некорректный запрос ассистенту" };
      const owner = event.sender;
      const ownerId = owner.id;
      if (jobs.has(ownerId))
        return { ok: false, error: "Дождитесь ответа или остановите запрос" };
      let worker: UtilityProcess;
      try {
        // https://www.electronjs.org/docs/latest/api/utility-process
        // T03 requires no credentials; do not inherit the main process environment.
        worker = utilityProcess.fork(workerPath, [], {
          env: {},
          serviceName: "Small Synthetic Assistant",
        });
      } catch {
        return { ok: false, error: "Не удалось запустить ассистента" };
      }
      workers.add(worker);
      const job: Job = {
        ownerId,
        requestId: parsed.data.requestId,
        owner,
        worker,
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
      worker.once("spawn", () => {
        if (jobs.get(ownerId) === job)
          worker.postMessage({
            type: "start",
            request: parsed.data,
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
}
