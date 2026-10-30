import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockSmall } from "./fixtures/small-api.js";
import { createHash } from "node:crypto";
import { LocalCipher } from "../../src/main/local-secrets.js";
import { calendarToday } from "../../src/shared/calendar-time.js";

test("Small account uses isolated session and encrypted local storage, restores after restart and logs out", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-auth-e2e-"));
  const executablePath = process.env.SMALL_APP_EXECUTABLE;
  const launch = () =>
    _electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: [
        ...(executablePath ? [] : ["."]),
        `--user-data-dir=${userData}`,
        "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
      ],
      env: { ...process.env, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
    });
  let app = await launch();
  try {
    await mockSmall(app, calendarToday());
    let page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page
      .getByRole("button", { name: "Профиль Small", exact: true })
      .click();
    await page.getByLabel("Логин", { exact: true }).fill("employee-a");
    await page.getByLabel("Пароль", { exact: true }).fill("wrong");
    await page
      .getByRole("button", { name: "Войти в Small", exact: true })
      .click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "Логин или пароль",
    );
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveCount(1);
    await expect(page.getByRole("dialog").getByRole("status")).toHaveCount(0);
    await expect(page.getByLabel("Пароль", { exact: true })).toHaveValue("");
    await page.getByLabel("Пароль", { exact: true }).fill("synthetic-password");
    await page
      .getByRole("button", { name: "Войти в Small", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Выйти из Small" }),
    ).toBeVisible();
    await expect(page.locator(".small-account-name")).toHaveText("employee-a");
    const state = await page.evaluate(() =>
      window.smallDesktop.smallAuth.read(),
    );
    expect(JSON.stringify(state)).not.toMatch(
      /access_token|synthetic-refresh|synthetic-password/,
    );
    expect(
      await app.evaluate(
        async ({ session }) =>
          (await session.defaultSession.cookies.get({})).length,
      ),
    ).toBe(0);
    const secretFiles = await readdir(join(userData, "local-vault", "secrets"));
    expect(secretFiles.some((name) => name.endsWith(".enc"))).toBe(true);
    for (const name of secretFiles) {
      const bytes = await readFile(
        join(userData, "local-vault", "secrets", name),
      );
      expect(bytes.includes(Buffer.from("synthetic-password"))).toBe(false);
    }
    const stored = await readFile(
      join(
        userData,
        "local-vault",
        "secrets",
        createHash("sha256").update("small-auth-session-v1").digest("hex") +
          ".enc",
      ),
    );
    const decoded = await new LocalCipher(join(userData, "local-vault")).open(
      stored,
      "secret:small-auth-session-v1",
    );
    expect(decoded).not.toContain("synthetic-password");
    expect(JSON.parse(decoded)).toMatchObject({
      version: 3,
      username: "employee-a",
    });
    await page.screenshot({ path: "test-results/desktop/small-profile.png" });
    expect(errors).toEqual([]);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Профиль Small", exact: true })
      .click();
    const disconnected = page.locator(".small-account");
    await expect(disconnected.getByRole("alert")).toContainText(
      "Нет связи с Small",
    );
    await expect(disconnected.getByRole("alert")).toHaveCount(1);
    await expect(disconnected.getByRole("status")).toHaveCount(0);
    await expect(page.locator(".main-shell .small-auth-notice")).toHaveCount(0);
    await expect(
      disconnected.getByLabel("Пароль", { exact: true }),
    ).toHaveCount(0);
    await mockSmall(app, calendarToday());
    await disconnected
      .getByRole("button", { name: "Повторить проверку" })
      .click();
    await expect(disconnected.getByRole("status")).toContainText(
      "Вход подтверждён",
    );
    await app.evaluate(() => {
      (
        globalThis as typeof globalThis & { syntheticSessionExpired: boolean }
      ).syntheticSessionExpired = true;
    });
    const restored = await page.evaluate(() =>
      window.smallDesktop.smallAuth.read(),
    );
    expect(restored).toMatchObject({
      ok: true,
      state: {
        status: "signed-out",
        username: "employee-a",
        reason: "expired",
      },
    });
    await expect(disconnected.getByRole("status")).toContainText(
      "Введите пароль",
    );
    await expect(disconnected.getByLabel("Логин", { exact: true })).toHaveValue(
      "employee-a",
    );
    await expect(
      disconnected.getByLabel("Пароль", { exact: true }),
    ).toHaveValue("");
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await mockSmall(app, calendarToday());
    await page
      .getByRole("button", { name: "Профиль Small", exact: true })
      .click();
    await expect(page.getByRole("dialog").getByRole("status")).toContainText(
      "Введите пароль",
    );
    await expect(page.getByLabel("Логин", { exact: true })).toHaveValue(
      "employee-a",
    );
    await expect(page.getByLabel("Пароль", { exact: true })).toHaveValue("");
    await page.getByLabel("Пароль", { exact: true }).fill("synthetic-password");
    await page
      .getByRole("button", { name: "Войти повторно", exact: true })
      .click();
    await page.getByRole("button", { name: "Выйти из Small" }).click();
    await expect(
      page.getByRole("button", { name: "Войти в Small", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => window.smallDesktop.smallAuth.read()),
    ).toEqual({
      ok: true,
      state: { status: "signed-out", username: "employee-a" },
    });
    expect(
      await app.evaluate(
        async ({ session }) =>
          (await session.fromPartition("small-auth").cookies.get({})).length,
      ),
    ).toBe(0);
    await expect(page.getByLabel("Логин", { exact: true })).toHaveValue(
      "employee-a",
    );
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
