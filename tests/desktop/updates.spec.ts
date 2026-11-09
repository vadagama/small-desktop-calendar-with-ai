import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UpdateState } from "../../src/shared/updates.js";

test("update settings use real IPC and preserve the model draft; dev install is blocked", async () => {
  const profile = await mkdtemp(join(tmpdir(), "small-updates-"));
  const app = await _electron.launch({
    args: [".", `--user-data-dir=${profile}`],
  });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page
      .getByRole("button", { name: "Настройки модели", exact: true })
      .click();
    await page.getByLabel("Model ID", { exact: true }).fill("my-unsaved-model");
    await page.getByRole("tab", { name: "LLM", exact: true }).press("End");
    const tab = page.getByRole("tab", { name: "Обновления", exact: true });
    await expect(tab).toBeFocused();
    await expect(
      page.getByText("В режиме разработки автообновление отключено.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Проверить обновления", exact: true }),
    ).toBeDisabled();
    expect(await tab.evaluate((el) => getComputedStyle(el).fontSize)).toBe(
      "14px",
    );
    expect(
      await page.evaluate(() => window.smallDesktop.updates.install()),
    ).toEqual({ ok: false });
    expect(
      (await page.evaluate(() => window.smallDesktop.updates.check())).status,
    ).toBe("unsupported");
    await tab.press("Home");
    await expect(page.getByLabel("Model ID", { exact: true })).toHaveValue(
      "my-unsaved-model",
    );
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("download and ready notifications render progress, plain text notes, and Later", async () => {
  const profile = await mkdtemp(join(tmpdir(), "small-update-notice-"));
  const app = await _electron.launch({
    args: [".", `--user-data-dir=${profile}`],
  });
  const state: UpdateState = {
    currentVersion: "1.0.0",
    version: "1.1.0",
    status: "downloading",
    percent: 42,
    notes: "Исправлен поиск. <script>unsafe()</script>",
  };
  try {
    const page = await app.firstWindow();
    // Wait until the normal bridge has mounted; inject transport events from the test main process.
    await page
      .getByRole("button", { name: "Настройки модели", exact: true })
      .click();
    await page.getByRole("tab", { name: "Обновления", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Проверить обновления", exact: true }),
    ).toBeDisabled();
    const emit = async (value: UpdateState) =>
      app.evaluate(({ BrowserWindow }, payload) => {
        for (const win of BrowserWindow.getAllWindows())
          win.webContents.send("updates:changed", payload);
      }, value);
    await emit(state);
    const panel = page.getByRole("tabpanel", {
      name: "Обновления",
      exact: true,
    });
    await expect(panel.getByRole("progressbar")).toHaveAttribute("value", "42");
    await panel.getByText("Что нового", { exact: true }).click();
    await expect(panel.getByText(state.notes!, { exact: true })).toBeVisible();
    await page.screenshot({ path: "/tmp/small-update-settings.png" });
    await page
      .getByRole("button", { name: "Закрыть настройки модели" })
      .click();
    const notice = page.getByRole("complementary", {
      name: "Обновление календаря",
    });
    await expect(notice.getByRole("progressbar")).toBeVisible();
    await emit({ ...state, status: "ready", percent: 100 });
    await expect(
      notice.getByRole("button", { name: "Перезапустить и установить" }),
    ).toBeVisible();
    await page.screenshot({ path: "/tmp/small-update-ready.png" });
    await notice.getByRole("button", { name: "Позже", exact: true }).click();
    await expect(notice).toHaveCount(0);
    await emit({ ...state, status: "ready", percent: 100 });
    await expect(notice).toHaveCount(0);
    await emit({
      ...state,
      version: "1.2.0",
      status: "error",
      message: "Проверьте интернет",
    });
    await expect(
      notice.getByRole("button", { name: "Повторить попытку" }),
    ).toBeVisible();
    await expect(notice.getByText("Проверьте интернет")).toBeVisible();
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
