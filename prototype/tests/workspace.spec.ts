import { test, expect } from "@playwright/test";
const settings = async (page: import("@playwright/test").Page) => {
  await page.getByRole("button", { name: "Настройки пространства" }).click();
};
test("week, event card, views and filters work without browser errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "26 октября — 1 ноября" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Развитие календаря/ }).click();
  await expect(page.getByRole("dialog", { name: "О встрече" })).toBeVisible();
  await expect(page.getByText("11:30 — 12:30 · 60 мин")).toBeVisible();
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.getByRole("button", { name: "Месяц", exact: true }).click();
  await expect(page.locator(".month-day")).toHaveCount(35);
  await page.getByRole("button", { name: "День", exact: true }).click();
  await expect(page.locator(".day-column")).toHaveCount(1);
  await page
    .getByRole("checkbox", { name: "Мой календарь", exact: true })
    .uncheck();
  await expect(
    page.locator(".calendar-event").filter({ hasText: "Развитие календаря" }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("all layouts, keyboard and pointer resize, persistence and drag swap", async ({
  page,
}) => {
  await page.goto("/");
  for (const [name, layout] of [
    ["Слева", "left"],
    ["Снизу", "bottom"],
    ["Сверху", "top"],
    ["Справа", "right"],
  ]) {
    await settings(page);
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("button", { name: "Готово", exact: true }).click();
    await expect(page.locator(".workspace")).toHaveAttribute(
      "data-layout",
      layout,
    );
    const before = Number(
      await page.getByRole("separator").getAttribute("aria-valuenow"),
    );
    await page.getByRole("separator").press("ArrowRight");
    await expect(page.getByRole("separator")).not.toHaveAttribute(
      "aria-valuenow",
      String(before),
    );
  }
  const separator = page.getByRole("separator");
  const before = await separator.getAttribute("aria-valuenow");
  const rect = (await separator.boundingBox())!;
  await page.mouse.move(rect.x + 3, rect.y + 60);
  await page.mouse.down();
  await page.mouse.move(rect.x - 100, rect.y + 60);
  await page.mouse.up();
  await expect(separator).not.toHaveAttribute("aria-valuenow", before!);
  const ratio = await separator.getAttribute("aria-valuenow");
  await page.reload();
  await expect(separator).toHaveAttribute("aria-valuenow", ratio!);
  await page
    .locator(".calendar-panel .panel-caption")
    .dragTo(page.locator(".assistant-panel .panel-caption"));
  await expect(page.locator(".workspace")).toHaveAttribute(
    "data-layout",
    "left",
  );
});
test("assistant previews a meeting and adds it only after confirmation", async ({
  page,
}) => {
  await page.goto("/");
  const originalCount = await page.locator(".calendar-event").count();
  await page
    .getByRole("button", { name: "Найди 30 минут для команды завтра" })
    .click();
  await expect(page.locator(".slot-list button")).toHaveCount(3);
  await page.locator(".slot-list button").first().click();
  await expect(
    page.getByText("Черновик встречи", { exact: true }),
  ).toBeVisible();
  expect(await page.locator(".calendar-event").count()).toBe(originalCount);
  await page
    .getByRole("button", { name: "Добавить в демо-календарь", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Обсуждение развития календаря/ }),
  ).toBeVisible();
  await expect(page.locator(".draft-card")).toHaveCount(0);
});
test("manual meeting validates conflicts and can be cancelled", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Новая встреча", exact: true })
    .click();
  await page.getByLabel("Название", { exact: true }).fill("Проверка прототипа");
  await page.getByLabel("Начало", { exact: true }).fill("11:30");
  await page
    .getByRole("button", { name: "Подтвердить и добавить демо-встречу" })
    .click();
  await expect(page.getByRole("alert")).toContainText("пересечение");
  await page.getByLabel("Начало", { exact: true }).fill("13:00");
  await page.getByRole("checkbox", { name: "Алексей", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "Анна", exact: true }).check();
  await page
    .getByRole("button", { name: "Подтвердить и добавить демо-встречу" })
    .click();
  await page.getByRole("button", { name: /^Проверка прототипа/ }).click();
  await expect(
    page.getByText("Организатор: Алексей · демо-участники"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Отменить демо-встречу" }).click();
  await page.getByRole("button", { name: "Да, убрать демо-встречу" }).click();
  await expect(
    page.getByRole("button", { name: /^Проверка прототипа/ }),
  ).toHaveCount(0);
});
test("error, denied, loading, empty and recovery states", async ({ page }) => {
  await page.goto("/");
  for (const [state, text] of [
    ["empty", "Пока никаких встреч"],
    ["denied", "Нет доступа к календарю"],
    ["error", "Не удалось загрузить календарь"],
  ]) {
    await settings(page);
    await page.getByLabel("Состояние календаря").selectOption(state);
    await page.getByRole("button", { name: "Готово", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: text, exact: true }),
    ).toBeVisible();
  }
  await page
    .getByRole("button", { name: "Найди 30 минут для команды завтра" })
    .click();
  await expect(page.getByText(/Календарь недоступен или пуст/)).toBeVisible();
  await expect(page.locator(".slot-list")).toHaveCount(0);
  await page.getByRole("button", { name: "Повторить загрузку" }).click();
  await expect(
    page.getByRole("heading", { name: "Загружаем календарь" }),
  ).toBeVisible();
  await expect(page.locator(".calendar-event")).toHaveCount(15);
});
for (const width of [320, 768, 1024, 1440])
  test(`responsive ${width}px and screenshot`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    if (width === 320) {
      const cal = (await page.locator(".calendar-container").boundingBox())!;
      const sep = (await page.getByRole("separator").boundingBox())!;
      const ai = (await page.locator(".assistant-container").boundingBox())!;
      expect(sep.y).toBeGreaterThanOrEqual(cal.y + cal.height - 1);
      expect(sep.y + sep.height).toBeLessThanOrEqual(ai.y + 1);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("textbox", { name: "Сообщение ассистенту" }),
    ).toBeVisible();
    if (width === 1440 || width === 320)
      await page.screenshot({
        path: `../.impeccable/review/${width === 1440 ? "desktop" : "mobile"}.png`,
        fullPage: true,
      });
  });

test("drag event and resize both edges", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Компоновка", exact: true }),
  ).toHaveCount(0);
  const event = page.getByRole("button", { name: /^Развитие календаря/ });
  let box = (await event.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 15);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + 79, { steps: 8 });
  await page.mouse.up();
  await event.click();
  await expect(page.getByText("12:30 — 13:30 · 60 мин")).toBeVisible();
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  box = (await event.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height - 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + box.height + 14, { steps: 5 });
  await page.mouse.up();
  box = (await event.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + 18, { steps: 5 });
  await page.mouse.up();
  await event.click();
  await expect(page.getByText("12:45 — 13:45 · 60 мин")).toBeVisible();
});

