import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockSmall } from "./fixtures/small-api.js";

test("reminders settings, native failure, background delivery and account isolation", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-reminders-ui-"));
  const app = await _electron.launch({
    args: [
      ".",
      `--user-data-dir=${userData}`,
      "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
    ],
  });
  try {
    await app.evaluate(({ Notification }) => {
      const g = globalThis as any;
      g.reminderNow = Date.parse("2099-10-29T08:54:00+05:00");
      g.reminderCount = 0;
      Date.now = () => g.reminderNow;
      Notification.isSupported = () => true;
      Notification.prototype.show = function () {
        g.reminderCount++;
        this.emit("failed", {}, "Synthetic permission failure");
      };
      Notification.prototype.close = function () {};
    });
    await mockSmall(app, "2099-10-29");
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Профиль Small", exact: true })
      .click();
    await page.getByLabel("Логин", { exact: true }).fill("employee-a");
    await page.getByLabel("Пароль", { exact: true }).fill("synthetic-password");
    await page
      .getByRole("button", { name: "Войти в Small", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Выйти из Small" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Закрыть профиль Small" }).click();
    await page
      .getByRole("button", { name: "Напоминания", exact: true })
      .click();
    await expect(page.getByLabel("За сколько минут до начала")).toHaveValue(
      "5",
    );
    await page.getByLabel("За сколько минут до начала").fill("0");
    await page.getByRole("button", { name: "Сохранить напоминания" }).click();
    await expect(page.getByText("Настройки сохранены.")).toBeVisible();
    await page.getByRole("button", { name: "Закрыть напоминания" }).click();
    await page
      .getByRole("button", { name: "Напоминания", exact: true })
      .click();
    await expect(page.getByLabel("За сколько минут до начала")).toHaveValue(
      "0",
    );
    expect(await app.evaluate(() => (globalThis as any).reminderCount)).toBe(0);
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.close();
    });
    await expect
      .poll(() =>
        app.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
        ),
      )
      .toBe(0);
    await app.evaluate(({ powerMonitor }) => {
      (globalThis as any).reminderNow = Date.parse("2099-10-29T09:05:00+05:00");
      powerMonitor.emit("resume");
    });
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).reminderCount))
      .toBe(1);
    await app.evaluate(({ app }) => {
      app.emit("activate");
    });
    page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Напоминания", exact: true })
      .click();
    await expect(page.locator(".reminder-item")).toContainText(
      "Синтетическая встреча A",
    );
    await expect(page.locator(".reminder-item")).toContainText(
      "Ссылка на встречу отсутствует",
    );
    await expect(
      page.getByText(/Системное уведомление не показано/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Обновить напоминания" }).click();
    expect(await app.evaluate(() => (globalThis as any).reminderCount)).toBe(1);
    await expect(
      page.getByRole("button", { name: "Обновить напоминания" }),
    ).toBeEnabled();
    await page.screenshot({ path: "test-results/desktop/reminders.png" });
    await page.getByRole("button", { name: "Закрыть напоминания" }).click();
    await page
      .getByRole("button", { name: "Профиль Small", exact: true })
      .click();
    await page.getByRole("button", { name: "Выйти из Small" }).click();
    await expect(
      page.getByRole("button", { name: "Войти в Small", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Закрыть профиль Small" }).click();
    await page
      .getByRole("button", { name: "Напоминания", exact: true })
      .click();
    await expect(page.getByText("Сейчас напоминаний нет.")).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
