import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { AsyncEntry } from "@napi-rs/keyring";
import { mockSmall } from "./fixtures/small-api.js";
import { calendarToday } from "../../src/shared/calendar-time.js";

test("Small account uses isolated session and Keychain, restores after restart and logs out", async () => {
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
    await expect(page.getByLabel("Пароль", { exact: true })).toHaveValue("");
    await page.getByLabel("Пароль", { exact: true }).fill("synthetic-password");
    await page
      .getByRole("button", { name: "Войти в Small", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Выйти из Small" }),
    ).toBeVisible();
    await expect(page.locator("dialog strong")).toHaveText("employee-a");
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
    await page.screenshot({ path: "test-results/desktop/small-profile.png" });
    expect(errors).toEqual([]);
    await app.close();
    app = await launch();
    // Startup restoration can race this test handler; an explicit read retries safely.
    await mockSmall(app, calendarToday());
    page = await app.firstWindow();
    const restored = await page.evaluate(() =>
      window.smallDesktop.smallAuth.read(),
    );
    expect(restored).toMatchObject({
      ok: true,
      state: { status: "signed-in", profile: { id: "employee-a" } },
    });
    await page
      .getByRole("button", { name: "Профиль Small", exact: true })
      .click();
    if (
      await page.getByRole("button", { name: "Повторить проверку" }).count()
    ) {
      await page.getByRole("button", { name: "Повторить проверку" }).click();
    }
    await page.getByRole("button", { name: "Выйти из Small" }).click();
    await expect(
      page.getByRole("button", { name: "Войти в Small", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => window.smallDesktop.smallAuth.read()),
    ).toEqual({ ok: true, state: { status: "signed-out" } });
    expect(
      await app.evaluate(
        async ({ session }) =>
          (await session.fromPartition("small-auth").cookies.get({})).length,
      ),
    ).toBe(0);
  } finally {
    // Remove only the synthetic credential in this test's namespace.
    const service = `kz.small.desktop-calendar.llm.${createHash("sha256").update(userData).digest("hex").slice(0, 24)}`;
    try {
      await new AsyncEntry(service, "small-auth-session-v1").deleteCredential();
    } catch {
      /* Missing after logout. */
    }
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
