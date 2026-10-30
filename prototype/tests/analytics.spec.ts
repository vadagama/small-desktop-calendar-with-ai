import { test, expect } from "@playwright/test";
const main = (p: import("@playwright/test").Page) =>
  p.locator(".calendar-container .insights-panel");
const side = (p: import("@playwright/test").Page) =>
  p.locator(".assistant-container .insights-panel");

test("compose dashboards and link periods", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Готовая раскладка").selectOption("overview");
  await expect(
    main(page).getByRole("heading", { name: "Обзор календарей", exact: true }),
  ).toBeVisible();
  const original = await side(page)
    .locator(".insights-period strong")
    .innerText();
  await main(page).getByLabel("Предыдущий период аналитики").click();
  await expect(side(page).locator(".insights-period strong")).toHaveText(
    original,
  );
  await page.getByRole("checkbox", { name: "Связать периоды" }).check();
  await main(page)
    .getByLabel("Период аналитики", { exact: true })
    .selectOption("month");
  await expect(
    side(page).getByLabel("Период аналитики", { exact: true }),
  ).toHaveValue("month");
  await main(page).getByLabel("Предыдущий период аналитики").click();
  await expect(side(page).locator(".insights-period strong")).toHaveText(
    await main(page).locator(".insights-period strong").innerText(),
  );
  await page.reload();
  await expect(page.getByLabel("Основная панель")).toHaveValue("calendars");
  await expect(page.getByLabel("Соседняя панель")).toHaveValue("organizers");
  await page.getByLabel("Соседняя панель").selectOption("closed");
  await expect(page.getByRole("separator")).toHaveCount(0);
  await page.getByLabel("Соседняя панель").selectOption("assistant");
  await expect(page.getByRole("separator")).toBeVisible();
});

test("graph drilldown, meeting card and assistant agree", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Готовая раскладка").selectOption("review");
  await expect(
    main(page).locator(".insights-metrics button").first(),
  ).toContainText("9");
  await main(page).locator(".chart-day").first().click();
  await expect(main(page).locator(".insights-detail")).toContainText(
    "Планы на неделю",
  );
  await main(page).locator(".insights-event").first().click();
  await expect(page.getByRole("dialog", { name: "О встрече" })).toBeVisible();
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await main(page)
    .getByRole("button", { name: "Количество", exact: true })
    .click();
  await expect(
    main(page).getByRole("button", { name: "Количество", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await main(page)
    .getByRole("button", { name: "Объяснить в ассистенте" })
    .click();
  await expect(page.locator(".messages")).toContainText("Выбрано: 26 октября");
  expect(errors).toEqual([]);
});

test("calendar filters and scopes have distinct totals and empty states", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Готовая раскладка").selectOption("review");
  await main(page).getByLabel("Источник аналитики").selectOption("calendars");
  await expect(
    main(page).locator(".insights-metrics button").first(),
  ).toContainText("12");
  for (const checkbox of await main(page).getByRole("checkbox").all())
    await checkbox.uncheck();
  await expect(
    main(page).getByRole("heading", { name: "Выберите календарь" }),
  ).toBeVisible();
  await expect(main(page).locator(".daily-chart")).toHaveCount(0);
  await main(page).getByRole("checkbox", { name: "Команды Small" }).check();
  await expect(
    main(page).locator(".insights-metrics button").first(),
  ).toContainText("5");
});

test("daily snapshot catches up after 07:00 once and survives reload", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-29T01:59:00Z") });
  await page.goto("/");
  await page.getByLabel("Готовая раскладка").selectOption("review");
  await expect(main(page).locator(".insights-freshness")).toContainText(
    "снимок 1",
  );
  await page.clock.fastForward(25 * 60 * 60_000 + 61_000);
  await page.clock.fastForward(1000);
  await expect(main(page).locator(".insights-freshness")).toContainText(
    "снимок 2",
  );
  await page.reload();
  await expect(main(page).locator(".insights-freshness")).toContainText(
    "снимок 2",
  );
  await page.clock.fastForward(60_000);
  await expect(main(page).locator(".insights-freshness")).toContainText(
    "снимок 2",
  );
});

