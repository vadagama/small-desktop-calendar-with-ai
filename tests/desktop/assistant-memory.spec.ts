import { _electron, test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { mockSmall } from "./fixtures/small-api.js";
import { calendarToday } from "../../src/shared/calendar-time.js";

test("memory UI persists preferences, entries, groups and presets; chat writes require confirmation", async () => {
  test.setTimeout(90000);
  const userData = await mkdtemp(join(tmpdir(), "small-memory-desktop-"));
  let plan: { name: string; input: unknown }[] | undefined;
  let responseText = "Проверьте карточку и подтвердите действие кнопкой.";
  const api = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    const lastUser = body.messages.findLastIndex(
      (m: { role: string }) => m.role === "user",
    );
    const defaultSteps = [
      {
        name: "assistantMemory",
        input: {
          action: "propose",
          change: {
            action: "entry",
            id: "invented-id",
            text: "Повестки оформлять коротким списком.",
          },
        },
      },
      {
        name: "assistantMemory",
        input: {
          action: "propose",
          change: {
            action: "entry",
            text: "Повестки оформлять коротким списком.",
          },
        },
      },
    ];
    const steps =
      plan ??
      defaultSteps.flatMap((step) => [
        { name: "assistantMemory", input: { action: "recall" } },
        {
          name: "assistantMemory",
          input: { action: "review", change: step.input.change, questions: [] },
        },
        step,
      ]);
    const toolCount = body.messages
      .slice(lastUser + 1)
      .filter((m: { role: string }) => m.role === "tool").length;
    const step = steps[toolCount];
    const hasTool = !step;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const delta = step
      ? {
          tool_calls: [
            {
              index: 0,
              id: `memory-test-call-${toolCount}`,
              type: "function",
              function: {
                name: step.name,
                arguments: JSON.stringify(step.input),
              },
            },
          ],
        }
      : { content: responseText };
    for (const chunk of [
      { id: "test", choices: [{ index: 0, delta, finish_reason: null }] },
      {
        id: "test",
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: hasTool ? "stop" : "tool_calls",
          },
        ],
      },
    ])
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const address = api.address();
  if (!address || typeof address === "string") throw Error("address");
  const launch = () =>
    _electron.launch({
      args: [
        ".",
        `--user-data-dir=${userData}`,
        "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
      ],
      env: { ...process.env, SMALL_TEST_SYNC_INTERVAL_MS: "600000" },
    });
  let app = await launch();
  try {
    await mockSmall(app, calendarToday());
    let page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page
      .getByRole("button", { name: "Память ассистента", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Память", exact: true }),
    ).toContainText("Введите логин и пароль");
    await page.keyboard.press("Escape");
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
      .getByRole("button", { name: "Память ассистента", exact: true })
      .click();
    let memory = page.getByRole("dialog", { name: "Память", exact: true });
    expect(
      await memory.locator("h2").evaluate((e) => getComputedStyle(e).fontSize),
    ).toBe("18px");
    await memory.getByRole("button", { name: "Изменить предпочтения" }).click();
    await memory.getByLabel("Длительность, минут").fill("45");
    expect(
      await memory
        .getByLabel("Длительность, минут")
        .evaluate((e) => getComputedStyle(e).fontSize),
    ).toBe("14px");
    await memory.getByLabel("Перерыв, минут").fill("15");
    await memory.getByLabel("Предлагать время с").fill("10:00");
    await memory
      .getByRole("button", { name: "Сохранить предпочтения" })
      .click();
    await expect(memory).toContainText("45 минут");
    await memory
      .getByRole("button", { name: "Добавить запись", exact: true })
      .click();
    await memory
      .getByLabel("Текст записи")
      .fill("Тестовый проект — внутренний календарь.");
    await memory
      .getByRole("button", { name: "Сохранить запись", exact: true })
      .click();
    await expect(memory).toContainText(
      "Тестовый проект — внутренний календарь.",
    );
    expect(
      await memory
        .locator(".memory-entry-content p")
        .first()
        .evaluate((e) => getComputedStyle(e).fontSize),
    ).toBe("13px");
    await memory
      .getByRole("button", { name: "Добавить группу", exact: true })
      .click();
    await memory
      .getByLabel("Название группы", { exact: true })
      .fill("Тестовая команда");
    await memory.getByLabel("Поиск участников").fill("Тест");
    await memory
      .getByRole("button", { name: "Найти сотрудников", exact: true })
      .click();
    await memory
      .locator(".meeting-people-results input[type=checkbox]")
      .first()
      .check();
    await memory
      .getByRole("button", { name: "Сохранить группу", exact: true })
      .click();
    await expect(memory.locator(".memory-entry-content strong")).toContainText([
      "Тестовая команда",
    ]);
    await memory
      .getByRole("button", { name: "Добавить формат", exact: true })
      .click();
    await memory
      .getByLabel("Название формата", { exact: true })
      .fill("Наш синк");
    await memory
      .getByLabel("Название встречи", { exact: true })
      .fill("Тестовый синк");
    const state = await page.evaluate(() => window.smallDesktop.memory.read());
    if (!state.ok) throw Error(state.error);
    await memory
      .getByLabel("Группа участников", { exact: true })
      .selectOption(state.state.groups[0]!.id);
    await memory
      .getByRole("button", { name: "Сохранить формат", exact: true })
      .click();
    await expect(memory).toContainText("Наш синк");
    await page.screenshot({
      path: "test-results/desktop/assistant-memory.png",
    });
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Настройки модели", exact: true })
      .click();
    const model = page.getByRole("dialog", { name: "Настройки модели" });
    await model.getByLabel("Профиль", { exact: true }).selectOption("personal");
    await model
      .getByLabel("Base URL")
      .fill(`http://127.0.0.1:${address.port}/v1`);
    await model.getByLabel("Model ID").fill("synthetic-memory");
    await model.getByLabel("API-ключ", { exact: true }).fill("synthetic-key");
    await model.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(model).toHaveCount(0);
    await page
      .getByLabel("Сообщение ассистенту")
      .fill("Запомни: повестки оформлять коротким списком.");
    await page
      .getByRole("button", { name: "Отправить сообщение", exact: true })
      .click();
    const confirm = page.getByRole("button", {
      name: "Подтвердить изменение памяти",
      exact: true,
    });
    await expect(confirm).toBeEnabled();
    await expect(
      page.getByRole("alert").filter({ hasText: "Запись с таким id" }),
    ).toContainText("повторите propose без id");
    await expect(page.locator(".memory-proposal")).toHaveCount(1);
    const failedContext = page
      .locator("details.assistant-tool-detail")
      .filter({ hasText: "invented-id" })
      .filter({ has: page.locator("summary", { hasText: "Ошибка" }) });
    await expect(failedContext.locator("summary")).toHaveText(
      "Память · Ошибка",
    );
    await failedContext.locator("summary").click();
    await expect(failedContext.locator("pre").last()).toContainText(
      "повторите propose без id",
    );
    const before = await page.evaluate(() => window.smallDesktop.memory.read());
    expect(before.ok && before.state.entries.length).toBe(1);
    await confirm.click();
    await expect(page.locator(".memory-proposal")).toContainText(
      "Изменение сохранено",
    );
    const initialChange = {
      action: "entry",
      text: "Встречи с коллегами после обеда.",
    };
    plan = [
      { name: "assistantMemory", input: { action: "recall" } },
      {
        name: "assistantMemory",
        input: {
          action: "review",
          change: initialChange,
          questions: ["После обеда — с какого времени?"],
        },
      },
    ];
    responseText = "После обеда — с какого времени?";
    await page
      .getByLabel("Сообщение ассистенту")
      .fill("Запомни: встречи с коллегами после обеда.");
    await page
      .getByRole("button", { name: "Отправить сообщение", exact: true })
      .click();
    await expect(page.locator(".assistant-markdown").last()).toContainText(
      responseText,
    );
    await expect(confirm).toHaveCount(0);
    const unchanged = await page.evaluate(() =>
      window.smallDesktop.memory.read(),
    );
    expect(unchanged.ok && unchanged.state.entries.length).toBe(2);
    const clarifiedChange = {
      action: "entry",
      text: "Встречи с коллегами предлагать после 14:00 по Алматы.",
    };
    plan = [
      { name: "assistantMemory", input: { action: "recall" } },
      {
        name: "assistantMemory",
        input: {
          action: "review",
          change: clarifiedChange,
          questions: [],
          evidence: "После 14:00 по Алматы",
        },
      },
      {
        name: "assistantMemory",
        input: { action: "propose", change: clarifiedChange },
      },
    ];
    responseText = "Проверьте уточнённую запись и подтвердите сохранение.";
    await page.getByLabel("Сообщение ассистенту").fill("После 14:00 по Алматы");
    await page
      .getByRole("button", { name: "Отправить сообщение", exact: true })
      .click();
    await expect(confirm).toBeEnabled();
    await expect(page.locator(".memory-proposal").last()).toContainText(
      clarifiedChange.text,
    );
    await confirm.click();
    await expect(page.locator(".memory-proposal").last()).toContainText(
      "Изменение сохранено",
    );
    plan = [
      {
        name: "assistantMemory",
        input: { action: "usePreset", query: "Наш синк" },
      },
      {
        name: "prepareMeetingDraft",
        input: {
          participantIds: ["synthetic-a"],
          startsAt: "2099-11-02T10:00:00+05:00",
          location: "",
          conference: { mode: "none" },
        },
      },
    ];
    await app.evaluate(() => {
      (
        globalThis as unknown as { syntheticAvailableSlots: unknown }
      ).syntheticAvailableSlots = [
        {
          start: "2099-11-02T10:00:00+05:00",
          end: "2099-11-02T10:45:00+05:00",
        },
      ];
    });
    await page
      .getByLabel("Сообщение ассистенту")
      .fill("Подготовь формат Наш синк на 2 ноября 2099 года");
    await page
      .getByRole("button", { name: "Отправить сообщение", exact: true })
      .click();
    const draft = page.getByRole("region", {
      name: "Черновик встречи",
      exact: true,
    });
    await expect(draft).toContainText("45 мин");
    await expect(draft).toContainText("Тестовый синк");
    await page.evaluate(async () => {
      const r = await window.smallDesktop.memory.read();
      if (!r.ok) throw Error(r.error);
      const saved = await window.smallDesktop.memory.write({
        revision: r.state.revision,
        requestId: crypto.randomUUID(),
        change: { action: "entry", text: "Проверка актуальности черновика" },
      });
      if (!saved.ok) throw Error(saved.error);
    });
    await draft
      .getByRole("button", { name: "Создать встречу", exact: true })
      .click();
    await expect(draft).toContainText("Память изменилась");
    expect(
      await app.evaluate(
        () =>
          (globalThis as unknown as { syntheticMeetingWrites: number })
            .syntheticMeetingWrites,
      ),
    ).toBe(0);
    await app.close();
    app = await launch();
    await mockSmall(app, calendarToday());
    page = await app.firstWindow();
    await expect(page.locator(".memory-proposal")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Профиль Small", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Выйти из Small" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Закрыть профиль Small" }).click();
    await page
      .getByRole("button", { name: "Память ассистента", exact: true })
      .click();
    memory = page.getByRole("dialog", { name: "Память", exact: true });
    await expect(memory).toContainText("45 минут");
    await expect(memory).toContainText("Повестки оформлять коротким списком.");
    await expect(memory).toContainText("Тестовая команда");
    await expect(memory).toContainText("Наш синк");
    // Logout retains the account's memory; another account gets an independent store.
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Профиль Small", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Выйти из Small", exact: true })
      .click();
    await page.getByLabel("Логин", { exact: true }).fill("employee-b");
    await page.getByLabel("Пароль", { exact: true }).fill("synthetic-password");
    await page
      .getByRole("button", { name: "Войти в Small", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Выйти из Small" }),
    ).toBeVisible();
    let other = await page.evaluate(() => window.smallDesktop.memory.read());
    expect(other.ok && other.state.entries.length).toBe(0);
    await page
      .getByRole("button", { name: "Выйти из Small", exact: true })
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
      .getByRole("button", { name: "Память ассистента", exact: true })
      .click();
    await expect(memory).toContainText("Повестки оформлять коротким списком.");
    await memory
      .getByRole("button", { name: "Очистить всю память", exact: true })
      .click();
    await memory
      .getByRole("button", { name: "Оставить память", exact: true })
      .click();
    await expect(memory).toContainText("45 минут");
    await memory
      .getByRole("button", { name: "Очистить всю память", exact: true })
      .click();
    await memory
      .getByRole("button", { name: "Да, очистить память", exact: true })
      .click();
    await expect(memory).toContainText("Пока нет сохранённых записей");
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    api.closeAllConnections();
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await rm(userData, { recursive: true, force: true });
  }
});
