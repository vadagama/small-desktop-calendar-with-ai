import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockSmall } from "./fixtures/small-api.js";
import { signOutOfApp } from "./fixtures/keychain.js";
import { calendarToday } from "../../src/shared/calendar-time.js";

type Inspection = typeof globalThis & {
  syntheticEventExtra: Record<string, unknown>;
  syntheticCalendarRequests?: number;
  syntheticPeopleRequests?: number;
};

test("the calendar list and people search come from the cache until the user refreshes or signs in again", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-catalog-"));
  const app = await _electron.launch({
    args: [
      ".",
      `--user-data-dir=${userData}`,
      "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
    ],
    env: { ...process.env, SMALL_TEST_SYNC_INTERVAL_MS: "600000" },
  });
  try {
    const date = calendarToday();
    await mockSmall(app, date);
    await app.evaluate((_electron, day) => {
      (globalThis as Inspection).syntheticEventExtra = {
        starts_at: `${day}T09:00:00+05:00`,
        ends_at: `${day}T09:30:00+05:00`,
      };
    }, date);
    const counts = () =>
      app.evaluate(() => {
        const inspected = globalThis as Inspection;
        return {
          calendars: inspected.syntheticCalendarRequests ?? 0,
          people: inspected.syntheticPeopleRequests ?? 0,
        };
      });
    const page = await app.firstWindow();
    // After signing out the profile dialog stays open with the login form.
    const signIn = async (reopen = true) => {
      if (reopen)
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
    };
    await signIn();
    await page.getByRole("button", { name: "День", exact: true }).click();
    const card = page
      .locator(".calendar-event")
      .filter({ hasText: "Синтетическая встреча A" });
    await expect(card).toContainText("09:00 – 09:30");
    await expect.poll(async () => (await counts()).calendars).toBe(1);

    // The new-meeting form reads the same list and searches people twice for one query.
    await page
      .getByRole("button", { name: "Создать событие", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Новое событие",
      exact: true,
    });
    await expect(dialog).toContainText("Организатор: employee-a");
    const search = async () => {
      await dialog.getByLabel("Поиск участников", { exact: true }).fill("Тест");
      await dialog
        .getByRole("button", { name: "Найти сотрудников", exact: true })
        .click();
      await expect(dialog.getByRole("checkbox").first()).toBeVisible();
    };
    await search();
    await search();
    await dialog
      .getByRole("button", { name: "Закрыть новое событие", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(await counts()).toEqual({ calendars: 1, people: 1 });

    // A write cannot change either catalog, so it does not ask for them again.
    await card.hover();
    const box = (await card.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 16, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByText("Время события изменено")).toBeVisible();
    await expect(card).not.toHaveAttribute("data-pending", /.+/);
    await page.waitForTimeout(400);
    expect((await counts()).calendars).toBe(1);

    // The user's own refresh does.
    await page.getByRole("button", { name: "Обновить", exact: true }).click();
    await expect.poll(async () => (await counts()).calendars).toBe(2);
    await page.getByRole("button", { name: "Обновить", exact: true }).click();
    await expect.poll(async () => (await counts()).calendars).toBe(3);

    // Signing out and in again forgets everything.
    await page
      .getByRole("button", { name: "Профиль Small", exact: true })
      .click();
    await page.getByRole("button", { name: "Выйти из Small" }).click();
    await signIn(false);
    await expect.poll(async () => (await counts()).calendars).toBe(4);
    await page
      .getByRole("button", { name: "Создать событие", exact: true })
      .click();
    await expect(dialog).toContainText("Организатор: employee-a");
    await search();
    await expect.poll(async () => (await counts()).people).toBe(2);
    expect((await counts()).calendars).toBe(4);
  } finally {
    await signOutOfApp(app);
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
