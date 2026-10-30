import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockSmall } from "./fixtures/small-api.js";
import { calendarToday } from "../../src/shared/calendar-time.js";

for (const scope of ["Только это вхождение", "Это и последующие"]) {
  test(`UI deletes recurring meeting: ${scope}`, async () => {
    const userData = await mkdtemp(join(tmpdir(), "small-delete-series-"));
    const app = await _electron.launch({
      args: [
        ".",
        `--user-data-dir=${userData}`,
        "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
      ],
    });
    try {
      await mockSmall(app, calendarToday());
      const page = await app.firstWindow();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
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
      await page.getByRole("button", { name: "День", exact: true }).click();
      const series = page
        .locator(".calendar-event")
        .filter({ hasText: "Синтетическая серия A" });
      await series.click();
      await page.getByLabel("Действия со встречей").click();
      await page.getByRole("button", { name: "Удалить", exact: true }).click();
      const dialog = page.getByRole("dialog", {
        name: "Удалить повторяющуюся встречу",
      });
      await dialog.getByRole("radio", { name: scope, exact: true }).check();
      await expect(
        dialog.getByRole("button", { name: "Удалить", exact: true }),
      ).toBeEnabled();
      await expect(dialog.getByTestId("series-summary")).toContainText(scope);
      await expect(dialog.locator("h2")).toHaveCSS("font-size", "18px");
      await page.screenshot({
        path: `test-results/desktop/delete-series-${scope === "Это и последующие" ? "following" : "single"}.png`,
      });
      await dialog
        .getByRole("button", { name: "Удалить", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(series).toHaveCount(0);
      await expect(
        page
          .locator(".calendar-event")
          .filter({ hasText: "Синтетическая встреча A" }),
      ).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await app.close();
      await rm(userData, { recursive: true, force: true });
    }
  });
}
