import { test, expect } from "@playwright/test";
test("list, organizer clarification, tooltip, event dialog and reset", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Список", exact: true }).click();
  await expect(page.locator(".event-list-row").first()).toBeVisible();
  await page
    .getByRole("button", {
      name: "Найди все события, где организатором была Жанна",
    })
    .click();
  await expect(page.getByRole("log")).toContainText("За какой период?");
  await page
    .getByRole("textbox", { name: "Сообщение ассистенту" })
    .fill("за октябрь 2026");
  await page.getByRole("button", { name: "Отправить сообщение" }).click();
  await expect(
    page.getByRole("button", { name: "Убрать фильтр организатора" }),
  ).toBeVisible();
  await expect(page.locator(".event-list-row")).toHaveCount(5);
  await expect(page.locator(".event-list-summary")).toContainText(
    "Найдено событий: 5",
  );
  await page.locator(".event-list-row").first().hover();
  await expect(page.getByRole("tooltip")).toContainText("Обзор задач команды");
  await page.locator(".event-list-row").first().click();
  await expect(page.getByRole("dialog", { name: "О встрече" })).toContainText(
    "Жанна",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Название события в списке")).toHaveCount(0);
  await expect(page.getByLabel("Начало периода")).toHaveCount(0);
  await expect(page.getByLabel("Конец периода")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Сбросить", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Убрать фильтр организатора" })
    .click();
  await expect(page.locator(".event-list-row").first()).toBeVisible();
  await page.getByRole("button", { name: "День", exact: true }).click();
  await expect(page.locator(".day-column")).toHaveCount(1);
  expect(errors).toEqual([]);
});
test("list follows month navigation and selected calendars", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Список", exact: true }).click();
  await page.getByRole("button", { name: "Следующий период" }).click();
  await expect(page.locator(".calendar-toolbar h2")).toContainText(
    "ноябрь 2026",
  );
  await expect(page.locator(".event-list-day time").first()).toHaveAttribute(
    "datetime",
    /^2026-11-/,
  );
  for (const name of [
    "Мой календарь",
    "Команды Small",
    "Переговорная «Астана»",
  ]) {
    const checkbox = page.getByRole("checkbox", { name, exact: true });
    await checkbox.uncheck();
  }
  await expect(
    page.getByText("Событий не найдено", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 900, height: 800 });
  expect(
    await page
      .locator(".event-list-view")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
});
