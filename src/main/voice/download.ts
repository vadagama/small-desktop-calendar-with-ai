import { createReadStream } from "node:fs";
import { mkdir, stat, statfs, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { whisperModel } from "./model.js";
import type { VoiceModelPhase } from "../../shared/voice.js";

interface Model {
  filename: string;
  bytes: number;
  sha256: string;
  url: string;
}
export async function modelFetch(
  url: string,
  options: RequestInit,
): Promise<Response> {
  for (let redirects = 0; redirects < 6; redirects++) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      !(
        parsed.hostname === "huggingface.co" ||
        parsed.hostname.endsWith(".huggingface.co") ||
        parsed.hostname.endsWith(".hf.co")
      )
    )
      throw new Error("Недопустимый источник модели");
    const response = await fetch(url, { ...options, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error("Источник не вернул адрес модели");
    url = new URL(location, url).href;
  }
  throw new Error("Слишком много перенаправлений");
}
export class VoiceDownload {
  readonly path: string;
  private readonly partial: string;
  private controller: AbortController | undefined;
  private job: Promise<void> | undefined;
  status: {
    phase: VoiceModelPhase;
    received: number;
    total: number;
    bytesPerSecond: number;
    error: string;
  };
  constructor(
    private directory: string,
    private validate: (path: string) => Promise<void>,
    private model: Model = whisperModel,
    private fetcher: (
      url: string,
      options: RequestInit,
    ) => Promise<Response> = modelFetch,
  ) {
    this.path = join(directory, model.filename);
    this.partial = this.path + ".part";
    this.status = {
      phase: "absent",
      received: 0,
      total: model.bytes,
      bytesPerSecond: 0,
      error: "",
    };
  }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (await stat(this.path).catch(() => null)) {
      this.status.phase = "verifying";
      let verified = false;
      try {
        await this.verify(this.path);
        verified = true;
        await this.validate(this.path);
        this.status.phase = "ready";
        this.status.received = this.model.bytes;
      } catch (error) {
        this.status.phase = "error";
        this.status.error =
          error instanceof Error
            ? error.message
            : "Не удалось проверить модель";
        if (verified) {
          await rename(this.path, this.partial);
          this.status.received = this.model.bytes;
        } else await rm(this.path, { force: true });
      }
    } else {
      this.status.received =
        (await stat(this.partial).catch(() => null))?.size ?? 0;
      if (this.status.received) this.status.phase = "paused";
    }
  }
  async verify(path: string) {
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of createReadStream(path)) {
      hash.update(chunk);
      size += chunk.length;
    }
    if (size !== this.model.bytes || hash.digest("hex") !== this.model.sha256)
      throw new Error(
        "Контрольная сумма модели не совпала. Повторите скачивание",
      );
  }
  async install() {
    if (this.job || this.status.phase === "ready") return;
    const controller = new AbortController();
    this.controller = controller;
    this.status.phase = "downloading";
    this.status.error = "";
    this.job = this.download(controller.signal)
      .catch((error: unknown) => {
        this.status.phase = controller.signal.aborted ? "paused" : "error";
        this.status.error = controller.signal.aborted
          ? ""
          : error instanceof Error
            ? error.message
            : "Не удалось скачать модель";
      })
      .finally(() => {
        this.job = undefined;
        this.controller = undefined;
        this.status.bytesPerSecond = 0;
      });
  }
  settled() {
    return this.job ?? Promise.resolve();
  }
  async pause() {
    this.controller?.abort();
    await this.settled();
  }
  async remove() {
    await this.pause();
    await rm(this.partial, { force: true });
    await rm(this.path, { force: true });
    this.status = {
      phase: "absent",
      received: 0,
      total: this.model.bytes,
      bytesPerSecond: 0,
      error: "",
    };
  }
  private async download(signal: AbortSignal) {
    let offset = (await stat(this.partial).catch(() => null))?.size ?? 0;
    if (offset > this.model.bytes) {
      await rm(this.partial, { force: true });
      offset = 0;
    }
    const free = await statfs(this.directory);
    if (free.bavail * free.bsize < this.model.bytes - offset + 64 * 1024 * 1024)
      throw new Error("Недостаточно места на диске для модели");
    if (offset < this.model.bytes) {
      const timeout = AbortSignal.timeout(30 * 60 * 1000);
      const response = await this.fetcher(this.model.url, {
        signal: AbortSignal.any([signal, timeout]),
        headers: offset ? { Range: `bytes=${offset}-` } : {},
      });
      if (!response.ok || !response.body)
        throw new Error(
          "Не удалось скачать модель. Проверьте подключение к интернету",
        );
      if (
        response.status === 206 &&
        response.headers.get("content-range") !==
          `bytes ${offset}-${this.model.bytes - 1}/${this.model.bytes}`
      ) {
        await response.body.cancel();
        throw new Error("Источник вернул некорректный диапазон модели");
      }
      if (response.status === 200) offset = 0;
      else if (response.status !== 206) {
        await response.body.cancel();
        throw new Error("Некорректный ответ источника модели");
      }
      this.status.received = offset;
      const file = await open(this.partial, offset ? "a" : "w", 0o600);
      const started = Date.now();
      const reader = response.body.getReader();
      try {
        while (true) {
          signal.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          if (this.status.received + value.length > this.model.bytes)
            throw new Error("Размер модели превышает ожидаемый");
          let written = 0;
          while (written < value.length)
            written += (
              await file.write(value, written, value.length - written)
            ).bytesWritten;
          this.status.received += value.length;
          this.status.bytesPerSecond =
            (this.status.received - offset) /
            Math.max(0.1, (Date.now() - started) / 1000);
        }
      } finally {
        await reader.cancel().catch(() => {});
        await file.close();
      }
    }
    signal.throwIfAborted();
    this.status.phase = "verifying";
    try {
      await this.verify(this.partial);
    } catch (error) {
      await rm(this.partial, { force: true });
      this.status.received = 0;
      throw error;
    }
    signal.throwIfAborted();
    await this.validate(this.partial);
    signal.throwIfAborted();
    await rename(this.partial, this.path);
    this.status.phase = "ready";
    this.status.received = this.model.bytes;
  }
}
