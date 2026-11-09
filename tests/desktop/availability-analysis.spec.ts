import { _electron, test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createServer as createDesignServer } from "vite";
import { once } from "node:events";
import { mockSmall } from "./fixtures/small-api.js";

test("prompt automatically opens availability dashboard, picker and draft remain safe", async () => {
  test.setTimeout(60000);
  const designServer = await createDesignServer({
    root: join(process.cwd(), "prototype"),
    configFile: join(process.cwd(), "prototype/vite.config.ts"),
    server: { port: 0, host: "127.0.0.1" },
  });
  await designServer.listen();
  const designUrl = designServer.resolvedUrls!.local[0]!;
  const directory = await mkdtemp(join(tmpdir(), "small-availability-"));
  const steps = [
    { name: "searchPeople", input: { query: "Тест", page: 2 } },
    { name: "selectParticipants", input: { participantIds: ["synthetic-c"] } },
    {
      name: "showAvailabilityAnalysis",
      input: {
        participantIds: ["synthetic-c"],
        date: "2099-11-10",
        period: "day",
        durationMinutes: 60,
      },
    },
  ];
  let followupContextSeen = false;
  let organizerContextSeen = false;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const messages = JSON.parse(raw).messages as {
      role: string;
      content?: unknown;
    }[];
    const last = messages.findLastIndex((m) => m.role === "user");
    // assistantMemory recall is performed before the SDK loop, not a model message.
    const index = messages
      .slice(last + 1)
      .filter((m) => m.role === "tool").length;
    const lastPrompt =
      typeof messages[last]?.content === "string"
        ? (messages[last]!.content as string)
        : JSON.stringify(messages[last]?.content ?? "");
    const followup = lastPrompt.includes("Теперь только 30 минут");
    const contextMessage = messages.findLast(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content.includes("Текущий дашборд доступности"),
    );
    const emptyFollowup = lastPrompt.includes("Проверка состава организатора");
    if (emptyFollowup && typeof contextMessage?.content === "string") {
      const marker = contextMessage.content.indexOf(
        "Текущий дашборд доступности",
      );
      const context = JSON.parse(
        contextMessage.content
          .slice(contextMessage.content.indexOf("{", marker))
          .split("\n\n")[0]!,
      );
      organizerContextSeen =
        JSON.stringify(context.query.participantIds) ===
        JSON.stringify(["synthetic-organizer"]);
    }
    let contextIds = ["synthetic-c"];
    if (followup && typeof contextMessage?.content === "string") {
      const marker = contextMessage.content.indexOf(
        "Текущий дашборд доступности",
      );
      const parsed = JSON.parse(
        contextMessage.content
          .slice(contextMessage.content.indexOf("{", marker))
          .split("\n\n")[0]!,
      );
      contextIds = parsed.query.participantIds;
      followupContextSeen =
        contextIds.includes("synthetic-a") &&
        contextIds.includes("synthetic-c");
    }
    const step = emptyFollowup
      ? undefined
      : followup
        ? index === 0
          ? {
              name: "showAvailabilityAnalysis",
              input: {
                participantIds: contextIds,
                date: "2099-11-10",
                period: "day",
                durationMinutes: 30,
              },
            }
          : undefined
        : steps[index];
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const delta = step
      ? {
          tool_calls: [
            {
              index: 0,
              id: `availability-${index}`,
              type: "function",
              function: {
                name: step.name,
                arguments: JSON.stringify(step.input),
              },
            },
          ],
        }
      : { content: "Открыл свободные слоты." };
    res.end(
      `data: ${JSON.stringify({ id: "synthetic", choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "synthetic", choices: [{ index: 0, delta: {}, finish_reason: step ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No address");
  const app = await _electron.launch({
    args: [
      ".",
      `--user-data-dir=${directory}`,
      "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
    ],
    env: { ...process.env, SMALL_TEST_SYNC_INTERVAL_MS: "600000" },
  });
  const diagnosticEvents: Record<string, unknown>[] = [];
  let diagnosticBuffer = "";
  app.process().stdout?.on("data", (chunk) => {
    diagnosticBuffer += String(chunk);
    const lines = diagnosticBuffer.split("\n");
    diagnosticBuffer = lines.pop() ?? "";
    for (const line of lines)
      if (line.startsWith('{"event":"availability_read"'))
        diagnosticEvents.push(JSON.parse(line));
  });
  try {
    await mockSmall(app, "2099-11-10");
    await app.evaluate(() => {
      (
        globalThis as typeof globalThis & { syntheticAvailableSlots: unknown }
      ).syntheticAvailableSlots = [
        {
          start: "2099-11-10T09:00:00+05:00",
          end: "2099-11-10T09:01:00+05:00",
        },
      ];
    });
    const page = await app.firstWindow();
    // Hidden macOS windows may inherit a smaller CI display; fix the viewport for desktop typography assertions.
    await page.setViewportSize({ width: 1440, height: 960 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
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
    await page
      .getByRole("button", { name: "Настройки модели", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Настройки модели" });
    await dialog
      .getByLabel("Профиль", { exact: true })
      .selectOption("personal");
    await dialog
      .getByLabel("Base URL")
      .fill(`http://127.0.0.1:${address.port}/v1`);
    await dialog.getByLabel("Model ID").fill("synthetic-availability");
    await dialog.getByLabel("API-ключ", { exact: true }).fill("synthetic-key");
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(dialog).toHaveCount(0);
    await page.evaluate(async () => {
      await new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      );
    });
    await page
      .getByRole("textbox", { name: "Сообщение ассистенту" })
      .fill(
        "Найди свободное время для встречи с Синтетическим участником 10 ноября 2099 на час",
      );
    await page
      .getByRole("textbox", { name: "Сообщение ассистенту" })
      .press("Tab");
    await expect(
      page.getByRole("button", { name: "Отправить сообщение" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Отправить сообщение" }).click();
    const panel = page.locator(".availability-panel");
    await expect(
      panel.getByRole("button", { name: "Убрать employee-a", exact: true }),
    ).toHaveCount(0);
    await expect(panel).toBeVisible();
    const availabilityResult = page
      .locator(".availability-tool-result")
      .first();
    await expect(
      availabilityResult.locator(":scope > details > summary"),
    ).toHaveText("Свободные слоты · Обработано");
    const resultCard = availabilityResult.locator(
      ":scope > details + .availability-result-card",
    );
    await expect(
      resultCard.getByRole("button", {
        name: "Открыть свободные слоты",
        exact: true,
      }),
    ).toBeVisible();
    await expect(resultCard.locator(".assistant-markdown")).toContainText(
      "Открыл свободные слоты.",
    );
    await expect(resultCard.locator(".assistant-tool-detail")).toHaveCount(0);
    await expect(
      page.getByText("Открыл свободные слоты.", { exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("region", { name: "Выбор календарей", exact: true }),
    ).toHaveCount(0);
    await expect(panel.locator(".demo-toolbar")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Переговорные", exact: true }),
    ).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "Сегодня", exact: true }),
    ).toHaveCount(0);
    await expect(panel.locator(".analysis-period-heading h2")).toHaveText(
      "10 ноября",
    );
    await expect(panel.locator(".analysis-period-heading h2")).toHaveCSS(
      "font-size",
      "16px",
    );
    await expect(
      page.getByRole("button", { name: "10 ноября 2099 г.", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(panel.locator(".availability-grid tbody")).toHaveCount(1);
    await expect(panel.locator("button.slot.common").first()).toBeEnabled();
    await expect(panel.locator(".demo-hour-axis span")).toHaveCount(25);
    await expect(panel.locator("button.slot.common")).toHaveText([
      "09:00–13:00",
      "14:00–18:00",
      "09:00–13:00",
      "14:00–18:00",
    ]);
    await expect(panel.locator(".slot.unknown")).toHaveCount(0);
    await expect.poll(() => diagnosticEvents.length).toBeGreaterThan(0);
    expect(Object.keys(diagnosticEvents[0]!).sort()).toEqual([
      "elapsedMs",
      "entryPoint",
      "event",
      "outcome",
      "requestId",
    ]);
    expect(diagnosticEvents[0]!.outcome).toBe("success");
    await expect(panel.locator(".demo-person-name")).toHaveText([
      "employee-a",
      "Другой сотрудник",
    ]);
    await app.evaluate(() => {
      (
        globalThis as typeof globalThis & {
          syntheticAvailabilityStatus: number;
        }
      ).syntheticAvailabilityStatus = 503;
    });
    await page.getByRole("button", { name: "Обновить", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("Данные неактуальны");
    await expect(panel.locator("button.slot.common").first()).toBeDisabled();
    await app.evaluate(() => {
      (
        globalThis as typeof globalThis & {
          syntheticAvailabilityStatus: number;
        }
      ).syntheticAvailabilityStatus = 0;
    });
    await panel.getByRole("button", { name: "Повторить", exact: true }).click();
    await expect(panel.locator("button.slot.common").first()).toBeEnabled();
    await panel.locator("button.slot.common").first().click();
    const draft = page.getByRole("dialog", {
      name: "Новое событие",
      exact: true,
    });
    await expect(draft).toBeVisible();
    await expect(draft.getByLabel("Дата", { exact: true })).toHaveValue(
      "2099-11-10",
    );
    await expect(draft.getByLabel("Начало", { exact: true })).toHaveValue(
      "09:00",
    );
    await expect(draft.getByLabel("Окончание", { exact: true })).toHaveValue(
      "10:00",
    );
    await expect(draft).toContainText("Другой сотрудник");
    await expect(draft).toContainText("employee-a");
    await expect(
      panel.getByRole("button", { name: "В черновик встречи", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: "test-results/desktop/availability-selection.png",
    });
    await page.getByRole("button", { name: "Закрыть новое событие" }).click();
    const chips = panel.locator(".meeting-chips > span");
    const chipStyles = await chips.evaluateAll((items) =>
      items.map((e) => ({
        height: e.getBoundingClientRect().height,
        padding: getComputedStyle(e).padding,
        font: getComputedStyle(e).fontSize,
      })),
    );
    expect(chipStyles[0]).toEqual(chipStyles[1]);

    await panel.getByRole("textbox", { name: "Поиск участников" }).fill("Тест");
    await expect(
      panel.getByRole("button", { name: /Тестовый сотрудник/ }).first(),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/desktop/availability-search.png",
    });
    await panel
      .getByRole("button", { name: /Тестовый сотрудник/ })
      .first()
      .click();
    await expect(panel.locator(".demo-person-name")).toHaveCount(3);
    await app.evaluate(() => {
      (
        globalThis as typeof globalThis & {
          syntheticAvailabilityByDay: Record<
            string,
            {
              free: { start: string; end: string }[];
              busy: { start: string; end: string }[];
            }
          >;
        }
      ).syntheticAvailabilityByDay = {
        "synthetic-organizer:2099-11-10": {
          free: [],
          busy: [
            {
              start: "2099-11-10T09:00:00+05:00",
              end: "2099-11-10T10:00:00+05:00",
            },
          ],
        },
        "synthetic-a:2099-11-10": {
          free: [],
          busy: [
            {
              start: "2099-11-10T09:00:00+05:00",
              end: "2099-11-10T11:00:00+05:00",
            },
            {
              start: "2099-11-10T12:00:00+05:00",
              end: "2099-11-10T13:00:00+05:00",
            },
          ],
        },
      };
    });
    await page.getByRole("button", { name: "Обновить", exact: true }).click();
    await expect(panel).toHaveAttribute("aria-busy", "false");
    const guestRow = panel
      .locator("tbody tr")
      .filter({ hasText: "Другой сотрудник" });
    await expect(
      guestRow.locator("button.slot.free").filter({ hasText: "09:00" }),
    ).toHaveCount(0);
    await guestRow
      .locator("button.slot.free")
      .filter({ hasText: "12:00" })
      .click();
    await expect(draft).toBeVisible();
    await expect(draft.getByLabel("Начало", { exact: true })).toHaveValue(
      "12:00",
    );
    await expect(draft.getByLabel("Окончание", { exact: true })).toHaveValue(
      "13:00",
    );
    await expect(draft).toContainText("Другой сотрудник");
    await expect(draft).not.toContainText("Тестовый сотрудник");
    await page.getByRole("button", { name: "Закрыть новое событие" }).click();
    const commonButtons = panel.locator("button.slot.common");
    const commonCount = await commonButtons.count();
    for (let index = 0; index < commonCount; index++) {
      await commonButtons.nth(index).click();
      await expect(draft).toBeVisible();
      await page.getByRole("button", { name: "Закрыть новое событие" }).click();
    }
    await app.evaluate(() => {
      (
        globalThis as typeof globalThis & {
          syntheticAvailabilityByDay: unknown;
        }
      ).syntheticAvailabilityByDay = {};
    });
    await page.getByRole("button", { name: "Обновить", exact: true }).click();
    await expect(panel).toHaveAttribute("aria-busy", "false");

    await expect(
      panel.getByRole("region", { name: "Выбранное окно" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Отправить сообщение" }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Сообщение ассистенту" })
      .fill("Теперь только 30 минут");
    await page
      .getByRole("textbox", { name: "Сообщение ассистенту" })
      .press("Tab");
    await page.getByRole("button", { name: "Отправить сообщение" }).click();
    await expect(panel.getByLabel("Длительность встречи")).toHaveValue("30");
    expect(followupContextSeen).toBe(true);
    await panel
      .getByRole("button", { name: "Убрать Тестовый сотрудник" })
      .click();
    await expect(panel.locator(".demo-person-name")).toHaveCount(2);
    await panel.getByLabel("Длительность встречи").selectOption("60");
    await expect(
      page.locator(".dv-tab").filter({ hasText: "Свободные слоты" }),
    ).toHaveCount(0);
    const railSlots = page
      .getByRole("navigation", { name: "Разделы Small" })
      .getByRole("button", { name: "Свободные слоты", exact: true });
    await expect(railSlots).toHaveClass("active");
    await page
      .getByRole("button", { name: "Показать календари", exact: true })
      .click();
    await expect(panel).toBeHidden();
    await railSlots.click();
    await expect(panel).toBeVisible();
    await expect(panel.locator(".demo-person-name")).toHaveCount(2);
    await expect(panel.getByLabel("Длительность встречи")).toHaveValue("60");
    await expect(
      panel.getByText("Проверяем доступность сотрудников…", { exact: true }),
    ).toHaveCount(0);
    await expect(panel.locator("button.slot.common").first()).toBeEnabled();
    await page
      .getByRole("button", { name: "11 ноября 2099 г.", exact: true })
      .click();
    await expect(panel.locator(".demo-date-heading")).toContainText(
      "11 ноября",
    );
    await expect(panel.locator(".demo-person-name")).toHaveCount(2);
    await panel
      .getByLabel("Период доступности", { exact: true })
      .selectOption("week");
    await expect(panel.locator(".availability-grid tbody")).toHaveCount(5);
    await expect(panel.locator(".analysis-period-heading h2")).toHaveText(
      "9 ноября — 15 ноября",
    );
    await panel
      .getByRole("button", {
        name: "Следующий период доступности",
        exact: true,
      })
      .click();
    await expect(panel.locator(".analysis-period-heading h2")).toHaveText(
      "16 ноября — 22 ноября",
    );
    await expect(
      page.getByRole("button", { name: "18 ноября 2099 г.", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await panel
      .getByRole("button", {
        name: "Предыдущий период доступности",
        exact: true,
      })
      .click();
    await expect(panel.locator(".analysis-period-heading h2")).toHaveText(
      "9 ноября — 15 ноября",
    );
    await panel
      .getByLabel("Период доступности", { exact: true })
      .selectOption("day");
    await expect(panel.locator(".analysis-period-heading h2")).toHaveText(
      "11 ноября",
    );
    await expect(panel.locator(".availability-grid tbody")).toHaveCount(1);
    await page
      .getByRole("button", { name: "10 ноября 2099 г.", exact: true })
      .click();
    await expect(panel.locator(".demo-date-heading")).toContainText(
      "10 ноября",
    );
    await expect(panel.locator("button.slot.common").first()).toBeEnabled();
    await expect(panel.locator(".demo-person-name").first()).toHaveCSS(
      "font-size",
      "13px",
    );
    await page.screenshot({
      path: "test-results/desktop/availability-analysis.png",
    });
    await app.evaluate(() => {
      (
        globalThis as typeof globalThis & { syntheticAvailableSlots: unknown }
      ).syntheticAvailableSlots = [
        {
          start: "2099-11-10T09:00:00+05:00",
          end: "2099-11-10T10:00:00+05:00",
        },
      ];
    });
    await app.evaluate(() => {
      const state = globalThis as typeof globalThis & {
        syntheticAvailabilityDelayMs: number;
        syntheticAvailabilityCompleted: number;
      };
      state.syntheticAvailabilityDelayMs = 500;
      state.syntheticAvailabilityCompleted = 0;
    });
    const gridBeforeOpening = await panel
      .locator(".demo-grid-scroll")
      .boundingBox();
    await panel.locator("button.slot.common").first().click();
    await expect(panel).toHaveAttribute("aria-busy", "true");
    await expect(panel.locator(".demo-selection")).toHaveCount(0);
    expect(await panel.locator(".demo-grid-scroll").boundingBox()).toEqual(
      gridBeforeOpening,
    );
    await panel.locator(".demo-grid-scroll").press("Escape");
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                syntheticAvailabilityCompleted: number;
              }
            ).syntheticAvailabilityCompleted,
        ),
      )
      .toBeGreaterThanOrEqual(1);
    await page.evaluate(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    await expect(
      page.getByRole("dialog", { name: "Новое событие" }),
    ).toHaveCount(0);
    await app.evaluate(() => {
      (
        globalThis as typeof globalThis & {
          syntheticAvailabilityDelayMs: number;
        }
      ).syntheticAvailabilityDelayMs = 0;
    });
    await panel.locator("button.slot.common").first().click();
    await expect(
      page.getByRole("dialog", { name: "Новое событие" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Закрыть новое событие" }).click();
    expect(
      await app.evaluate(
        () =>
          (globalThis as typeof globalThis & { syntheticMeetingWrites: number })
            .syntheticMeetingWrites,
      ),
    ).toBe(0);
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((w) => w.isVisible()),
      ),
    ).toBe(false);
    await page
      .getByRole("button", { name: "Новый диалог", exact: true })
      .click();
    await expect(page.locator(".availability-panel")).toHaveCount(0);
    // Synthetic typed events exercise panel states independently of model semantics.
    const open = async (ids: string[], period = "week") =>
      app.evaluate(
        ({ BrowserWindow }, { ids, period }) => {
          BrowserWindow.getAllWindows()[0]!.webContents.send(
            "calendar:availability-open",
            {
              kind: "availability-analysis",
              query: {
                accountId: "employee-a",
                participantIds: ids,
                date: "2099-11-10",
                period,
                durationMinutes: 60,
                includeWeekends: false,
                bufferMinutes: 0,
                timeFrom: "09:00",
                timeTo: "18:00",
              },
              people: ids.map((participantId, i) => ({
                participantId,
                name: `Синтетический сотрудник с длинным именем ${i + 1}`,
                position: "Тестовая должность",
              })),
            },
          );
        },
        { ids, period },
      );
    await open(Array.from({ length: 19 }, (_, i) => `synthetic-${i}`));
    await expect(panel.locator(".demo-person-name")).toHaveCount(100);
    await expect(
      panel.getByText("Проверяем доступность сотрудников…", { exact: true }),
    ).toHaveCount(0);
    await panel.getByLabel("Выходные", { exact: true }).check();
    await expect(panel.locator(".demo-person-name")).toHaveCount(140);
    const grid = panel.locator(".demo-grid-scroll");
    await grid.evaluate((e) => {
      e.scrollLeft = 700;
    });
    const before = await grid.evaluate((e) => e.scrollLeft);
    await panel
      .getByRole("button", { name: "Общие окна", exact: true })
      .click();
    await expect(panel.locator(".demo-person-name")).toHaveCount(7);
    expect(await grid.evaluate((e) => e.scrollLeft)).toBe(before);
    await panel
      .getByRole("button", { name: "Сотрудники", exact: true })
      .click();
    await page.setViewportSize({ width: 1900, height: 1100 });
    for (const width of [320, 768, 1024, 1440]) {
      await panel.evaluate((e, width) => {
        e.style.width = `${width}px`;
        e.style.height = "900px";
      }, width);
      await grid.evaluate((e) => {
        e.scrollLeft = 0;
        e.scrollTop = 0;
      });
      const first = await panel
        .locator(".demo-person-heading")
        .first()
        .boundingBox();
      await grid.evaluate((e) => {
        e.scrollLeft = e.scrollWidth;
      });
      const scrolled = await panel
        .locator(".demo-person-heading")
        .first()
        .boundingBox();
      expect(Math.abs(first!.x - scrolled!.x)).toBeLessThan(1);
      expect(Math.round(first!.width)).toBe(184);
      expect(await grid.evaluate((e) => e.clientHeight)).toBeGreaterThan(80);
      await page.screenshot({
        path: `test-results/desktop/availability-${width}.png`,
      });
    }
    await open(["unknown"], "day");
    await expect(
      panel.getByText(/Данные части сотрудников неполные/),
    ).toBeVisible();
    await expect(panel.locator("button.slot.common")).toHaveCount(0);
    await page.screenshot({
      path: "test-results/desktop/availability-partial.png",
    });
    await open(["denied"], "day");
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(panel.locator("button.slot.common")).toHaveCount(0);
    await page.screenshot({
      path: "test-results/desktop/availability-error.png",
    });
    await panel.getByRole("button", { name: /Убрать Синтетический/ }).click();
    await expect(panel.locator(".demo-person-name")).toHaveText(["employee-a"]);
    await expect(
      panel.getByRole("button", { name: "Убрать employee-a", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("textbox", { name: "Сообщение ассистенту" })
      .fill("Проверка состава организатора");
    await page
      .getByRole("textbox", { name: "Сообщение ассистенту" })
      .press("Tab");
    await page.getByRole("button", { name: "Отправить сообщение" }).click();
    await expect.poll(() => organizerContextSeen).toBe(true);
    // The same fictitious occupancy as the approved prototype, next week.
    await app.evaluate(({ BrowserWindow }) => {
      const people = [
        {
          participantId: "demo-anna",
          name: "Анна Смирнова",
          position: "Продукт",
        },
        {
          participantId: "demo-ivan",
          name: "Иван Волков",
          position: "Разработка",
        },
        {
          participantId: "demo-maria",
          name: "Мария Белова",
          position: "Дизайн",
        },
      ];
      const matrix: Record<
        string,
        {
          free: { start: string; end: string }[];
          busy: { start: string; end: string }[];
        }
      > = {};
      for (let day = 0; day < 5; day++)
        for (let person = 0; person < 3; person++) {
          const date = `2026-11-${16 + day}`;
          const row = {
            free: [] as { start: string; end: string }[],
            busy: [] as { start: string; end: string }[],
          };
          const at = (index: number) =>
            `${date}T${String(9 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}:00+05:00`;
          for (let index = 0; index < 18; index++)
            row[
              index === 6 ||
              index === 7 ||
              (index + day * 3 + person * 2 + 1) % 11 < 3
                ? "busy"
                : "free"
            ].push({ start: at(index), end: at(index + 1) });
          matrix[`${people[person]!.participantId}:${date}`] = row;
        }
      (
        globalThis as typeof globalThis & {
          syntheticAvailabilityByDay: typeof matrix;
        }
      ).syntheticAvailabilityByDay = matrix;
      BrowserWindow.getAllWindows()[0]!.webContents.send(
        "calendar:availability-open",
        {
          kind: "availability-analysis",
          query: {
            accountId: "employee-a",
            participantIds: people.map((p) => p.participantId),
            date: "2026-11-16",
            period: "week",
            durationMinutes: 60,
            includeWeekends: false,
            bufferMinutes: 0,
            timeFrom: "09:00",
            timeTo: "18:00",
          },
          people,
        },
      );
    });
    await expect(panel.locator(".demo-person-name")).toHaveCount(20);
    await expect(
      panel.getByText("Проверяем доступность сотрудников…", { exact: true }),
    ).toHaveCount(0);
    await panel.evaluate((e) => {
      e.style.width = "1000px";
      e.style.height = "808px";
    });
    await panel.locator(".demo-grid-scroll").evaluate((e) => {
      e.scrollLeft = 512;
    });
    const metrics = async () =>
      page.evaluate(() => {
        const r = (selector: string) =>
          document.querySelector(selector)!.getBoundingClientRect();
        return {
          name: r(".demo-person-heading").width,
          row: r(".demo-person-heading").height,
          date: r(".demo-date-heading").height,
          track: r(".demo-day-track").width,
          common: getComputedStyle(document.querySelector(".slot.common")!)
            .backgroundColor,
        };
      });
    const actualMetrics = await metrics();
    await panel.screenshot({
      path: "test-results/desktop/availability-comparison-app.png",
    });
    expect(errors).toEqual([]);
    // Existing local design artifact; no remote navigation or new visible window.
    await page.goto(`${designUrl}availability.html?v=horizontal`);
    await page
      .getByRole("button", { name: "Следующая неделя", exact: true })
      .click();
    const prototype = page.locator("#availability-view");
    await prototype.evaluate((e) => {
      e.style.width = "1000px";
      e.style.height = "808px";
      e.style.flex = "none";
    });
    await page.locator(".demo-grid-scroll").evaluate((e) => {
      e.scrollLeft = 512;
    });
    expect(await metrics()).toEqual(actualMetrics);
    await prototype.screenshot({
      path: "test-results/desktop/availability-comparison-prototype.png",
    });
  } finally {
    await app.close();
    server.close();
    await designServer.close();
    await rm(directory, { recursive: true, force: true });
  }
});
