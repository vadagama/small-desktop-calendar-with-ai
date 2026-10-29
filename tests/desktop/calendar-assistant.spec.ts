import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { AsyncEntry } from "@napi-rs/keyring";
import { mockSmall } from "./fixtures/small-api.js";
import { calendarToday } from "../../src/shared/calendar-time.js";

test("calendar tools cross utility/main boundary and render trusted results", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-chat-calendar-"));
  let toolName = "searchPeople";
  let toolInput: unknown = { query: "Тест", page: 1 };
  const outputs: unknown[] = [];
  const api = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    const result = input.messages.find(
      (m: { role: string }) => m.role === "tool",
    );
    if (result) outputs.push(JSON.parse(result.content));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const delta = result
      ? { content: "Проверка завершена." }
      : {
          tool_calls: [
            {
              index: 0,
              id: "calendar-call",
              type: "function",
              function: {
                name: toolName,
                arguments: JSON.stringify(toolInput),
              },
            },
          ],
        };
    for (const chunk of [
      { id: "test", choices: [{ index: 0, delta, finish_reason: null }] },
      {
        id: "test",
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: result ? "stop" : "tool_calls",
          },
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
    await dialog.getByLabel("Model ID").fill("synthetic-calendar");
    await dialog
      .getByLabel("API-ключ", { exact: true })
      .fill("synthetic-calendar-key");
    await dialog
      .getByRole("button", { name: "Сохранить и использовать" })
      .click();
    await expect(dialog.getByRole("status")).toContainText("Профиль сохранён");
    await dialog.getByRole("button", { name: "Готово", exact: true }).click();
    const send = async (prompt: string) => {
      await page
        .getByRole("textbox", { name: "Сообщение ассистенту" })
        .fill(prompt);
      await page.getByRole("button", { name: "Отправить сообщение" }).click();
      await expect(
        page.getByRole("button", { name: "Отправить сообщение" }),
      ).toBeVisible();
    };
    await send("Найди Тест");
    await expect(page.getByRole("log")).toContainText("Отдел A");
    await expect(page.getByRole("log")).toContainText("Отдел B");
    toolName = "findSlots";
    toolInput = {
      participantIds: ["synthetic-a", "synthetic-b"],
      date: "2099-10-29",
      durationMinutes: 30,
    };
    await send(
      "Участники: [synthetic-a, synthetic-b]. Дата 2099-10-29, 30 минут",
    );
    await expect(page.getByRole("log")).toContainText("09:30–10:00");
    await expect(page.getByRole("log")).not.toContainText("09:00–09:30");
    await send("Найди время для команды");
    await expect(page.getByRole("log")).toContainText("Укажите полный состав");
    toolInput = {
      participantIds: ["unknown"],
      date: "2099-10-29",
      durationMinutes: 30,
    };
    await send("Участники: [unknown]. Дата 2099-10-29, 30 минут");
    await expect(page.getByRole("log")).toContainText(
      "Нет полной занятости каждого участника",
    );
    toolName = "prepareMeetingDraft";
    toolInput = {
      title: "Обсуждение синтетического плана",
      agenda: "Цели и следующие шаги",
      participantIds: ["synthetic-a", "synthetic-b"],
      startsAt: "2099-10-29T09:30:00+05:00",
      location: "",
      conference: { mode: "automatic" },
    };
    await send(
      "Подготовь черновик. Участники: [synthetic-a, synthetic-b]. 2099-10-29 в 09:30, 30 минут. Обсудим план.",
    );
    const draft = page.getByRole("region", {
      name: "Черновик встречи",
      exact: true,
    });
    await expect(draft).toContainText("Обсуждение синтетического плана");
    await expect(draft).toContainText("Организатор: employee-a");
    await expect(draft).toContainText("30 мин");
    await expect(draft).toContainText("Цели и следующие шаги");
    await expect(draft).toContainText("https://meet.small.kz/");
    await expect(draft).toContainText("Встреча не создана");
    await expect(draft).toContainText("synthetic-a, synthetic-b");
    await draft.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/desktop/meeting-draft.png" });
    toolInput = {
      ...(toolInput as object),
      startsAt: "2099-10-29T09:00:00+05:00",
    };
    await send(
      "Подготовь черновик. Участники: [synthetic-a, synthetic-b]. 2099-10-29 в 09:00, 30 минут.",
    );
    await expect(page.getByRole("log")).toContainText(
      "Выбранный интервал не подтверждён",
    );
    await expect(draft).toHaveCount(1);
    expect(outputs).toHaveLength(6);
    expect(JSON.stringify(outputs)).not.toMatch(
      /access_token|synthetic-calendar-key|signature/,
    );
    await page.setViewportSize({ width: 900, height: 640 });
    await expect
      .poll(async () => {
        const bounds = await page
          .getByRole("region", { name: "AI-ассистент" })
          .boundingBox();
        return bounds ? bounds.x + bounds.width : Infinity;
      })
      .toBeLessThanOrEqual(900);
    await page.screenshot({
      path: "test-results/desktop/calendar-assistant.png",
    });
    expect(errors).toEqual([]);
  } finally {
    const cleanupPage = await app.firstWindow();
    const removed = await cleanupPage.evaluate(() =>
      window.smallDesktop.profiles.remove("personal"),
    );
    expect(removed.ok).toBe(true);
    await app.close();
    const service = `kz.small.desktop-calendar.llm.${createHash("sha256").update(userData).digest("hex").slice(0, 24)}`;
    for (const account of ["small-auth-session-v1"]) {
      try {
        await new AsyncEntry(service, account).deleteCredential();
      } catch {
        /* May already be removed. */
      }
    }
    api.closeAllConnections();
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await rm(userData, { recursive: true, force: true });
  }
});
