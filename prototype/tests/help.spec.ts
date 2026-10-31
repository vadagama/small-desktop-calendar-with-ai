import { test, expect } from "@playwright/test";

test("help searches and inserts an editable prompt without losing a draft", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.locator(".assistant-panel textarea");
  await input.fill("Мой черновик");
  await page.getByRole("button", { name: "Помощь", exact: true }).click();
  const help = page.getByRole("region", { name: "Руководство Small" });
  await help.getByRole("searchbox").fill("несуществующая тема");
  await expect(help.getByText("Ничего не найдено")).toBeVisible();
  await help.getByRole("button", { name: "Сбросить поиск" }).click();
  await help
    .getByRole("button", { name: "Подобрать время", exact: true })
    .click();
  await help.getByRole("button", { name: "Подставить запрос" }).click();
  await expect(help).not.toBeVisible();
  await expect(input).toHaveValue(
    "Мой черновик\nНайди 30 минут для команды завтра",
  );
  await expect(input).toBeFocused();
  await expect(page.locator(".slot-list button")).toHaveCount(0);
});

test("help is a full section and preserves the lesson after an interactive action", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Помощь", exact: true });
  await trigger.click();
  const help = page.getByRole("region", { name: "Руководство Small" });
  await expect(help).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".calendar-panel")).not.toBeVisible();
  await expect(trigger).toHaveAttribute("aria-current", "page");
  await help.getByRole("button", { name: "Далее: Аутентификация" }).click();
  await expect(
    help.getByRole("heading", { name: "Аутентификация", exact: true }),
  ).toBeVisible();
  await help
    .getByRole("button", { name: "Память ассистента", exact: true })
    .click();
  await help.getByRole("button", { name: "Открыть память" }).click();
  await expect(
    page.getByRole("dialog", { name: "Память", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    help.getByRole("heading", { name: "Память ассистента", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Календарь", exact: true })
    .first()
    .click();
  await expect(help).not.toBeVisible();
  await trigger.click();
  await expect(
    help.getByRole("heading", { name: "Память ассистента", exact: true }),
  ).toBeVisible();
});

test("images load, actions navigate and help fits narrow windows", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Помощь", exact: true });
  await trigger.click();
  const help = page.getByRole("region", { name: "Руководство Small" });
  for (const title of [
    "С чего начать",
    "Аутентификация",
    "Настройка LLM",
    "Работать с календарём",
    "Подобрать время",
    "Найти события",
    "Посмотреть загрузку",
    "Настройка уведомлений",
    "Память ассистента",
    "Настроить ассистента",
  ]) {
    await help.getByRole("button", { name: title, exact: true }).click();
    await expect
      .poll(() =>
        help
          .locator("img")
          .evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
          ),
      )
      .toBe(true);
  }
  await help.getByRole("button", { name: "Открыть настройки AI" }).click();
  await expect(
    page.getByRole("dialog", { name: "Настройки AI-помощника" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await trigger.click();
  await help
    .getByRole("button", { name: "Посмотреть загрузку", exact: true })
    .click();
  await help.getByRole("button", { name: "Открыть аналитику" }).click();
  await expect(
    page.getByRole("combobox", { name: "Основная панель", exact: true }),
  ).not.toHaveValue("calendar");
  await trigger.click();
  await help
    .getByRole("button", { name: "С чего начать", exact: true })
    .click();
  await help.getByRole("button", { name: "Открыть календарь" }).click();
  await expect(
    page.getByRole("combobox", { name: "Основная панель", exact: true }),
  ).toHaveValue("calendar");
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 760)
      await page.getByRole("button", { name: "Открыть навигацию" }).click();
    await trigger.click();
    expect(await help.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await help
      .getByRole("button", { name: "С чего начать", exact: true })
      .click();
    await help.getByRole("button", { name: "Открыть календарь" }).click();
  }
  expect(errors).toEqual([]);
});
