import { test, expect } from "@playwright/test";

test("edit memory, reopen it and clear only after confirmation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const entry = page.getByRole("button", {
    name: "Память ассистента",
    exact: true,
  });
  await entry.click();
  const memory = page.getByRole("dialog", { name: "Память", exact: true });
  await expect(memory).toContainText("Алексей · демо-аккаунт");
  await expect(memory).toContainText("Пока нет сохранённых записей");
  for (const text of [
    "Виктор — участник демо-команды.",
    "Повестки встреч оформляй коротким списком",
  ]) {
    await memory
      .getByRole("button", { name: "Добавить запись", exact: true })
      .click();
    await memory.getByLabel("Текст записи").fill(text);
    await memory
      .getByRole("button", { name: "Сохранить запись", exact: true })
      .click();
  }
  await memory.getByRole("button", { name: "Изменить предпочтения" }).click();
  await memory.getByLabel("Предлагать время с").fill("17:00");
  await memory.getByLabel("Предлагать время до").fill("10:00");
  await memory.getByRole("button", { name: "Сохранить предпочтения" }).click();
  await expect(memory.getByRole("alert")).toContainText("раньше окончания");
  await memory.getByLabel("Предлагать время с").fill("10:00");
  await memory.getByLabel("Предлагать время до").fill("18:00");
  await memory.getByLabel("Длительность, минут").fill("45");
  await memory.getByRole("button", { name: "Сохранить предпочтения" }).click();
  await expect(memory).toContainText("45 минут");
  await memory
    .getByRole("button", { name: "Изменить запись 1", exact: true })
    .click();
  await memory
    .getByLabel("Текст записи")
    .fill("Витя — это Виктор из команды разработки.");
  await memory
    .getByRole("button", { name: "Сохранить запись", exact: true })
    .click();
  await expect(memory).toContainText(
    "Витя — это Виктор из команды разработки.",
  );
  await memory
    .getByRole("button", { name: "Удалить запись 2", exact: true })
    .click();
  await expect(memory).not.toContainText(
    "Повестки встреч оформляй коротким списком",
  );
  await memory
    .getByRole("button", { name: "Добавить запись", exact: true })
    .click();
  await memory.getByLabel("Текст записи").fill("  ");
  await memory
    .getByRole("button", { name: "Сохранить запись", exact: true })
    .click();
  await expect(memory.getByRole("alert")).toContainText("Введите текст");
  await memory
    .getByLabel("Текст записи")
    .fill("Демо-проект запускаем в ноябре.");
  await memory
    .getByRole("button", { name: "Сохранить запись", exact: true })
    .click();
  await expect(memory).toContainText("Демо-проект запускаем в ноябре.");
  await page.keyboard.press("Escape");
  await expect(entry).toBeFocused();
  await entry.click();
  await expect(memory).toContainText("45 минут");
  await expect(memory).toContainText("Демо-проект запускаем в ноябре.");
  await memory
    .getByRole("button", { name: "Очистить всю память", exact: true })
    .click();
  await memory.getByRole("button", { name: "Оставить память" }).click();
  await expect(memory).toContainText("45 минут");
  await memory
    .getByRole("button", { name: "Очистить всю память", exact: true })
    .click();
  await memory.getByRole("button", { name: "Да, очистить память" }).click();
  await expect(memory).toContainText("Пока нет сохранённых записей");
  await expect(memory.getByText("Не задано", { exact: true })).toHaveCount(3);
  expect(errors).toEqual([]);
});

test("memory and AI settings open from the rail independently of assistant", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Соседняя панель").selectOption("closed");
  const rail = page.getByRole("navigation", { name: "Разделы Small" });
  await expect(
    rail.getByRole("button", { name: "Память ассистента", exact: true }),
  ).toHaveCount(1);
  await rail
    .getByRole("button", { name: "Память ассистента", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Память", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const ai = rail.getByRole("button", {
    name: "Настройки AI-помощника",
    exact: true,
  });
  await ai.click();
  const settings = page.getByRole("dialog", {
    name: "Настройки AI-помощника",
    exact: true,
  });
  await settings
    .getByLabel("Инструкции помощнику")
    .fill("Отвечай кратко, даты указывай полностью.");
  await settings
    .getByRole("button", { name: "Сохранить", exact: true })
    .click();
  await expect(ai).toBeFocused();
  await ai.click();
  await expect(settings.getByLabel("Инструкции помощнику")).toHaveValue(
    "Отвечай кратко, даты указывай полностью.",
  );
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Открыть навигацию" }).click();
  await rail
    .getByRole("button", { name: "Память ассистента", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Память", exact: true }),
  ).toBeVisible();
});

test("memory opens from rail and fits a narrow window", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Разделы Small" })
    .getByRole("button", { name: "Память ассистента", exact: true })
    .click();
  const memory = page.getByRole("dialog", { name: "Память", exact: true });
  await expect(memory).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const fits = await memory.evaluate(
    (element) => element.scrollWidth <= element.clientWidth,
  );
  expect(fits).toBe(true);
  await memory.getByRole("button", { name: "Изменить предпочтения" }).click();
  await memory.getByLabel("Длительность, минут").fill("45");
  await memory.getByRole("button", { name: "Сбросить длительность" }).click();
  await memory.getByRole("button", { name: "Сохранить предпочтения" }).click();
  await expect(memory.getByText("Не задано", { exact: true })).toHaveCount(3);
});