test("profile and settings have a single entry in the rail", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Настройки пространства" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Профиль", exact: true }).click();
  await expect(page.locator("#profile-popover")).toBeVisible();
  await expect(page.locator("#profile-popover")).toContainText("Алексей");
  await page.keyboard.press("Escape");
  await expect(page.locator("#profile-popover")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Профиль", exact: true }),
  ).toBeFocused();
});

test("full day and live current time in Almaty", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-28T07:10:00Z") });
  await page.goto("/");
  await expect(page.locator(".hours > span").first()).toHaveText("00:00");
  await expect(page.locator(".hours > span").last()).toHaveText("24:00");
  await expect(page.locator(".current-time-line")).toHaveText("12:10");
  await expect(page.locator(".current-time-line")).toHaveCSS(
    "background-color",
    "rgb(0, 0, 0)",
  );
  await page.clock.fastForward(60_000);
  await expect(page.locator(".current-time-line")).toHaveText("12:11");
});

test("event tooltip supports hover, keyboard and dismissal", async ({
  page,
}) => {
  await page.goto("/");
  const event = page.getByRole("button", { name: /^Развитие календаря/ });
  await event.hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("Организатор:");
  await expect(tooltip).toContainText("11:30–12:30");
  await tooltip.hover();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  await event.focus();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "О встрече" })).toBeVisible();
  await expect(tooltip).toHaveCount(0);
});
