import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockSmall } from "./fixtures/small-api.js";
import { calendarToday } from "../../src/shared/calendar-time.js";
for (const lost of [false, true]) {
  test(`event confirmation preserves rename and handles delete response loss=${lost}`, async () => {
    const userData = await mkdtemp(join(tmpdir(), "small-event-change-"));
    const app = await _electron.launch({
      args: [
        ".",
        `--user-data-dir=${userData}`,
        "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
      ],
    });
    try {
      await mockSmall(app, calendarToday());
      await app.evaluate((_e, lost) => {
        (globalThis as any).syntheticLostDelete = lost;
      }, lost);
      const page = await app.firstWindow();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page
        .getByRole("button", { name: "Профиль Small", exact: true })
        .click();
      await page.getByLabel("Логин", { exact: true }).fill("employee-a");
      await page
        .getByLabel("Пароль", { exact: true })
        .fill("synthetic-password");
      await page
        .getByRole("button", { name: "Войти в Small", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Выйти из Small" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Закрыть профиль Small" }).click();
      await page
        .locator(".calendar-event")
        .filter({ hasText: "Синтетическая встреча A" })
        .click();
      let dialog = page.getByRole("dialog");
      await dialog.getByLabel("Новое название").fill("Подтверждённое название");
      await dialog
        .getByRole("button", { name: "Предпросмотр названия" })
        .click();
      expect(
        await app.evaluate(() => (globalThis as any).syntheticEventMutations),
      ).toBe(0);
      await dialog.getByRole("button", { name: "Применить название" }).click();
      await expect(dialog).toHaveCount(0);
      const renamed = page
        .locator(".calendar-event")
        .filter({ hasText: "Подтверждённое название" });
      await expect(renamed).toBeVisible();
      await renamed.click();
      dialog = page.getByRole("dialog");
      await expect(dialog).toContainText("Синтетическая повестка");
      await dialog.getByRole("button", { name: "Предпросмотр отмены" }).click();
      await expect(dialog).toContainText("для всех участников");
      await page.screenshot({
        path: `test-results/desktop/confirm-cancel-${lost}.png`,
      });
      await dialog
        .getByRole("button", { name: "Подтвердить отмену встречи" })
        .click();
      if (lost) {
        await expect(dialog).toContainText("повторная отправка заблокирована");
        await dialog
          .getByRole("button", { name: "Проверить результат изменения" })
          .click();
        await expect(dialog).toContainText("повторная отправка заблокирована");
        await expect(
          dialog.getByRole("button", { name: "Подтвердить отмену встречи" }),
        ).toHaveCount(0);
      } else {
        await expect(dialog).toHaveCount(0);
        await expect(renamed).toHaveCount(0);
      }
      expect(
        await app.evaluate(() => (globalThis as any).syntheticEventMutations),
      ).toBe(2);
      expect(errors).toEqual([]);
    } finally {
      await app.close();
      await rm(userData, { recursive: true, force: true });
    }
  });
}
