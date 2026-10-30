import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockSmall } from "./fixtures/small-api.js";
import { calendarToday } from "../../src/shared/calendar-time.js";

test("personal participation filters work locally in every view and preserve room calendars", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-filters-e2e-"));
  const executablePath = process.env.SMALL_APP_EXECUTABLE;
  const app = await _electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [
      ...(executablePath ? [] : [process.env.SMALL_TEST_APP_ROOT ?? "."]),
      `--user-data-dir=${userData}`,
      "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
    ],
    env: { ...process.env, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
  });
  try {
    await mockSmall(app, calendarToday());
    await app.evaluate(() => {
      Object.assign(globalThis, {
        syntheticListApplied: {
          creator_id: "someone-else",
          is_informed: false,
          participants: [{ id: "synthetic-organizer", status: "pending" }],
        },
      });
    });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
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
    await expect(page.locator(".calendar-event")).toHaveCount(2);
    const own = page.getByRole("checkbox", {
      name: "Мои встречи",
      exact: true,
    });
    const invited = page.getByRole("checkbox", {
      name: "Я участник",
      exact: true,
    });
    const informed = page.getByRole("checkbox", {
      name: "Я информирован",
      exact: true,
    });
    for (const filter of [own, invited, informed])
      await expect(filter).toBeChecked();
    const requests = () =>
      app.evaluate(
        () =>
          (globalThis as typeof globalThis & { syntheticListRequests: number })
            .syntheticListRequests,
      );
    const before = await requests();
    await own.uncheck();
    await expect(
      page.locator(".calendar-event.participation-organizer"),
    ).toHaveCount(0);
    await expect(
      page.locator(".calendar-event.participation-invited"),
    ).toHaveCount(1);
    await invited.uncheck();
    await informed.uncheck();
    await expect(page.locator(".calendar-event")).toHaveCount(0);
    await expect(
      page.getByText("Нет встреч выбранных типов.", { exact: true }),
    ).toBeVisible();
    await own.check();
    await expect(
      page.locator(".calendar-event.participation-organizer"),
    ).toHaveCount(1);
    expect(await requests()).toBe(before);
    for (const view of ["День", "Месяц", "Неделя"]) {
      await page.getByRole("button", { name: view, exact: true }).click();
      await expect(page.locator(".calendar-event, .month-event")).toHaveCount(
        1,
      );
    }
    await page
      .getByRole("button", { name: "Переговорные", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: "Тестовая переговорная", exact: true })
      .check();
    await expect(page.locator(".calendar-event")).toHaveCount(2);
    await page.getByRole("button", { name: "Календарь", exact: true }).click();
    await expect(invited).not.toBeChecked();
    await expect(page.locator(".calendar-event")).toHaveCount(1);

    await app.evaluate(() => {
      Object.assign(globalThis, {
        syntheticEventExtra: {
          creator_id: "someone-else",
          is_informed: true,
          participants: [],
          notification_recipients: [{ id: "synthetic-organizer" }],
        },
      });
    });
    await page.getByRole("button", { name: "Обновить", exact: true }).click();
    await expect(page.locator(".calendar-event")).toHaveCount(0);
    await informed.check();
    await expect(
      page.locator(".calendar-event.participation-informed"),
    ).toHaveCount(1);
    await invited.check();
    await expect(page.locator(".calendar-event")).toHaveCount(2);
    const swatches = page.locator(".calendar-filters .custom-check");
    await expect(swatches.nth(0)).toHaveCSS(
      "background-color",
      "rgb(223, 242, 252)",
    );
    await expect(swatches.nth(1)).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
    await expect(swatches.nth(2)).toHaveCSS(
      "background-color",
      "rgba(223, 242, 252, 0.4)",
    );
    await expect(page.locator(".calendar-filters label").first()).toHaveCSS(
      "font-size",
      "12px",
    );
    await page.screenshot({
      path: "test-results/desktop/participation-filters.png",
    });
    await page.setViewportSize({ width: 900, height: 640 });
    await page
      .getByRole("button", { name: "Показать календари", exact: true })
      .click();
    await expect(informed).toBeVisible();
    await invited.focus();
    await page.keyboard.press("Space");
    await expect(invited).not.toBeChecked();
    await expect(page.locator(".calendar-event")).toHaveCount(1);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
