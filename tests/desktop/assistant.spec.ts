import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("SDK chat streams a tool, handles errors, cancellation and a new turn", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-assistant-test-"));
  const executablePath = process.env.SMALL_APP_EXECUTABLE;
  const app = await _electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : ["."]), `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      SMALL_TEST_SYNTHETIC: "1",
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    },
  });
  try {
    const page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "Календарь Small", exact: true }),
    ).toBeVisible();
    const invalid = await page.evaluate(async () => ({
      invalidId: await window.smallDesktop.assistant.start({
        requestId: "invalid",
        prompt: "hello",
      }),
      oversized: await window.smallDesktop.assistant.start({
        requestId: crypto.randomUUID(),
        prompt: "x".repeat(2001),
      }),
    }));
    expect(invalid.invalidId.ok).toBe(false);
    expect(invalid.oversized.ok).toBe(false);
    const isolation = await page.evaluate(async () => {
      const bridge = window.smallDesktop.assistant;
      const requestId = crypto.randomUUID();
      const first = await bridge.start({ requestId, prompt: "Сложи 2 и 3" });
      const competing = await bridge.start({
        requestId: crypto.randomUUID(),
        prompt: "Сложи 3 и 4",
      });
      await bridge.cancel(crypto.randomUUID());
      const afterWrongCancel = await bridge.start({
        requestId: crypto.randomUUID(),
        prompt: "Сложи 4 и 5",
      });
      await bridge.cancel(requestId);
      return {
        first,
        competing,
        afterWrongCancel,
        keys: Object.keys(bridge).sort(),
      };
    });
    expect(isolation.first.ok).toBe(true);
    expect(isolation.competing.ok).toBe(false);
    expect(isolation.afterWrongCancel.ok).toBe(false);
    expect(isolation.keys).toEqual(["cancel", "start", "subscribe"]);
    const untrusted = await app.evaluate(async ({ BrowserWindow, app }) => {
      const frame = new BrowserWindow({
        show: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          preload: `${app.getAppPath()}/out/preload/index.cjs`,
        },
      });
      try {
        await frame.loadURL("about:blank");
        return await frame.webContents.executeJavaScript(
          'window.smallDesktop.assistant.start({requestId: "11111111-1111-4111-8111-111111111111", prompt: "Сложи 2 и 3"})',
        );
      } finally {
        frame.destroy();
      }
    });
    expect(untrusted.ok).toBe(false);
    const input = page.getByRole("textbox", { name: "Сообщение ассистенту" });
    const send = async (prompt: string) => {
      await input.fill(prompt);
      await page.getByRole("button", { name: "Отправить сообщение" }).click();
    };
    await send("Сложи 2 и 3");
    await expect(
      page.getByRole("button", { name: "Остановить ответ" }),
    ).toBeVisible();
    await expect(
      page.locator('[data-tool-state="output-available"]'),
    ).toContainText("5");
    await expect(page.getByRole("log")).toContainText("Результат: 5");
    await expect(
      page.getByRole("button", { name: "Остановить ответ" }),
    ).toHaveCount(0);
    await send("Сложи 1.5 и 3");
    await expect(
      page.locator('[data-tool-state="output-error"]'),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Остановить ответ" }),
    ).toHaveCount(0);
    await send("Ошибка модели");
    await expect(
      page.getByRole("region", { name: "AI-ассистент" }).getByRole("alert"),
    ).toContainText("Не удалось обработать ответ модели");
    await send("Сложи 100 и 200");
    await page.getByRole("button", { name: "Остановить ответ" }).click();
    await expect(
      page
        .getByRole("region", { name: "AI-ассистент" })
        .getByRole("status", { name: "Состояние ответа ассистента" }),
    ).toContainText("Запрос остановлен");
    await send("Сложи 7 и 8");
    await expect(page.getByRole("log")).toContainText("Результат: 15");
    await expect(page.getByRole("log")).not.toContainText("Результат: 300");
    await expect(
      page.getByRole("button", { name: "Остановить ответ" }),
    ).toHaveCount(0);
    await send("Помоги");
    await expect(page.getByRole("log")).toContainText(
      "Укажите два целых числа",
    );
    await expect(
      page.getByRole("button", { name: "Остановить ответ" }),
    ).toHaveCount(0);
    await page.screenshot({ path: "test-results/desktop/assistant.png" });
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("unconfigured chat requests model setup instead of using the synthetic model", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-unconfigured-test-"));
  const app = await _electron.launch({
    args: [".", `--user-data-dir=${userData}`],
    env: { ...process.env, SMALL_TEST_SYNTHETIC: "" },
  });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("textbox", { name: "Сообщение ассистенту" })
      .fill("Привет");
    await page.getByRole("button", { name: "Отправить сообщение" }).click();
    await expect(
      page.getByRole("region", { name: "AI-ассистент" }).getByRole("alert"),
    ).toContainText("Откройте настройки модели");
    await expect(page.getByRole("log")).not.toContainText(
      "Укажите два целых числа",
    );
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
