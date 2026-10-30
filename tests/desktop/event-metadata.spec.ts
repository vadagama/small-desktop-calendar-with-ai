import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockSmall } from "./fixtures/small-api.js";
import { calendarToday } from "../../src/shared/calendar-time.js";

test("event card shows informed people, meeting rooms and recurrence", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-event-metadata-"));
  const app = await _electron.launch({
    args: [
      ".",
      `--user-data-dir=${userData}`,
      "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
    ],
  });
  try {
    await mockSmall(app, calendarToday());
    await app.evaluate(() => {
      (
        globalThis as typeof globalThis & {
          syntheticEventExtra: Record<string, unknown>;
        }
      ).syntheticEventExtra = {
        notification_recipients: Array.from({ length: 6 }, (_, i) => ({
          id: `informed-${i}`,
          name: `Тестовый информируемый ${i + 1}`,
        })),
        calendar_ids: [25, 7],
        attachments: [
          { id: 1, path: "calendar/synthetic/План встречи.pdf", size: 2048 },
          { id: 2, path: "calendar/synthetic/Фото.HEIC", size: 1048576 },
        ],
        location: "https://meet.small.kz/synthetic-meeting",
        is_recurring: true,
        recurrence_rule: { FREQ: "WEEKLY", INTERVAL: 2, BYDAY: ["FR"] },
      };
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
    await page.getByRole("button", { name: "День", exact: true }).click();
    await expect(
      page
        .locator(".calendar-event")
        .filter({ hasText: "Синтетическая серия A" })
        .getByRole("img", { name: "Повторяющееся событие" }),
    ).toBeVisible();
    await page
      .locator(".calendar-event")
      .filter({ hasText: "Синтетическая встреча A" })
      .click();
    const card = page.getByRole("dialog", { name: "Синтетическая встреча A" });
    const informed = card.getByRole("region", {
      name: "Информировать",
      exact: true,
    });
    await expect(card).not.toContainText("Календарь №25");
    await expect(
      card.getByRole("link", { name: /План встречи.pdf/ }),
    ).toBeVisible();
    await expect(
      card.getByRole("region", { name: "Прикреплённые файлы" }),
    ).toContainText("2 КБ");
    await expect(informed).toContainText("Тестовый информируемый 1");
    await expect(informed.getByRole("listitem")).toHaveCount(5);
    await expect(informed.locator(".event-avatar svg")).toHaveCount(0);
    await informed.getByRole("button", { name: "Показать всех (6)" }).click();
    await expect(informed.getByRole("listitem")).toHaveCount(6);
    await informed.getByRole("button", { name: "Свернуть" }).click();
    await app.evaluate(({ shell }) => {
      shell.openExternal = async (url: string) => {
        (
          globalThis as typeof globalThis & { syntheticOpenedUrl?: string }
        ).syntheticOpenedUrl = url;
      };
    });
    await card.getByRole("link", { name: /План встречи.pdf/ }).focus();
    await page.keyboard.press("Enter");
    expect(
      await app.evaluate(
        () =>
          (globalThis as typeof globalThis & { syntheticOpenedUrl?: string })
            .syntheticOpenedUrl,
      ),
    ).toContain("https://minio.skiftrade.kz:9000/team/calendar/synthetic/");
    await expect(card.locator(".event-file-name").first()).toHaveCSS(
      "font-size",
      "13px",
    );
    await expect(
      card.getByRole("region", { name: "Переговорные", exact: true }),
    ).toContainText("Тестовая переговорная");
    await expect(
      card.getByRole("region", { name: "Повторяется", exact: true }),
    ).toContainText("Каждые 2 недели: пт");
    await expect(
      card.getByRole("link", {
        name: "https://meet.small.kz/synthetic-meeting",
      }),
    ).toBeVisible();
    await expect(informed.locator("li").first()).toHaveCSS("font-size", "13px");
    await expect(card.locator("h2")).toHaveCSS("font-size", "18px");
    await page.screenshot({ path: "test-results/desktop/event-metadata.png" });
    await page.setViewportSize({ width: 460, height: 700 });
    await expect(card).toBeVisible();
    expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: "test-results/desktop/event-metadata-narrow.png",
    });
    await card.getByRole("button", { name: "Закрыть событие" }).click();
    await page
      .locator(".calendar-event")
      .filter({ hasText: "Синтетическая серия A" })
      .click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("region", { name: "Повторяется", exact: true }),
    ).toContainText("Каждые 2 недели: пт");
    await page.getByRole("button", { name: "Закрыть событие" }).click();
    await app.evaluate(() => {
      (
        globalThis as typeof globalThis & {
          syntheticEventExtra: Record<string, unknown>;
        }
      ).syntheticEventExtra = {
        notification_recipients: [],
        calendar_ids: [],
        is_recurring: false,
        recurrence_rule: null,
      };
    });
    await page
      .locator(".calendar-event")
      .filter({ hasText: "Синтетическая встреча A" })
      .click();
    for (const name of ["Информировать", "Переговорные", "Повторяется"])
      await expect(card.getByRole("region", { name, exact: true })).toHaveCount(
        0,
      );
    await card.getByRole("button", { name: "Закрыть событие" }).click();
    await app.evaluate(() => {
      (
        globalThis as typeof globalThis & {
          syntheticEventExtra: Record<string, unknown>;
        }
      ).syntheticEventExtra = {
        calendar_ids: [25],
        is_recurring: true,
        recurrence_rule: null,
      };
    });
    await page
      .locator(".calendar-event")
      .filter({ hasText: "Синтетическая встреча A" })
      .click();
    await expect(
      card.getByRole("region", { name: "Переговорные", exact: true }),
    ).toHaveCount(0);
    await expect(
      card.getByRole("region", { name: "Повторяется", exact: true }),
    ).toContainText("Повторяющееся событие");
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
