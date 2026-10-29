import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { AsyncEntry } from "@napi-rs/keyring";
import { mockSmall } from "./fixtures/small-api.js";
import { calendarToday } from "../../src/shared/calendar-time.js";

test("calendar reads Small events and details, distinguishes partial/empty/errors and clears on logout", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-calendar-e2e-"));
  const executablePath = process.env.SMALL_APP_EXECUTABLE;
  const app = await _electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [
      ...(executablePath ? [] : ["."]),
      `--user-data-dir=${userData}`,
      "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
    ],
    env: { ...process.env, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
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
    const mini = page.getByRole("region", { name: "Выбор даты" });
    await expect(mini).toBeVisible();
    const month = (await mini.locator(".mini-heading strong").textContent())!;
    const title = await page.locator(".calendar-toolbar h2").innerText();
    await mini
      .getByRole("button", { name: "Следующий месяц", exact: true })
      .click();
    await expect(mini.locator(".mini-heading strong")).not.toHaveText(month);
    await expect(page.locator(".calendar-toolbar h2")).toHaveText(title);
    const day = mini
      .locator("button[aria-pressed=false]:not(.muted-day)")
      .first();
    const chosenLabel = await day.getAttribute("aria-label");
    await day.click();
    await expect(
      mini.getByRole("button", { name: chosenLabel!, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Сегодня", exact: true }).click();
    await expect(mini.locator(".mini-heading strong")).toHaveText(month);
    await expect(page.locator(".calendar-toolbar h2")).toHaveText(title);
    await expect(page.locator(".calendar-event")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Профиль Small", exact: true })
      .click();
    const login = async (employee: string) => {
      await page.getByLabel("Логин", { exact: true }).fill(employee);
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
    await login("employee-a");
    await expect(page.locator(".calendar-event")).toHaveCount(2);
    await expect
      .poll(() =>
        page
          .locator(".timeline-scroll")
          .evaluate((element) => element.scrollTop),
      )
      .toBe(512);
    await page.setViewportSize({ width: 900, height: 640 });
    await page
      .getByRole("button", { name: "Показать календари", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Переговорные", exact: true }),
    ).toBeVisible();
    await expect(mini).toBeVisible();
    await page.screenshot({ path: "test-results/desktop/calendar-900.png" });
    await page
      .getByRole("button", { name: "Закрыть список календарей", exact: true })
      .click();
    await page.setViewportSize({ width: 1440, height: 960 });

    await page.getByRole("button", { name: "День", exact: true }).click();
    await expect(page.locator(".calendar-event")).toHaveCount(2);
    await expect(page.locator(".calendar-event").first()).toContainText(
      "09:00 – 10:00",
    );
    await expect(page.locator(".event-resize")).toHaveCount(0);
    await page
      .locator(".calendar-event")
      .filter({ hasText: "Синтетическая встреча A" })
      .click();
    const details = page.getByRole("dialog", {
      name: "Синтетическая встреча A",
    });
    await expect(details).toContainText("09:00:00");
    await expect(details).toContainText("Синтетическая повестка");
    await expect(details).toContainText("Asia/Almaty");
    await details.getByLabel("Новое название").fill("Новый синтетический план");
    await details
      .getByRole("button", { name: "Предпросмотр названия", exact: true })
      .click();
    const preview = details.getByRole("region", {
      name: "Предпросмотр изменения",
    });
    await expect(preview).toContainText("Синтетическая встреча A");
    await expect(preview).toContainText("Новый синтетический план");
    await expect(preview).toContainText("Синтетическая повестка");
    await expect(preview).toContainText("employee-a, synthetic-b");
    await expect(preview).toContainText("Ничего не применено");
    await page.setViewportSize({ width: 900, height: 640 });
    await page.screenshot({
      path: "test-results/desktop/event-change-preview.png",
    });
    await details.getByLabel("Новое название").fill("Другой план");
    await expect(preview).toHaveCount(0);
    await details
      .getByRole("button", { name: "Предпросмотр отмены", exact: true })
      .click();
    await expect(preview).toContainText("Отменить всю разовую встречу");
    await expect(preview).toContainText("Ничего не применено");
    await app.evaluate(() => {
      (
        globalThis as typeof globalThis & { syntheticEventOwner: string }
      ).syntheticEventOwner = "other";
    });
    await details
      .getByRole("button", { name: "Предпросмотр отмены", exact: true })
      .click();
    await expect(details.getByRole("alert")).toContainText(
      "только организатор",
    );
    await expect(preview).toHaveCount(0);
    expect(
      await app.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              syntheticEventMutations: number;
            }
          ).syntheticEventMutations,
      ),
    ).toBe(0);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.screenshot({ path: "test-results/desktop/calendar-detail.png" });
    await page.keyboard.press("Escape");
    await page
      .locator(".calendar-event")
      .filter({ hasText: "Синтетическая серия A" })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Синтетическая серия A" }),
    ).toContainText("11:00:00");
    await expect(
      page.getByRole("button", { name: "Предпросмотр отмены", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Месяц", exact: true }).click();
    await expect(page.locator(".month-day")).toHaveCount(35);
    await expect(page.locator(".month-event")).toHaveCount(2);
    await page
      .getByRole("button", { name: "Переговорные", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: "Тестовая переговорная", exact: true })
      .check();
    await expect(page.locator(".month-event")).toHaveCount(2);
    await page
      .getByRole("checkbox", { name: "Мой календарь", exact: true })
      .check();
    await expect(
      page.getByRole("checkbox", {
        name: "Тестовая переговорная",
        exact: true,
      }),
    ).not.toBeChecked();
    await page
      .getByRole("checkbox", { name: "Тестовая переговорная", exact: true })
      .check();
    await expect(page.locator(".month-event")).toHaveCount(2);
    await page.getByRole("checkbox", { name: "Нет прав", exact: true }).check();
    await expect(page.locator(".calendar-warning")).toContainText(
      "Нет доступа",
    );
    await expect(page.locator(".month-event")).toHaveCount(2);
    await page.screenshot({
      path: "test-results/desktop/calendar-partial.png",
    });
    await page
      .getByRole("checkbox", { name: "Тестовая переговорная", exact: true })
      .uncheck();
    await expect(
      page.getByText("Нет подтверждённых данных за этот период."),
    ).toBeVisible();
    await expect(
      page.getByText("В этом периоде встреч нет.", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("checkbox", { name: "Тестовая переговорная", exact: true })
      .check();
    await page
      .getByRole("checkbox", { name: "Нет прав", exact: true })
      .uncheck();
    await page
      .getByRole("checkbox", { name: "Сбой сервера", exact: true })
      .check();
    await expect(page.locator(".calendar-warning")).toContainText(
      "Не удалось загрузить",
    );
    await page
      .getByRole("checkbox", { name: "Сбой сервера", exact: true })
      .uncheck();
    await page
      .getByRole("checkbox", { name: "Неполный ответ", exact: true })
      .check();
    await expect(page.locator(".calendar-warning")).toContainText(
      "неизвестный формат",
    );
    await page
      .getByRole("checkbox", { name: "Неполный ответ", exact: true })
      .uncheck();
    await page
      .getByRole("checkbox", { name: "Тестовая переговорная", exact: true })
      .uncheck();
    await page
      .getByRole("checkbox", { name: "Пустой календарь", exact: true })
      .check();
    await expect(
      page.getByText("В этом периоде встреч нет.", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".month-event")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Профиль Small", exact: true })
      .click();
    await page.getByRole("button", { name: "Выйти из Small" }).click();
    await expect(
      page.getByRole("button", { name: "Войти в Small", exact: true }),
    ).toBeVisible();
    await login("employee-b");
    await expect(
      page
        .locator(".month-event")
        .filter({ hasText: "Синтетическая встреча B" }),
    ).toBeVisible();
    await expect(
      page.getByText("Синтетическая встреча A", { exact: false }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Профиль Small", exact: true })
      .click();
    await page.getByRole("button", { name: "Выйти из Small" }).click();
    await expect(
      page.getByRole("button", { name: "Войти в Small", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Закрыть профиль Small" }).click();
    await expect(page.locator(".month-event")).toHaveCount(0);
    await expect(
      page.getByText("Войдите в Small через кнопку профиля внизу слева."),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    const service = `kz.small.desktop-calendar.llm.${createHash("sha256").update(userData).digest("hex").slice(0, 24)}`;
    try {
      await new AsyncEntry(service, "small-auth-session-v1").deleteCredential();
    } catch {
      /* Missing after logout. */
    }
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
