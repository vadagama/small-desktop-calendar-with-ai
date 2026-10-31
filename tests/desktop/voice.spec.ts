import { _electron, test, expect } from "@playwright/test";
import { mkdtemp, mkdir, copyFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const executablePath = process.env.SMALL_APP_EXECUTABLE;
const launchOptions = executablePath ? { executablePath } : {};
const entryArgs = executablePath ? [] : ["."];

test("voice starts uninstalled in a clean profile and exposes safe settings", async () => {
  const profile = await mkdtemp(join(tmpdir(), "small-voice-clean-"));
  const app = await _electron.launch({
    ...launchOptions,
    args: [...entryArgs, `--user-data-dir=${profile}`],
  });
  try {
    const page = await app.firstWindow();
    const initial = await page.evaluate(async () => ({
      account: await window.smallDesktop.smallAuth.read(),
      profiles: await window.smallDesktop.profiles.read(),
      memory: await window.smallDesktop.memory.read(),
    }));
    expect(initial.account.ok && initial.account.state.status).toBe(
      "signed-out",
    );
    expect(initial.profiles.ok && initial.profiles.state.profiles).toEqual([]);
    expect(initial.memory.ok).toBe(false);
    expect(
      await app.evaluate(
        async ({ session }) =>
          (await session.defaultSession.cookies.get({})).length,
      ),
    ).toBe(0);
    await page
      .getByRole("button", { name: "Профиль Small", exact: true })
      .click();
    await expect(page.getByLabel("Логин", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Пароль", { exact: true })).toHaveValue("");
    await page
      .getByRole("button", { name: "Закрыть профиль Small", exact: true })
      .click();

    await page
      .getByRole("button", { name: "Настройки модели", exact: true })
      .click();
    await page.getByRole("tab", { name: "Voice", exact: true }).click();
    await expect(
      page.getByText("Модель не установлена", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Проверить микрофон", exact: true }),
    ).toBeDisabled();
    await expect(page.getByLabel("Источник звука")).toHaveValue("default");
    await expect(
      page.getByRole("button", { name: /Скачать модель/ }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Закрыть настройки модели" })
      .click();
    await expect(
      page.getByRole("button", { name: "Начать голосовой ввод" }),
    ).toHaveCount(0);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("real Whisper transcribes a synthetic Russian microphone stream without sending", async () => {
  test.setTimeout(180000);
  const model = process.env.SMALL_VOICE_TEST_MODEL;
  const wav = process.env.SMALL_VOICE_TEST_WAV;
  test.skip(
    !model || !wav,
    "Set paths to a verified model and synthetic Russian WAV",
  );
  const profile = await mkdtemp(join(tmpdir(), "small-voice-real-"));
  await mkdir(join(profile, "voice"));
  await copyFile(model!, join(profile, "voice", "ggml-large-v3-turbo.bin"));
  const app = await _electron.launch({
    ...launchOptions,
    args: [
      ...entryArgs,
      `--user-data-dir=${profile}`,
      "--use-fake-device-for-media-stream",
    ],
  });
  try {
    // Fake device only: no real OS microphone is accessed by this integration test.
    await app.evaluate(({ systemPreferences }) => {
      systemPreferences.askForMediaAccess = async () => true;
    });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // Keep the sandbox enabled. The audio service cannot read arbitrary fixture files.
    // Exercise permission handling with the fake device, then feed synthetic speech as a MediaStream.
    await page.evaluate(
      (bytes) => {
        const original = navigator.mediaDevices.getUserMedia.bind(
          navigator.mediaDevices,
        );
        navigator.mediaDevices.getUserMedia = async (constraints) => {
          const device = await original(constraints);
          device.getTracks().forEach((track) => track.stop());
          const context = new AudioContext();
          const source = context.createBufferSource();
          source.buffer = await context.decodeAudioData(
            Uint8Array.from(bytes).buffer,
          );
          source.loop = true;
          const destination = context.createMediaStreamDestination();
          source.connect(destination);
          await context.resume();
          source.start();
          for (const track of destination.stream.getTracks()) {
            const stop = track.stop.bind(track);
            track.stop = () => {
              stop();
              void context.close().catch(() => {});
            };
          }
          return destination.stream;
        };
      },
      Array.from(await readFile(wav!)),
    );
    const mic = page.getByRole("button", { name: "Начать голосовой ввод" });
    await expect(mic).toBeVisible({ timeout: 90000 });
    const input = page.getByRole("textbox", { name: "Сообщение ассистенту" });
    await input.fill("Мой запрос: ");
    await mic.click();
    await expect(page.getByText(/Слушаю ·/)).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(6500);
    await expect(
      page.getByRole("button", { name: "Отправить сообщение", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Остановить запись" }).click();
    await expect(mic).toBeVisible({ timeout: 70000 });
    expect(await page.locator(".speech-error").allTextContents()).toEqual([]);
    await expect(input).toHaveValue(/Мой запрос: .*команд.*завтра/i);
    await expect(page.locator(".message.user")).toHaveCount(0);
    await mic.click();
    await expect(page.getByText(/Слушаю ·/)).toBeVisible();
    await input.press("Escape");
    await expect(mic).toBeVisible();
    await page
      .getByRole("button", { name: "Настройки модели", exact: true })
      .click();
    await page.getByRole("tab", { name: "Voice", exact: true }).click();
    await expect(
      page.getByText("Модель готова", { exact: true }),
    ).toBeVisible();
    expect(
      await page
        .locator(".speech-ready")
        .evaluate((el) => getComputedStyle(el).fontSize),
    ).toBe("13px");
    expect(
      await page
        .getByLabel("Источник звука")
        .evaluate((el) => getComputedStyle(el).fontSize),
    ).toBe("14px");
    await page.screenshot({ path: "/tmp/small-voice-real-settings.png" });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
