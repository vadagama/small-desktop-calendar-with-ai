import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";

test("model settings persist only metadata and use a locally encrypted key through the provider", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-local-vault-test-"));
  const key = `synthetic-${crypto.randomUUID()}`;
  let calls = 0;
  let reject = false;
  const authorization: Array<string | undefined> = [];
  const api = createServer(async (request, response) => {
    calls++;
    authorization.push(request.headers.authorization);
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    if (reject) {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "synthetic denial" } }));
      return;
    }
    const tool = input.messages.some(
      (message: { role: string }) => message.role === "tool",
    );
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const delta = tool
      ? { content: "Ответ локального сервера: 5" }
      : {
          tool_calls: [
            {
              index: 0,
              id: "synthetic-call",
              type: "function",
              function: { name: "addNumbers", arguments: '{"a":2,"b":3}' },
            },
          ],
        };
    for (const chunk of [
      { id: "synthetic", choices: [{ index: 0, delta, finish_reason: null }] },
      {
        id: "synthetic",
        choices: [
          { index: 0, delta: {}, finish_reason: tool ? "stop" : "tool_calls" },
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
    throw new Error("Missing synthetic API address");
  const baseURL = `http://127.0.0.1:${address.port}/v1`;
  const executablePath = process.env.SMALL_APP_EXECUTABLE;
  const app = await _electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : ["."]), `--user-data-dir=${userData}`],
    env: { ...process.env, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
  });
  const page = await app.firstWindow();
  try {
    await page.getByRole("button", { name: /^Настроить LLM:/ }).click();
    const dialog = page.getByRole("dialog", { name: "Настройки модели" });
    await expect(dialog.getByLabel("Base URL")).toHaveValue(
      "https://ai.skiftrade.kz/v1",
    );
    await expect(dialog.getByLabel("Model ID")).toHaveValue(
      "vllm/glm-5.3-flash",
    );
    await dialog
      .getByLabel("Профиль", { exact: true })
      .selectOption("personal");
    await dialog.getByLabel("Base URL").fill(baseURL);
    await dialog.getByLabel("Model ID").fill("synthetic-profile-model");
    await dialog.getByLabel("API-ключ", { exact: true }).fill(key);
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Настроить LLM:/ }),
    ).toContainText("synthetic-profile-model");
    await expect(
      page.getByRole("button", { name: /^Настроить LLM:/ }),
    ).toHaveCSS("font-size", "12px");
    await page
      .getByRole("button", { name: "Настройки модели", exact: true })
      .click();
    await expect(dialog.getByLabel("API-ключ", { exact: true })).toHaveValue(
      "",
    );
    await expect(
      dialog.getByLabel("API-ключ", { exact: true }),
    ).toHaveAttribute("placeholder", `••••${key.slice(-4)}`);
    await expect(
      dialog.getByRole("img", { name: "Ключ сохранён и применён" }),
    ).toBeVisible();
    await dialog
      .getByLabel("API-ключ", { exact: true })
      .fill("replacement-draft");
    await expect(
      dialog.getByRole("img", { name: "Ключ сохранён и применён" }),
    ).toHaveCount(0);
    await dialog.getByLabel("API-ключ", { exact: true }).fill("");
    await expect(dialog.locator(".model-actions button")).toHaveText([
      "Сохранить",
      "Удалить ключ",
    ]);
    await expect(dialog.locator("h2")).toHaveCSS("font-size", "18px");
    await expect(dialog.getByLabel("API-ключ", { exact: true })).toHaveCSS(
      "font-size",
      "14px",
    );
    await page.screenshot({
      path: "test-results/desktop/model-settings-saved.png",
    });
    await page.evaluate(() =>
      window.smallDesktop.profiles.activate("synthetic"),
    );
    await dialog
      .getByRole("button", { name: "Закрыть настройки модели" })
      .click();
    await page
      .getByRole("textbox", { name: "Сообщение ассистенту" })
      .fill("Привет");
    await page.getByRole("button", { name: "Отправить сообщение" }).click();
    await expect(
      page.getByRole("region", { name: "AI-ассистент" }).getByRole("alert"),
    ).toContainText("Профиль сохранён, но не выбран");
    expect(calls).toBe(0);
    await page
      .getByRole("button", { name: "Настройки модели", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    const settingsDirectory = await app.evaluate(({ app }) =>
      app.getPath("userData"),
    );
    const settingsPath = join(settingsDirectory, "llm-profiles.json");
    const originalSettings = await readFile(settingsPath, "utf8");
    const pendingCleanup = JSON.parse(originalSettings);
    pendingCleanup.retired = [
      { ...pendingCleanup.profiles[0], credentialId: crypto.randomUUID() },
    ];
    await writeFile(settingsPath, JSON.stringify(pendingCleanup));
    await page.reload();
    await page
      .getByRole("button", { name: "Настройки модели", exact: true })
      .click();
    await expect(
      dialog.getByRole("img", { name: "Ключ сохранён и применён" }),
    ).toBeVisible();
    await expect(dialog.getByRole("status")).toContainText(
      "Предыдущий ключ пока не удалён",
    );
    await page.screenshot({
      path: "test-results/desktop/model-key-with-cleanup.png",
    });
    await writeFile(settingsPath, originalSettings);
    const state = await page.evaluate(() =>
      window.smallDesktop.profiles.read(),
    );
    expect(JSON.stringify(state)).not.toContain(key);
    const directory = await app.evaluate(({ app }) => app.getPath("userData"));
    expect(
      await readFile(join(directory, "llm-profiles.json"), "utf8"),
    ).not.toContain(key);
    await dialog
      .getByRole("button", { name: "Закрыть настройки модели", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Сообщение ассистенту" })
      .fill("Сложи 2 и 3");
    await page.getByRole("button", { name: "Отправить сообщение" }).click();
    await expect(page.getByRole("log")).toContainText(
      "Ответ локального сервера: 5",
    );
    await expect(
      page.getByRole("button", { name: "Остановить ответ" }),
    ).toHaveCount(0);
    expect(calls).toBe(2);
    expect(authorization).toEqual([`Bearer ${key}`, `Bearer ${key}`]);
    reject = true;
    await page
      .getByRole("textbox", { name: "Сообщение ассистенту" })
      .fill("Проверь отказ");
    await page.getByRole("button", { name: "Отправить сообщение" }).click();
    await expect(
      page.getByRole("region", { name: "AI-ассистент" }).getByRole("alert"),
    ).toContainText("Сервер модели отклонил API-ключ (HTTP 401)");
    const afterError = await page.evaluate(() =>
      window.smallDesktop.profiles.read(),
    );
    expect(afterError.ok && afterError.state.active).toBe("personal");
    expect(calls).toBe(3);
    await page
      .getByRole("button", { name: "Настройки модели", exact: true })
      .click();
    await dialog.getByLabel("Base URL").fill("https://other.invalid/v1");
    await expect(
      dialog.getByLabel("API-ключ", { exact: true }),
    ).toHaveAttribute("required", "");
    const changed = await page.evaluate(() =>
      window.smallDesktop.profiles.save({
        id: "personal",
        baseURL: "https://other.invalid/v1",
        modelId: "synthetic",
      }),
    );
    expect(changed.ok).toBe(false);
    await page.screenshot({ path: "test-results/desktop/model-settings.png" });
    await dialog.getByRole("button", { name: "Удалить ключ" }).click();
    await expect(dialog.getByRole("status")).toContainText(
      "Ключ и профиль удалены",
    );
  } finally {
    try {
      const cleanup = await page.evaluate(() =>
        window.smallDesktop.profiles.remove("personal"),
      );
      expect(
        cleanup.ok &&
          cleanup.state.profiles.length === 0 &&
          !cleanup.state.warning,
      ).toBe(true);
    } finally {
      await app.close();
      api.closeAllConnections();
      await new Promise<void>((resolve) => api.close(() => resolve()));
      await rm(userData, { recursive: true, force: true });
    }
  }
});
