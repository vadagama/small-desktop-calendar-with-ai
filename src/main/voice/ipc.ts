import {
  app,
  ipcMain,
  systemPreferences,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import {
  access,
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  voiceChannel,
  type VoiceReply,
  type VoiceStatus,
} from "../../shared/voice.js";
import { VoiceDownload } from "./download.js";
import { WhisperRuntime } from "./runtime.js";
import { pcmToWav } from "./audio.js";

const requestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.enum([
        "status",
        "install",
        "pause",
        "remove",
        "cancelDownload",
      ]),
    })
    .strict(),
  z
    .object({
      action: z.literal("source"),
      deviceId: z.string().min(1).max(1024),
    })
    .strict(),
  z
    .object({ action: z.enum(["begin", "cancel"]), sessionId: z.uuid() })
    .strict(),
  z
    .object({
      action: z.literal("transcribe"),
      sessionId: z.uuid(),
      pcm: z.instanceof(ArrayBuffer),
    })
    .strict(),
]);
export function registerVoice(
  directory: string,
  executable: string,
  trusted: (event: IpcMainInvokeEvent) => boolean,
) {
  const runtime = new WhisperRuntime(executable, join(directory, "temporary"));
  const download = new VoiceDownload(directory, (path) => runtime.probe(path));
  let source = "default";
  let runtimeAvailable = false;
  let active:
    | {
        id: string;
        owner: WebContents;
        controller: AbortController;
        release: () => void;
        processing: boolean;
      }
    | undefined;
  const init = (async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await rm(join(directory, "temporary"), { recursive: true, force: true });
    runtimeAvailable = await access(executable, constants.X_OK).then(
      () => true,
      () => false,
    );
    const saved = await readFile(join(directory, "source.json"), "utf8")
      .then(
        (text) => JSON.parse(text) as unknown,
        () => null,
      )
      .catch(() => null);
    if (typeof saved === "string" && saved.length <= 1024) source = saved;
    if (runtimeAvailable) await download.init();
  })();
  const status = (): VoiceStatus => ({
    ...download.status,
    source,
    runtimeAvailable,
    active: !!active,
  });
  const cancel = () => {
    active?.release();
  };
  ipcMain.handle(
    voiceChannel,
    async (event, input: unknown): Promise<VoiceReply> => {
      if (!trusted(event))
        return { ok: false, error: "Доступ к голосовому вводу отклонён" };
      const parsed = requestSchema.safeParse(input);
      if (!parsed.success)
        return { ok: false, error: "Некорректный запрос голосового ввода" };
      try {
        await init;
        const request = parsed.data;
        if (request.action === "status") return { ok: true, status: status() };
        if (request.action === "cancel") {
          if (active?.id === request.sessionId && active.owner === event.sender)
            cancel();
          return { ok: true, status: status() };
        }
        if (request.action === "transcribe") {
          const job = active;
          if (
            !job ||
            job.id !== request.sessionId ||
            job.owner !== event.sender ||
            job.processing
          )
            throw new Error("Запись больше не активна");
          job.processing = true;
          try {
            const wav = pcmToWav(request.pcm);
            const text = await runtime.run(
              download.path,
              wav,
              job.controller.signal,
            );
            if (active !== job || job.controller.signal.aborted)
              throw new Error("Распознавание отменено");
            if (!text)
              throw new Error("Речь не обнаружена. Попробуйте ещё раз");
            return { ok: true, status: { ...status(), active: false }, text };
          } finally {
            if (active === job) job.release();
          }
        }
        if (active) throw new Error("Сначала завершите голосовой ввод");
        if (request.action === "begin") {
          if (download.status.phase !== "ready")
            throw new Error(
              "Сначала установите модель в настройках AI-помощника",
            );
          const controller = new AbortController();
          const owner = event.sender;
          const release = () => {
            controller.abort();
            runtime.cancel();
            clearTimeout(timer);
            owner.removeListener("destroyed", release);
            owner.removeListener("did-start-navigation", release);
            if (active?.controller === controller) active = undefined;
          };
          const timer = setTimeout(release, 190000);
          active = {
            id: request.sessionId,
            owner,
            controller,
            release,
            processing: false,
          };
          owner.once("destroyed", release);
          owner.once("did-start-navigation", release);
          try {
            if (
              process.platform === "darwin" &&
              !(await systemPreferences.askForMediaAccess("microphone"))
            )
              throw new Error(
                "Разрешите микрофон для Small Calendar в Системных настройках → Конфиденциальность и безопасность → Микрофон",
              );
            if (controller.signal.aborted) throw new Error("Запись отменена");
          } catch (error) {
            release();
            throw error;
          }
        } else if (request.action === "source") {
          const path = join(directory, "source.json");
          await writeFile(path + ".tmp", JSON.stringify(request.deviceId), {
            mode: 0o600,
          });
          await rename(path + ".tmp", path);
          source = request.deviceId;
        } else if (request.action === "install") {
          if (!runtimeAvailable)
            throw new Error("Движок Whisper отсутствует в приложении");
          await download.install();
        } else if (request.action === "pause") await download.pause();
        else await download.remove();
        return { ok: true, status: status() };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error ? error.message : "Ошибка голосового ввода",
        };
      }
    },
  );
  app.on("before-quit", () => {
    cancel();
    runtime.cancel();
    void download.pause();
  });
  return {
    microphoneAllowed: (contents: WebContents | null) =>
      !!active && active.owner === contents && !active.processing,
  };
}
