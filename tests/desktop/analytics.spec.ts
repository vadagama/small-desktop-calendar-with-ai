import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { mockSmall } from "./fixtures/small-api.js";
import { calendarToday } from "../../src/shared/calendar-time.js";

test("analytics report is calculated by main and rendered as a verifiable card", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-analytics-"));
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

    await expect(
      page.getByRole("button", { name: "Правила тем аналитики", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("dialog", { name: "Правила тем аналитики" }),
    ).toHaveCount(0);
    // Seed saved rules through the bridge while their editor is hidden.
    const savedRules = await page.evaluate(() =>
      window.smallDesktop.topicRules.save([
        { topic: "Встречи", keywords: ["встреча"] },
        { topic: "Серии", keywords: ["серия", "регулярная"] },
      ]),
    );
    expect(savedRules.ok).toBe(true);

    plan = [
      { name: "loadSkill", input: { name: "analytics" } },
      { name: "meetingAnalytics", input: { period: "today" } },
    ];
    answer = "Отчёт за сегодня готов.";
    await send("Сколько часов встреч у меня сегодня?");
    const card = page.getByRole("region", {
      name: "Аналитика встреч",
      exact: true,
    });
    await expect(card).toBeVisible();
    await expect(card).toContainText("Asia/Almaty");
    const metric = (name: string) =>
      card.locator("dl > div").filter({ hasText: name }).locator("dd");
    await expect(metric("Встречи")).toHaveText("2");
    await expect(metric("Сумма длительностей")).toHaveText("1 ч 30 мин");
    await expect(metric("Занятое время")).toHaveText("1 ч 30 мин");
    await expect(metric("Пересечения")).toHaveText("0 мин");
    await expect(metric("Регулярные")).toHaveText("1 · 30 мин");
    await expect(card).toContainText(
      "Недоступно по данным календаря: отмены, команды, теги и категории.",
    );
    await expect(card).not.toContainText("Данные частичные");
    await card.getByText("Состав отчёта (2)").click();
    await expect(card).toContainText("Синтетическая встреча A");
    await expect(card).toContainText("Синтетическая серия A");
    await card.getByText("По темам").click();
    const topics = card
      .locator("details")
      .filter({ hasText: "По темам" })
      .locator(".analytics-rows li");
    await expect(topics).toHaveText([
      /Встречи\s*1 · 1 ч/,
      /Серии\s*1 · 30 мин/,
    ]);
    await expect(card).toContainText("1 ч · Встречи: «встреча»");
    await expect(card).toContainText("30 мин · Серии: «серия»");
    await card.getByText("Правила подсчёта").click();
    await expect(card).toContainText("полуоткрытый интервал");
    await expect(page.getByRole("log")).toContainText(
      "Отчёт за сегодня готов.",
    );
    expect(outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            kind: "analytics",
            complete: true,
            totals: expect.objectContaining({ count: 2, sumMinutes: 90 }),
          }),
        }),
      ]),
    );

    turn++;
    await app.evaluate(() => {
      (
        globalThis as typeof globalThis & {
          syntheticEventOwner: string;
          syntheticEventExtra: Record<string, unknown>;
        }
      ).syntheticEventOwner = "someone-else";
      (
        globalThis as typeof globalThis & {
          syntheticEventExtra: Record<string, unknown>;
        }
      ).syntheticEventExtra = {
        participants: [
          {
            id: "synthetic-organizer",
            name: "Синтетический организатор",
            status: "declined",
          },
        ],
      };
    });
    plan = [{ name: "meetingAnalytics", input: { period: "today" } }];
    answer = "Второй отчёт готов.";
    await send("А теперь пересчитай ещё раз");
    const second = page
      .getByRole("region", { name: "Аналитика встреч", exact: true })
      .last();
    await expect(second).toContainText("Подтверждённых встреч за период нет.");
    await expect(second).toContainText("Отклонены: 2 · 1 ч 30 мин");
    await expect(
      second.locator("dl > div").filter({ hasText: "Встречи" }).locator("dd"),
    ).toHaveText("0");
    turn++;
    const today = calendarToday();
    await app.evaluate((_electron, today) => {
      const g = globalThis as typeof globalThis & {
        syntheticEventOwner?: string;
        syntheticEventExtra?: Record<string, unknown>;
      };
      delete g.syntheticEventOwner;
      g.syntheticEventExtra = {
        starts_at: `${today}T11:00:00+05:00`,
        ends_at: `${today}T12:00:00+05:00`,
      };
    }, today);
    plan = [{ name: "meetingAnalytics", input: { period: "today" } }];
    answer = "Третий отчёт готов.";
    await send("Пересчитай с учётом переноса");
    const third = page
      .getByRole("region", { name: "Аналитика встреч", exact: true })
      .last();
    const thirdMetric = (name: string) =>
      third.locator("dl > div").filter({ hasText: name }).locator("dd");
    await expect(thirdMetric("Встречи")).toHaveText("2");
    await expect(thirdMetric("Сумма длительностей")).toHaveText("1 ч 30 мин");
    await expect(thirdMetric("Занятое время")).toHaveText("1 ч");
    await expect(thirdMetric("Пересечения")).toHaveText("30 мин");
    await third.getByText("По организаторам").click();
    await expect(
      third
        .locator("details")
        .filter({ hasText: "По организаторам" })
        .locator(".analytics-rows"),
    ).toContainText("Синтетический организатор");
    expect(JSON.stringify(outputs)).not.toMatch(
      /access_token|synthetic-analytics-key|signature/,
    );
    expect(
      await app.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              syntheticEventMutations: number;
            }
          ).syntheticEventMutations,
      ),
    ).toBe(0);
    await page.screenshot({ path: "test-results/desktop/analytics.png" });
    expect(errors).toEqual([]);
  } finally {
    const cleanupPage = await app.firstWindow();
    const removed = await cleanupPage.evaluate(() =>
      window.smallDesktop.profiles.remove("personal"),
    );
    expect(removed.ok).toBe(true);
    await app.close();
    api.closeAllConnections();
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await rm(userData, { recursive: true, force: true });
  }
});
