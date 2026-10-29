import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { AsyncEntry } from "@napi-rs/keyring";
import { mockSmall } from "./fixtures/small-api.js";
import { calendarToday } from "../../src/shared/calendar-time.js";

test("explicit participants, pagination, verified slots, unknown busy and session isolation", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-slots-e2e-"));
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
    page.on("console", (message) => {
      if (["warning", "error"].includes(message.type()))
        errors.push(message.text());
    });
    await expect(
      page.getByRole("button", { name: "Подобрать время", exact: true }),
    ).toBeDisabled();
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
      .getByRole("button", { name: "Подобрать время", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Общее время" });
    await expect(dialog).toBeVisible();
    const search = async (text: string) => {
      await dialog.getByLabel("Имя сотрудника").fill(text);
      await dialog
        .getByRole("button", { name: "Найти сотрудников", exact: true })
        .click();
    };
    await search("Тест");
    await expect(dialog.getByRole("checkbox")).toHaveCount(2);
    await expect(
      dialog.getByRole("button", { name: "Найти общее время", exact: true }),
    ).toBeDisabled();
    await dialog.getByRole("checkbox", { name: /Отдел A/ }).check();
    await dialog.getByRole("checkbox", { name: /Отдел B/ }).check();
    await dialog
      .getByRole("button", { name: "Следующая страница сотрудников" })
      .click();
    await expect(
      dialog.getByRole("checkbox", { name: /Другой сотрудник/ }),
    ).toBeVisible();
    // A future weekday makes the check independent of the test machine's clock.
    await dialog.getByLabel("Дата встречи").fill("2099-10-29");
    await dialog
      .getByRole("button", { name: "Найти общее время", exact: true })
      .click();
    await expect(
      dialog.getByText("09:30 – 10:00", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText("09:00 – 09:30", { exact: true }),
    ).toHaveCount(0);
    await page.setViewportSize({ width: 900, height: 640 });
    await dialog
      .getByRole("region", { name: "Результаты подбора" })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "test-results/desktop/availability-900.png",
    });
    await dialog.getByLabel("Длительность").selectOption("60");
    await expect(
      dialog.getByText("09:30 – 10:00", { exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "Найти общее время", exact: true })
      .click();
    await expect(
      dialog.getByText(/Small не предложил подходящих слотов/),
    ).toBeVisible();
    await dialog.getByLabel("Длительность").selectOption("30");
    await search("неизвестно");
    await dialog
      .getByRole("checkbox", { name: /Неизвестная занятость/ })
      .check();
    await dialog
      .getByRole("button", { name: "Найти общее время", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "занятости каждого участника",
    );
    await page.screenshot({
      path: "test-results/desktop/availability-unknown.png",
    });
    await dialog
      .getByRole("button", { name: "Убрать Неизвестная занятость unknown" })
      .click();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await search("пусто");
    await expect(
      dialog.getByText("По этому запросу сотрудники не найдены."),
    ).toBeVisible();
    await search("нет прав");
    await dialog.getByRole("checkbox", { name: /Закрытый календарь/ }).check();
    await dialog
      .getByRole("button", { name: "Найти общее время", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText("Нет доступа");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Подобрать время", exact: true }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Профиль Small", exact: true })
      .click();
    await page.getByRole("button", { name: "Выйти из Small" }).click();
    await expect(
      page.getByRole("button", { name: "Войти в Small", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Закрыть профиль Small" }).click();
    await expect(
      page.getByRole("button", { name: "Подобрать время", exact: true }),
    ).toBeDisabled();
    expect(errors).toEqual([]);
  } finally {
    try {
      await new AsyncEntry(
        `kz.small.desktop-calendar.llm.${createHash("sha256").update(userData).digest("hex").slice(0, 24)}`,
        "small-auth-session-v1",
      ).deleteCredential();
    } catch {
      /* Already logged out. */
    }
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
