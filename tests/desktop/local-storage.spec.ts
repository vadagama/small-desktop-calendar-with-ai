import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";

test("local API credential survives a full app restart without OS secret APIs", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-local-restart-"));
  const key = "synthetic-local-restart-key";
  const received: string[] = [];
  const api = createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* consume the request */
    }
    received.push(request.headers.authorization ?? "");
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(
      `data: ${JSON.stringify({ id: "local-test", choices: [{ index: 0, delta: { content: "Локальный ключ восстановлен" }, finish_reason: null }] })}\n\n`,
    );
    response.write(
      `data: ${JSON.stringify({ id: "local-test", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
    );
    response.end("data: [DONE]\n\n");
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const address = api.address();
  if (!address || typeof address === "string")
    throw Error("Missing test address");
  const launch = () =>
    _electron.launch({ args: [".", `--user-data-dir=${userData}`] });
  let app = await launch();
  const blockNative = () =>
    app.evaluate(({ safeStorage }) => {
      const denied = () => {
        throw Error("OS secret APIs are forbidden");
      };
      safeStorage.isAsyncEncryptionAvailable = denied;
      safeStorage.encryptStringAsync = denied;
      safeStorage.decryptStringAsync = denied;
    });
  try {
    await blockNative();
    let page = await app.firstWindow();
    const saved = await page.evaluate(
      (input) => window.smallDesktop.profiles.save(input),
      {
        id: "personal" as const,
        baseURL: `http://127.0.0.1:${address.port}/v1`,
        modelId: "synthetic",
        apiKey: key,
      },
    );
    expect(saved.ok).toBe(true);
    const path = join(userData, "local-vault", "secrets");
    for (const name of await readdir(path))
      expect(
        (await readFile(join(path, name))).includes(Buffer.from(key)),
      ).toBe(false);
    await app.close();
    app = await launch();
    await blockNative();
    page = await app.firstWindow();
    const restored = await page.evaluate(() =>
      window.smallDesktop.profiles.read(),
    );
    expect(restored).toMatchObject({
      ok: true,
      state: { active: "personal", profiles: [{ hasKey: true }] },
    });
    await page
      .getByRole("textbox", { name: "Сообщение ассистенту" })
      .fill("Проверь сохранённый ключ");
    await page.getByRole("button", { name: "Отправить сообщение" }).click();
    await expect(page.getByRole("log")).toContainText(
      "Локальный ключ восстановлен",
    );
    expect(received).toEqual([`Bearer ${key}`]);
    expect(JSON.stringify(restored)).not.toContain(key);
  } finally {
    await app.close();
    api.closeAllConnections();
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await rm(userData, { recursive: true, force: true });
  }
});
