import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("notification check distinguishes delivery, failure and action without arbitrary URLs", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-native-test-"));
  const app = await _electron.launch({
    args: [
      ".",
      `--user-data-dir=${userData}`,
      "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
    ],
  });
  try {
    await app.evaluate(({ Notification, shell }) => {
      const g = globalThis as any;
      g.testHistory = [];
      g.testDenied = false;
      g.opened = [];
      Notification.isSupported = () => true;
      Notification.getHistory = async () => g.testHistory;
      Notification.prototype.show = function () {
        g.lastNotification = this;
        if (g.testDenied)
          this.emit("failed", {}, "Synthetic permission denial");
        else {
          g.testHistory = [this];
          this.emit("show");
        }
      };
      Notification.prototype.close = function () {
        g.testHistory = g.testHistory.filter((n: any) => n !== this);
      };
      shell.openExternal = async (url) => {
        g.opened.push(url);
      };
    });
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Напоминания", exact: true })
      .click();
    const section = page.getByRole("region", {
      name: "Проверка системных уведомлений",
    });
    await section
      .getByRole("button", { name: "Отправить тестовое уведомление" })
      .click();
    await expect(section.locator('[data-delivery="delivered"]')).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.hide();
      (globalThis as any).lastNotification.emit("action", {}, 0);
    });
    await expect(section.locator('[data-delivery="opened"]')).toBeVisible();
    expect(await app.evaluate(() => (globalThis as any).opened)).toEqual([]);
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.isVisible(),
      ),
    ).toBe(true);
    await app.evaluate(() => {
      (globalThis as any).testDenied = true;
    });
    await section
      .getByRole("button", { name: "Отправить тестовое уведомление" })
      .click();
    await expect(section.locator('[data-delivery="failed"]')).toBeVisible();
    await expect(section).toContainText("macOS отклонила");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.close(),
    );
    await expect
      .poll(() =>
        app.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
        ),
      )
      .toBe(0);
    const reopened = app.waitForEvent("window");
    await app.evaluate(() => {
      (globalThis as any).lastNotification.emit("action", {}, 0);
    });
    const local = await reopened;
    await expect(
      local.getByRole("heading", { name: "Календарь Small", exact: true }),
    ).toBeVisible();
    expect(local.url()).toBe("small-app://workspace/index.html");
    expect(await app.evaluate(() => (globalThis as any).opened)).toEqual([]);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
