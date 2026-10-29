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
      ...(executablePath ? [] : [process.env.SMALL_TEST_APP_ROOT ?? "."]),
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
    await expect(page.locator(".event-resize")).toHaveCount(2);
    const block = page
      .locator(".calendar-event")
      .filter({ hasText: "Синтетическая встреча A" });
    await block.scrollIntoViewIfNeeded();
    await expect(async () => {
      await page.mouse.move(10, 10);
      await block.hover();
      await expect(page.getByRole("tooltip")).toContainText(
        "Синтетический организатор",
        { timeout: 1000 },
      );
    }).toPass({ timeout: 5000 });
    await expect(page.getByRole("tooltip")).toHaveText(
      "Синтетическая встреча A09:00–10:00 · 60 минОрганизатор: Синтетический организатор",
    );
    await expect(page.locator(".event-tooltip:popover-open")).toBeVisible();
    await page.screenshot({ path: "test-results/desktop/event-tooltip.png" });
    await page
      .locator(".calendar-event")
      .filter({ hasText: "Синтетическая встреча A" })
      .click();
    const details = page.getByRole("dialog", {
      name: "Синтетическая встреча A",
    });
    await expect(details).toContainText("09:00 – 10:00");
    await expect(details).toContainText("Синтетическая повестка");
    await details.getByLabel("Действия со встречей").click();
    await expect(
      details.locator(".event-menu-items:popover-open"),
    ).toBeVisible();
    await expect(details.locator(".event-menu-items button").first()).toHaveCSS(
      "font-size",
      "12px",
    );
    const checkMenuPosition = async () => {
      const anchor = (await details
        .getByLabel("Действия со встречей")
        .boundingBox())!;
      const menu = (await details.locator(".event-menu-items").boundingBox())!;
      expect(Math.abs(menu.x - anchor.x)).toBeLessThan(1);
      expect(Math.abs(menu.y - anchor.y - anchor.height - 8)).toBeLessThan(1);
    };
    await checkMenuPosition();
    await page.setViewportSize({ width: 1200, height: 900 });
    await expect(checkMenuPosition).toPass();
    await page.setViewportSize({ width: 1440, height: 960 });
    await expect(checkMenuPosition).toPass();
    await page.screenshot({
      path: "test-results/desktop/event-details-menu.png",
    });
    await details
      .getByRole("button", { name: "Редактировать", exact: true })
      .click();
    await details.getByLabel("Новое название").fill("Новый синтетический план");
    await app.evaluate(() => {
      (
        globalThis as typeof globalThis & { syntheticEventOwner: string }
      ).syntheticEventOwner = "another-person";
    });
    await details
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    const failureNotice = page.locator(".notification-error");
    await expect(failureNotice).toContainText("недостаточно прав");
    await page.screenshot({
      path: "test-results/desktop/notification-error.png",
      animations: "disabled",
    });
    await failureNotice
      .getByRole("button", { name: "Закрыть уведомление" })
      .click();
    await expect(failureNotice).toHaveCount(0);
    await app.evaluate(() => {
      (
        globalThis as typeof globalThis & { syntheticEventOwner: string }
      ).syntheticEventOwner = "synthetic-organizer";
    });

    await details
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Новый синтетический план" }),
    ).toBeVisible();
    const renamed = page.getByRole("dialog", {
      name: "Новый синтетический план",
    });
    await renamed.getByLabel("Действия со встречей").click();
    await renamed
      .getByRole("button", { name: "Редактировать", exact: true })
      .click();
    await renamed.getByLabel("Новое название").fill("Синтетическая встреча A");
    await renamed
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await expect(details).toBeVisible();
    await expect(details.getByText("Синтетическая повестка")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(details).toHaveCount(0);
    await block.scrollIntoViewIfNeeded();
    const endHandle = block.locator(".event-resize.end");
    await endHandle.hover();
    const endBox = (await endHandle.boundingBox())!;
    await page.mouse.move(
      endBox.x + endBox.width / 2,
      endBox.y + endBox.height / 2,
    );
    await page.mouse.down();
    await page.waitForTimeout(400);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await page.mouse.move(
      endBox.x + endBox.width / 2,
      endBox.y + endBox.height / 2 + 32,
      { steps: 8 },
    );
    await page.mouse.up();
    await expect(block).toContainText("09:00 – 10:30");
    await expect(block).not.toHaveAttribute("data-pending", /.+/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const startBox = (await block
      .locator(".event-resize.start")
      .boundingBox())!;
    await page.mouse.move(
      startBox.x + startBox.width / 2,
      startBox.y + startBox.height / 2,
    );
    await page.mouse.down();
    await page.waitForTimeout(400);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await page.mouse.move(
      startBox.x + startBox.width / 2,
      startBox.y + startBox.height / 2 + 16,
      { steps: 8 },
    );
    await page.mouse.up();
    await expect(block).toContainText("09:15 – 10:30");
    await expect(block).not.toHaveAttribute("data-pending", /.+/);
    const moveBox = (await block.boundingBox())!;
    await page.mouse.move(moveBox.x + 40, moveBox.y + 22);
    await page.mouse.down();
    await page.waitForTimeout(400);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await page.mouse.move(moveBox.x + 40, moveBox.y + 38, { steps: 8 });
    await page.mouse.up();
    await expect(block).toContainText("09:30 – 10:45");
    // Small must have answered before the test changes the server state under it.
    await expect(block).not.toHaveAttribute("data-pending", /.+/);
    await app.evaluate(() => {
      (
        globalThis as typeof globalThis & {
          syntheticEventExtra: Record<string, unknown>;
        }
      ).syntheticEventExtra = {
        creator_id: "another-organizer",
        is_informed: false,
        participants: Array.from({ length: 7 }, (_, i) => ({
          id: i === 0 ? "synthetic-organizer" : `person-${i}`,
          name: `Тестовый участник ${i + 1}`,
          status: "pending",
        })),
        description: "meet.small.kz/synthetic",
      };
    });
    await block.click();
    await expect(
      details.getByRole("button", { name: "Показать всех (7)" }),
    ).toBeVisible();
    await details.getByRole("button", { name: "Показать всех (7)" }).click();
    await expect(
      details.getByText("Тестовый участник 7", { exact: true }),
    ).toBeVisible();
    await expect(details.locator(".event-link-text")).toHaveAttribute(
      "href",
      "https://meet.small.kz/synthetic",
    );
    await expect(details.locator(".event-card-description")).toHaveCount(0);
    await details
      .getByRole("button", { name: "Скопировать ссылку подключения" })
      .click();
    await expect(
      details.getByText("Ссылка скопирована", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/desktop/event-details-invitation.png",
    });
    await details.getByRole("button", { name: "Да", exact: true }).click();
    await expect(
      details.getByRole("button", { name: "Да", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByText("Ответ на приглашение сохранён", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await app.evaluate(() => {
      delete (
        globalThis as typeof globalThis & {
          syntheticEventExtra?: Record<string, unknown>;
        }
      ).syntheticEventExtra;
    });

    await app.evaluate(() => {
      (
        globalThis as typeof globalThis & {
          syntheticEventExtra: Record<string, unknown>;
        }
      ).syntheticEventExtra = {
        description:
          "1. Обсудить варианты размещения сервисов.\n2. Согласовать ответственных участников.\n3. Определить сроки и следующие шаги.",
      };
    });
    await block.click();
    const agenda = details.getByRole("region", { name: "Повестка" });
    const collapsedHeight = (await agenda.locator("p").boundingBox())!.height;
    await agenda.getByRole("button", { name: "Показать полностью" }).click();
    await expect(
      agenda.getByRole("button", { name: "Свернуть" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect((await agenda.locator("p").boundingBox())!.height).toBeGreaterThan(
      collapsedHeight,
    );
    await agenda.getByRole("button", { name: "Свернуть" }).click();
    expect((await agenda.boundingBox())!.y).toBeLessThan(
      (await details.locator(".event-card-date").boundingBox())!.y,
    );
    await page.screenshot({
      path: "test-results/desktop/event-agenda.png",
      animations: "disabled",
    });
    await details.getByLabel("Действия со встречей").click();
    const writesBeforeDelete = await app.evaluate(
      () =>
        (globalThis as typeof globalThis & { syntheticEventMutations: number })
          .syntheticEventMutations,
    );
    await details.getByRole("button", { name: "Удалить", exact: true }).click();
    await expect(details).toHaveCount(0);
    await expect(
      page.getByText("Событие успешно удалено", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/desktop/notification-success.png",
      animations: "disabled",
    });
    expect(
      await app.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              syntheticEventMutations: number;
            }
          ).syntheticEventMutations,
      ),
    ).toBe(writesBeforeDelete + 1);

    await page
      .locator(".calendar-event")
      .filter({ hasText: "Синтетическая серия A" })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Синтетическая серия A" }),
    ).toContainText("11:00");
    await expect(
      page.getByRole("button", { name: "Предпросмотр отмены", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Месяц", exact: true }).click();
    await expect(page.locator(".month-day")).toHaveCount(35);
    await expect(page.locator(".month-event")).toHaveCount(1);
    const room = page.getByRole("checkbox", {
      name: "Тестовая переговорная",
      exact: true,
    });
    const personal = page.getByRole("checkbox", {
      name: "Мой календарь",
      exact: true,
    });
    await expect(room).toHaveCount(0);
    await expect(personal).toBeVisible();
    await page
      .getByRole("button", { name: "Переговорные", exact: true })
      .click();
    await expect(personal).toHaveCount(0);
    await room.check();
    await expect(page.locator(".month-event")).toHaveCount(1);
    await page.getByRole("button", { name: "Календарь", exact: true }).click();
    await expect(room).toHaveCount(0);
    await expect(personal).toBeChecked();
    await page
      .getByRole("button", { name: "Переговорные", exact: true })
      .click();
    await expect(room).toBeChecked();
    await expect(page.locator(".month-event")).toHaveCount(1);
    await page.getByRole("checkbox", { name: "Нет прав", exact: true }).check();
    await expect(page.locator(".calendar-warning")).toContainText(
      "Нет доступа",
    );
    await expect(page.locator(".month-event")).toHaveCount(1);
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
