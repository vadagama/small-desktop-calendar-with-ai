import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { mockSmall } from "./fixtures/small-api.js";
import { calendarToday } from "../../src/shared/calendar-time.js";

test("event list supports monthly navigation and trusted assistant search", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-event-list-"));
  type ModelMessage = {
    role: string;
    content: string;
    tool_call_id?: string;
  };
  let plan: { name: string; input: unknown }[] = [];
  let answer = "";
  let turn = 0;
  const outputs: unknown[] = [];
  const seen = new Set<string>();
  const api = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body) as { messages: ModelMessage[] };
    const lastUser = input.messages.findLastIndex((m) => m.role === "user");
    const current = input.messages
      .slice(lastUser + 1)
      .filter((m) => m.role === "tool");
    for (const result of current)
      if (!seen.has(result.tool_call_id!)) {
        outputs.push(JSON.parse(result.content));
        seen.add(result.tool_call_id!);
      }
    const step = plan[current.length];
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const delta = step
      ? {
          tool_calls: [
            {
              index: 0,
              id: `analytics-${turn}-${current.length}`,
              type: "function",
              function: {
                name: step.name,
                arguments: JSON.stringify(step.input),
              },
            },
          ],
        }
      : { content: answer };
    for (const chunk of [
      { id: "test", choices: [{ index: 0, delta, finish_reason: null }] },
      {
        id: "test",
        choices: [
          { index: 0, delta: {}, finish_reason: step ? "tool_calls" : "stop" },
        ],
      },
    ])
      response.write(`data: ${JSON.stringify(chunk)}\n\n`);
    response.end("data: [DONE]\n\n");
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const address = api.address();
  if (!address || typeof address === "string")
    throw new Error("Missing address");
  const app = await _electron.launch({
    args: [
      ".",
      `--user-data-dir=${userData}`,
      "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
    ],
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
    await page
      .getByRole("button", { name: "Профиль Small", exact: true })
      .click();
    await expect(page.getByLabel("Логин", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Пароль", { exact: true })).toHaveValue("");
    const initial = await page.evaluate(async () => ({
      auth: await window.smallDesktop.smallAuth.read(),
      settings: await window.smallDesktop.agentSettings.read(),
      profiles: await window.smallDesktop.profiles.read(),
    }));
    expect(initial.auth.ok && initial.auth.state.status).toBe("signed-out");
    expect(initial.settings.ok && initial.settings.state.settings.mood).toBe(
      "neutral",
    );
    expect(
      initial.settings.ok && initial.settings.state.settings.instructions,
    ).toBe("");
    expect(
      initial.profiles.ok &&
        initial.profiles.state.profiles.every((p) => !p.hasKey),
    ).toBe(true);
    await page.getByLabel("Логин", { exact: true }).fill("employee-a");
    await page.getByLabel("Пароль", { exact: true }).fill("synthetic-password");
    await page
      .getByRole("button", { name: "Войти в Small", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Выйти из Small" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Закрыть профиль Small" }).click();
    const memory = await page.evaluate(() => window.smallDesktop.memory.read());
    expect(memory.ok).toBe(true);
    if (memory.ok) {
      expect(memory.state.preferences).toEqual({});
      expect(memory.state.entries).toEqual([]);
      expect(memory.state.groups).toEqual([]);
      expect(memory.state.presets).toEqual([]);
    }

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
    await dialog.getByLabel("Model ID").fill("synthetic-analytics");
    await dialog
      .getByLabel("API-ключ", { exact: true })
      .fill("synthetic-analytics-key");
    await dialog
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    const send = async (prompt: string) => {
      await page
        .getByRole("textbox", { name: "Сообщение ассистенту" })
        .fill(prompt);
      await page.getByRole("button", { name: "Отправить сообщение" }).click();
      await expect(
        page.getByRole("button", { name: "Отправить сообщение" }),
      ).toBeVisible();
    };

    await page.getByRole("button", { name: "Список", exact: true }).click();
    const list = page.locator(".event-list-view");
    await expect(list).toContainText("Найдено событий: 2");
    await expect(list.locator("input")).toHaveCount(0);
    const row = list.locator(".event-list-row").first();
    await row.hover();
    await expect(page.locator('[role="tooltip"]')).toBeVisible();
    expect(await row.evaluate((el) => getComputedStyle(el).fontSize)).toBe(
      "13px",
    );
    await row.click();
    await expect(page.getByRole("dialog").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await app.evaluate(() => {
      Object.assign(globalThis, {
        syntheticEventOwner: "synthetic-a",
        syntheticEventExtra: { creator_name: "Жанна" },
      });
    });
    plan = [
      { name: "loadSkill", input: { name: "event-list" } },
      { name: "searchPeople", input: { query: "Тест", page: 1 } },
    ];
    answer = "Уточните сотрудника: отдел A или B?";
    await send("Найди события организатора Тест за сегодня");
    await expect(page.getByRole("log")).toContainText(answer);
    turn++;
    plan = [
      {
        name: "showEventList",
        input: {
          from: calendarToday(),
          to: calendarToday(),
          scope: "all-accessible",
          organizerId: "synthetic-a",
        },
      },
    ];
    answer = "Загружено 2 события за сегодня. Часть календарей недоступна.";
    await send("Сотрудник из отдела A");
    await expect(list).toContainText("Загружено событий: 2");
    await expect(page.locator(".calendar-warning")).toContainText(
      "Результаты поиска неполные",
    );
    await expect(
      list.getByRole("button", { name: "Убрать фильтр организатора" }),
    ).toContainText("Тестовый сотрудник");
    await expect(list).toContainText("Жанна");
    await page.screenshot({ path: "test-results/desktop/event-list.png" });
    await list
      .getByRole("button", { name: "Убрать фильтр организатора" })
      .click();
    await expect(
      list.getByRole("button", { name: "Убрать фильтр организатора" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Следующий период", exact: true })
      .click();
    await expect(list).toContainText("Событий не найдено");
    await page.getByRole("button", { name: "Сегодня", exact: true }).click();
    await expect(list).toContainText("Найдено событий: 2");
    turn++;
    plan = [
      {
        name: "showEventList",
        input: {
          from: calendarToday(),
          to: calendarToday(),
          scope: "my",
          organizerId: "synthetic-a",
        },
      },
    ];
    answer = "Найдено 2 события в личном календаре.";
    await send("Теперь только в моём календаре");
    await expect(list).toContainText("Найдено событий: 2");
    await expect(
      list.getByRole("button", { name: "Убрать фильтр организатора" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Профиль Small", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Выйти из Small", exact: true })
      .click();
    await expect(page.getByLabel("Логин", { exact: true })).toBeVisible();
    await expect(list).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    api.closeAllConnections();
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await rm(userData, { recursive: true, force: true });
  }
});
