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
  type ModelMessage = {
    role: string;
    content: string;
    tool_call_id?: string;
  };
  type Step = { name: string; input: unknown };
  let plan: Step[] = [
    { name: "loadSkill", input: { name: "people-search" } },
    { name: "loadReference", input: { name: "people" } },
    { name: "searchPeople", input: { query: "Тест", page: 1 } },
  ];
  let answer =
    "**Уточните участников.** Нужен Тестовый сотрудник (Отдел A) или Тестовый сотрудник (Отдел B)?";
  let turn = 0;
  const outputs: unknown[] = [];
  const requests: ModelMessage[][] = [];
  const seenOutputs = new Set<string>();
  const api = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body) as { messages: ModelMessage[] };
    requests.push(input.messages);
    // Old tool results belong to history, not to this turn's execution plan.
    const lastUser = input.messages.findLastIndex(
      (message) => message.role === "user",
    );
    const currentTools = input.messages
      .slice(lastUser + 1)
      .filter((message) => message.role === "tool");
    for (const result of currentTools) {
      if (!seenOutputs.has(result.tool_call_id!)) {
        outputs.push(JSON.parse(result.content));
        seenOutputs.add(result.tool_call_id!);
      }
    }
    const step = plan[currentTools.length];
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const delta = step
      ? {
          tool_calls: [
            {
              index: 0,
              id: `calendar-${turn}-${currentTools.length}`,
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
    await dialog.getByLabel("Model ID").fill("synthetic-calendar");
    await dialog
      .getByLabel("API-ключ", { exact: true })
      .fill("synthetic-calendar-key");
    await dialog.getByRole("button", { name: "Сохранить" }).click();
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
    const setSlots = (day: string) =>
      app.evaluate((_electron, day) => {
        (
          globalThis as typeof globalThis & {
            syntheticAvailableSlots: { start: string; end: string }[];
          }
        ).syntheticAvailableSlots = [
          { start: `${day}T09:00:00+05:00`, end: `${day}T09:30:00+05:00` },
          { start: `${day}T14:00:00+05:00`, end: `${day}T14:30:00+05:00` },
          { start: `${day}T16:00:00+05:00`, end: `${day}T16:30:00+05:00` },
        ];
      }, day);
    await setSlots("2099-10-29");
    const initialPrompt =
      "Создай встречу 29 октября 2099 после обеда с Тестовым сотрудником";
    await send(initialPrompt);
    const log = page.getByRole("log");
    await expect(log).toContainText("Отдел A");
    await expect(log).toContainText("Отдел B");
    await expect(
      log.locator("strong").filter({ hasText: "Уточните участников." }),
    ).toBeVisible();
    const prose = log
      .locator(".assistant-markdown p")
      .filter({ hasText: "Уточните участников." });
    await expect(prose).toHaveCSS("font-size", "14px");
    await expect(log).not.toContainText("Поиск сотрудников");
    await expect(log).not.toContainText("Страница 1");
    await expect(log.locator(".assistant-choices")).toHaveCount(0);
    await page.screenshot({
      path: "test-results/desktop/people-search-dialogue.png",
    });
    await expect(log).not.toContainText("Сложение чисел");

    turn++;
    plan = [
      { name: "loadSkill", input: { name: "availability" } },
      { name: "loadReference", input: { name: "scheduling" } },
      {
        name: "selectParticipants",
        input: { participantIds: ["synthetic-a", "synthetic-b"] },
      },
      {
        name: "findSlots",
        input: {
          participantIds: ["synthetic-a", "synthetic-b"],
          date: "2099-10-29",
          durationMinutes: 30,
          timeFrom: "14:00",
          timeTo: "18:00",
          includeWeekends: true,
        },
      },
    ];
    answer = "**Нашёл время.** Выберите удобный вариант.";
    const clarification = "Пригласи обоих, на полчаса. Обсудим план.";
    await send(clarification);
    await expect(log).toContainText("14:00–14:30");
    await expect(log).not.toContainText("09:00–09:30");
    const followupRequest = requests.find(
      (messages) =>
        messages.at(-1)?.role === "user" &&
        messages.at(-1)?.content === clarification,
    )!;
    expect(
      followupRequest.some(
        (message) =>
          message.role === "user" && message.content === initialPrompt,
      ),
    ).toBe(true);
    expect(
      followupRequest.some(
        (message) =>
          message.role === "assistant" &&
          message.content?.includes("Уточните участников"),
      ),
    ).toBe(true);

    turn++;
    let draftInput = {
      title: "Обсуждение синтетического плана",
      agenda: "Цели и следующие шаги",
      participantIds: ["synthetic-a", "synthetic-b"],
      startsAt: "2099-10-29T14:00:00+05:00",
      location: "",
      conference: { mode: "automatic" },
    };
    plan = [
      { name: "loadSkill", input: { name: "meeting-draft" } },
      { name: "loadReference", input: { name: "response-templates" } },
      { name: "prepareMeetingDraft", input: draftInput },
    ];
    answer = "**Черновик готов.** Проверьте параметры встречи.";
    await log.getByRole("button", { name: /29 октября.*14:00–14:30/ }).click();
    await expect(
      page.getByRole("button", { name: "Отправить сообщение" }),
    ).toBeVisible();
    const draft = page.getByRole("region", {
      name: "Черновик встречи",
      exact: true,
    });
    await expect(draft).toContainText("Обсуждение синтетического плана");
    await expect(draft).toContainText("employee-a");
    await expect(draft).toContainText("30 мин");
    await expect(draft).toContainText("Цели и следующие шаги");
    await expect(draft).toContainText("https://meet.small.kz/");
    await expect(draft).not.toContainText("Встреча не создана");
    await expect(log).not.toContainText("Черновик готов.");
    await expect(log).not.toContainText("Проверьте параметры встречи.");
    await expect(draft.getByRole("button")).toHaveCount(1);
    await expect(draft.locator(".assistant-meeting-create")).toHaveCSS(
      "font-size",
      "14px",
    );
    await expect(draft).toContainText("Тестовый сотрудник, Тестовый сотрудник");
    await expect(draft).not.toContainText("synthetic-a");
    await draft.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/desktop/meeting-draft.png" });
    const originalDraft = (
      outputs.find(
        (output) =>
          typeof output === "object" &&
          output !== null &&
          "data" in output &&
          (output.data as { kind?: string })?.kind === "meeting-draft",
      ) as { data: { id: string; revision: number } }
    ).data;
    const writes = () =>
      app.evaluate(
        () =>
          (globalThis as typeof globalThis & { syntheticMeetingWrites: number })
            .syntheticMeetingWrites,
      );
    expect(await writes()).toBe(0);
    await app.evaluate(() => {
      (
        globalThis as typeof globalThis & { syntheticAvailableSlots: unknown[] }
      ).syntheticAvailableSlots = [];
    });
    await draft
      .getByRole("button", {
        name: "Создать встречу",
        exact: true,
      })
      .click();
    await expect(draft.getByRole("status")).toContainText(
      "Время больше не свободно",
    );
    await expect(draft).not.toContainText("Нет пересечений у участников");
    expect(await writes()).toBe(0);
    await setSlots("2099-10-29");
    await app.evaluate(() => {
      (
        globalThis as typeof globalThis & { syntheticCreateRejection: number }
      ).syntheticCreateRejection = 409;
    });
    await draft
      .getByRole("button", { name: "Создать встречу", exact: true })
      .click();
    await expect(draft.getByRole("status")).toContainText(
      "Small отклонил создание: обнаружен конфликт времени",
    );
    expect(await writes()).toBe(0);
    await expect(draft).not.toContainText("Результат отправки неизвестен");
    await app.evaluate(() => {
      delete (
        globalThis as typeof globalThis & { syntheticCreateRejection?: number }
      ).syntheticCreateRejection;
    });
    await draft
      .getByRole("button", {
        name: "Создать встречу",
        exact: true,
      })
      .click();
    await expect(draft.getByRole("status")).toContainText("Встреча создана:");
    expect(await writes()).toBe(1);
    await expect(
      page.getByRole("button", {
        name: /Обсуждение синтетического плана 14:00/,
      }),
    ).toBeVisible();
    const repeated = await page.evaluate(
      (ref) => window.smallDesktop.meetings.confirm(ref),
      { id: originalDraft.id, revision: originalDraft.revision },
    );
    expect(repeated.ok).toBe(true);
    expect(await writes()).toBe(1);
    await expect(draft.getByRole("status")).toContainText("Встреча создана:");
    await page.screenshot({ path: "test-results/desktop/meeting-created.png" });
    turn++;
    plan = [
      {
        name: "prepareMeetingDraft",
        input: { ...draftInput, startsAt: "2099-10-29T09:00:00+05:00" },
      },
    ];
    answer = "Выбранный интервал не подтверждён. Выберите другое время.";
    await send("А подготовь ещё встречу в девять утра");
    await expect(log).toContainText("Выбранный интервал не подтверждён");
    await expect(draft).toHaveCount(1);
    turn++;
    draftInput = {
      ...draftInput,
      title: "Неизвестный результат",
      agenda: "Тест",
      startsAt: "2099-10-30T14:00:00+05:00",
    };
    await setSlots("2099-10-30");
    plan = [{ name: "prepareMeetingDraft", input: draftInput }];
    answer = "Подготовлен ещё один черновик.";
    await send(
      "Подготовь ещё одну встречу с теми же участниками на следующий день в два часа дня",
    );
    const uncertain = page
      .getByRole("region", { name: "Черновик встречи", exact: true })
      .last();
    await uncertain
      .getByRole("button", {
        name: "Создать встречу",
        exact: true,
      })
      .click();
    await expect(uncertain.getByRole("status")).toContainText(
      "Результат отправки неизвестен",
    );
    expect(await writes()).toBe(2);
    await uncertain
      .getByRole("button", { name: "Проверить результат", exact: true })
      .click();
    await expect(uncertain.getByRole("status")).toContainText(
      "Результат отправки неизвестен",
    );
    expect(await writes()).toBe(2);
    await expect(
      uncertain.getByRole("button", {
        name: "Создать встречу",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      uncertain.getByRole("button", {
        name: "Выбрать другое время",
        exact: true,
      }),
    ).toBeVisible();
    expect(outputs).toHaveLength(12);
    expect(
      outputs.some(
        (output) =>
          typeof output === "object" &&
          output !== null &&
          "ok" in output &&
          output.ok === false,
      ),
    ).toBe(true);
    expect(JSON.stringify(outputs)).not.toMatch(
      /access_token|synthetic-calendar-key|signature/,
    );
    turn++;
    plan = [
      {
        name: "prepareMeetingDraft",
        input: { ...draftInput, title: "Изменённый черновик" },
      },
    ];
    await send("Подготовь изменённый черновик на то же время");
    const blocked = page
      .getByRole("region", { name: "Черновик встречи", exact: true })
      .last();
    await expect(blocked.getByRole("status")).toContainText(
      "уже отправлялся другой черновик",
    );
    await expect(
      blocked.getByRole("button", { name: "Создать встречу", exact: true }),
    ).toBeDisabled();
    await expect(
      blocked.getByRole("button", {
        name: "Выбрать другое время",
        exact: true,
      }),
    ).toBeEnabled();
    expect(await writes()).toBe(2);
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
    expect(
      followupRequest.filter((message) => message.role === "tool"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining("Отдел B"),
        }),
      ]),
    );
    turn++;
    plan = [
      { name: "loadSkill", input: { name: "schedule" } },
      { name: "listMeetings", input: { period: "today" } },
    ];
    answer = "### Сегодня\n- 09:00–09:30 — Проверка расписания";
    await send("Какие встречи сегодня за весь день?");
    await expect(
      page.getByRole("heading", { name: "Сегодня", exact: true }),
    ).toBeVisible();
    expect(outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            kind: "schedule",
            timezone: "Asia/Almaty",
            complete: true,
          }),
        }),
      ]),
    );
    await expect(page.getByText("Сложение чисел", { exact: true })).toHaveCount(
      0,
    );
    expect(await writes()).toBe(2);
    // A personal request must discard the previously selected guests.
    turn++;
    await setSlots("2099-10-31");
    plan = [
      { name: "selectParticipants", input: { participantIds: [] } },
      {
        name: "prepareMeetingDraft",
        input: {
          ...draftInput,
          title: "Личный слот",
          startsAt: "2099-10-31T14:00:00+05:00",
          participantIds: [],
        },
      },
    ];
    await send(
      "Запланируй личную встречу для меня 31 октября в 14:00 на полчаса",
    );
    const personal = page
      .getByRole("region", { name: "Черновик встречи", exact: true })
      .last();
    await expect(personal).toContainText("Личный слот");
    const personalOutput = outputs.findLast(
      (output) =>
        typeof output === "object" &&
        output !== null &&
        "data" in output &&
        (output.data as { title?: string })?.title === "Личный слот",
    ) as { data: { participantIds: string[] } };
    expect(personalOutput.data.participantIds).toEqual(["synthetic-organizer"]);

    turn++;
    plan = [
      { name: "loadSkill", input: { name: "meeting-delete" } },
      { name: "listMeetings", input: { period: "today" } },
      {
        name: "prepareMeetingDeletion",
        input: { key: "event:42", date: calendarToday() },
      },
    ];
    answer = "Встреча уже удалена";
    await send("Удали Синтетическую встречу A сегодня");
    const deletion = page.getByRole("region", {
      name: "Удаление встречи",
      exact: true,
    });
    await expect(deletion).toContainText("Синтетическая встреча A");
    await expect(deletion.locator("p").first()).toHaveCSS("font-size", "14px");
    await expect(
      page.getByText("Встреча уже удалена", { exact: true }),
    ).toHaveCount(0);
    // Preparing the card has no write capability.
    const readEvent = () =>
      page.evaluate(() =>
        window.smallDesktop.calendar.detail({
          accountId: "employee-a",
          lookup: { id: "42" },
        }),
      );
    expect((await readEvent()).ok).toBe(true);
    await deletion.screenshot({
      path: "test-results/desktop/assistant-delete-preview.png",
    });
    await deletion
      .getByRole("button", { name: "Удалить встречу", exact: true })
      .click();
    await expect(deletion.getByRole("status")).toHaveText(
      "Событие успешно удалено",
    );
    expect((await readEvent()).ok).toBe(false);
    await expect(deletion.getByRole("button")).toHaveCount(0);
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
