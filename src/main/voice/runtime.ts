import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";

export class WhisperRuntime {
  private child: ChildProcess | undefined;
  constructor(
    private executable: string,
    private tempRoot: string,
  ) {}
  cancel() {
    this.child?.kill("SIGKILL");
  }
  async run(
    model: string,
    wav: Buffer,
    signal: AbortSignal,
    probe = false,
  ): Promise<string> {
    if (this.child) throw new Error("Распознавание уже выполняется");
    await mkdir(this.tempRoot, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(this.tempRoot, "capture-"));
    try {
      signal.throwIfAborted();
      const input = join(directory, "audio.wav");
      const output = join(directory, "result");
      await writeFile(input, wav, { mode: 0o600 });
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          this.executable,
          [
            "-m",
            model,
            "-f",
            input,
            "-l",
            "ru",
            "-nt",
            "-np",
            "-otxt",
            "-of",
            output,
            "-t",
            "4",
            ...(probe ? ["-ng"] : []),
          ],
          { stdio: "ignore", shell: false },
        );
        this.child = child;
        const cancel = () => child.kill("SIGKILL");
        const timer = setTimeout(cancel, 60000);
        signal.addEventListener("abort", cancel, { once: true });
        child.once("error", () => {
          cleanup();
          reject(
            new Error(
              "Не удалось запустить Whisper. Проверьте установку приложения",
            ),
          );
        });
        child.once("close", (code) => {
          cleanup();
          code === 0 && !signal.aborted
            ? resolve()
            : reject(
                new Error(
                  signal.aborted
                    ? "Распознавание отменено"
                    : "Whisper не завершил распознавание за отведённое время или столкнулся с ошибкой",
                ),
              );
        });
        const cleanup = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", cancel);
          if (this.child === child) this.child = undefined;
        };
        if (signal.aborted) cancel();
      });
      return (await readFile(output + ".txt", "utf8")).trim();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  async probe(model: string) {
    // A short silent WAV loads the actual model without retaining or logging speech.
    const wav = Buffer.alloc(44 + 3200);
    wav.write("RIFF");
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16000, 24);
    wav.writeUInt32LE(32000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(3200, 40);
    await this.run(model, wav, AbortSignal.timeout(60000), true);
  }
}