test("failed refresh retains previous snapshot and recovers", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Готовая раскладка").selectOption("review");
  await page.getByRole("button", { name: "Настройки пространства" }).click();
  await page.getByLabel("Состояние календаря").selectOption("error");
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await main(page).getByRole("button", { name: "Обновить аналитику" }).click();
  await expect(main(page).getByRole("alert")).toContainText(
    "последний успешный снимок",
  );
  await expect(
    main(page).locator(".insights-metrics button").first(),
  ).toContainText("9");
  await expect(main(page).locator(".insights-freshness")).toContainText(
    "снимок 1",
  );
  await page.getByRole("button", { name: "Настройки пространства" }).click();
  await page.getByLabel("Состояние календаря").selectOption("ready");
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await main(page)
    .getByRole("button", { name: "Повторить обновление" })
    .click();
  await expect(main(page).locator(".insights-freshness")).toContainText(
    "снимок 2",
  );
  await expect(main(page).getByRole("alert")).toHaveCount(0);
});

test("AI demo cites events and clears old report when period changes", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Основная панель").selectOption("report");
  await main(page)
    .getByRole("button", { name: "Сформировать демо-обзор" })
    .click();
  await expect(main(page).locator(".report-result")).toContainText("9 встреч");
  await main(page)
    .getByRole("button", { name: "Показать встречи-основания" })
    .click();
  await expect(main(page).locator(".insights-detail")).toContainText(
    "Основание:",
  );
  await main(page).getByLabel("Предыдущий период аналитики").click();
  await expect(main(page).locator(".report-result")).toHaveCount(0);
});

for (const width of [320, 768, 1024, 1440])
  test(`analytics responsive ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByLabel("Соседняя панель").selectOption("organizers");
    for (const kind of [
      "load",
      "organizers",
      "rhythm",
      "calendars",
      "report",
    ]) {
      await page.getByLabel("Основная панель").selectOption(kind);
      await expect(main(page).locator("h2")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    expect(errors).toEqual([]);
  });

test("periods beyond fixture coverage are marked incomplete", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Основная панель").selectOption("load");
  await main(page)
    .getByLabel("Период аналитики", { exact: true })
    .selectOption("month");
  await main(page).getByLabel("Следующий период аналитики").click();
  await expect(main(page).locator(".insights-warning")).toContainText(
    "Неполное покрытие периода",
  );
  await expect(main(page).locator(".insights-metrics")).toContainText(
    "Сравнение недоступно",
  );
  await main(page).getByLabel("Следующий период аналитики").click();
  await expect(
    main(page).getByRole("heading", { name: "Нет данных за выбранный период" }),
  ).toBeVisible();
});

test("calendar dashboard defaults to all visible events and links back to calendar", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Готовая раскладка").selectOption("review");
  await page.getByLabel("Готовая раскладка").selectOption("overview");
  await expect(main(page).getByLabel("Источник аналитики")).toHaveValue(
    "calendars",
  );
  await main(page).locator(".calendar-breakdown > button").first().click();
  await main(page)
    .getByRole("button", { name: /^Открыть в календаре:/ })
    .first()
    .click();
  await expect(page.getByLabel("Основная панель")).toHaveValue("calendar");
  await expect(
    page.locator(".calendar-event").filter({ hasText: "Дизайн-ревью" }),
  ).toBeVisible();
});

test("opening an already stale stored snapshot recovers in StrictMode", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-28T03:00:00Z") });
  await page.goto("/");
  await page.getByLabel("Готовая раскладка").selectOption("review");
  await expect(main(page).locator(".insights-freshness")).toContainText(
    "снимок 1",
  );
  await page.clock.setFixedTime(new Date("2026-10-29T03:00:00Z"));
  await page.reload();
  await expect(main(page).locator(".insights-freshness")).toContainText(
    "снимок 2",
  );
  await main(page).getByRole("button", { name: "Обновить аналитику" }).click();
  await expect(main(page).locator(".insights-freshness")).toContainText(
    "снимок 3",
  );
});

test("calendar series retain their established colors when filtering", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Основная панель").selectOption("calendars");
  const teamBar = main(page)
    .locator(".calendar-breakdown > button")
    .filter({ hasText: "Команды Small" })
    .locator(".calendar-bar i");
  const before = await teamBar.evaluate(
    (e) => getComputedStyle(e).backgroundColor,
  );
  await main(page)
    .getByRole("checkbox", { name: "Мой календарь", exact: true })
    .uncheck();
  await expect(teamBar).toHaveCSS("background-color", before);
  const filterColor = await page
    .locator(".custom-check.calendar-team")
    .evaluate((e) => getComputedStyle(e).borderColor);
  await expect(teamBar).toHaveCSS("background-color", filterColor);
});
