import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockSmall } from "./fixtures/small-api.js";
import { signOutOfApp } from "./fixtures/keychain.js";
import { calendarToday } from "../../src/shared/calendar-time.js";

type Inspection = typeof globalThis & { syntheticListStatus?: number };

test("after a restart the events are on screen from the cache while Small cannot be reached", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-cache-restart-"));
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
    const date = calendarToday();
    await mockSmall(app, date);
    let page = await app.firstWindow();
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
    // The default week view is what the next start opens as well.
    const card = () =>
      page
        .locator(".calendar-event")
        .filter({ hasText: "Синтетическая встреча A" });
    await expect(card()).toBeVisible();
    await app.close();

    app = await launch();
    await mockSmall(app, date);
    // Small is unreachable for event lists, so the events can only come from the cache.
    // (A slow answer instead would hold up sign-in checks that queue behind it.)
    await app.evaluate(() => {
      (globalThis as Inspection).syntheticListStatus = 503;
    });
    page = await app.firstWindow();
    // Startup restoration can race the test's handler; an explicit read settles it.
    await page.evaluate(() => window.smallDesktop.smallAuth.read());
    await page
      .getByRole("button", { name: "Профиль Small", exact: true })
      .click();
    if (await page.getByRole("button", { name: "Повторить проверку" }).count())
      await page.getByRole("button", { name: "Повторить проверку" }).click();
    await page.getByRole("button", { name: "Закрыть профиль Small" }).click();
    await expect(card()).toBeVisible({ timeout: 5000 });
    // What Small could not confirm does not replace what was confirmed earlier.
    await expect(page.locator(".calendar-warning")).toHaveCount(0);

    // Signing out afterwards leaves nothing for the next start.
    await page
      .getByRole("button", { name: "Профиль Small", exact: true })
      .click();
    await page.getByRole("button", { name: "Выйти из Small" }).click();
  } finally {
    await signOutOfApp(app);
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
