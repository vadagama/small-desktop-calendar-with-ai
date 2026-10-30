import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockSmall } from "./fixtures/small-api.js";
import { signOutOfApp } from "./fixtures/keychain.js";
import { calendarToday } from "../../src/shared/calendar-time.js";

test("refresh gives visible feedback for slow, failed and instant replies", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-refresh-"));
  const app = await _electron.launch({
    args: [
      ".",
      `--user-data-dir=${userData}`,
      "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
    ],
    env: { ...process.env, SMALL_TEST_SYNC_INTERVAL_MS: "600000" },
  });
  try {
    await mockSmall(app, calendarToday());
    const page = await app.firstWindow();
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
    await expect(page.locator(".calendar-event").first()).toBeVisible();
    const refresh = page.locator(".small-sidebar-footer button");
    const icon = refresh.locator("svg");
    await expect(refresh).toHaveCSS("font-size", "12px");
    for (const status of [0, 503]) {
      await app.evaluate((_electron, status) => {
        const state = globalThis as typeof globalThis & {
          syntheticListDelayMs: number;
          syntheticListStatus: number;
        };
        state.syntheticListDelayMs = 1200;
        state.syntheticListStatus = status;
      }, status);
      await refresh.click();
      await expect(refresh).toHaveAttribute("aria-busy", "true");
      await expect(refresh).toBeDisabled();
      await expect(icon).toHaveCSS("animation-name", "freshness-spin");
      if (status === 0)
        await refresh.screenshot({ path: "/tmp/small-refresh-feedback.png" });
      await expect(refresh).toHaveAttribute("aria-busy", "false");
      await expect(refresh).toBeEnabled();
    }
    await app.evaluate(() => {
      const state = globalThis as typeof globalThis & {
        syntheticListDelayMs: number;
        syntheticListStatus: number;
      };
      state.syntheticListDelayMs = 0;
      state.syntheticListStatus = 0;
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await refresh.click();
    await expect(refresh).toHaveAttribute("aria-busy", "true");
    await expect(refresh).toContainText("Обновление");
    await expect(icon).toHaveCSS("animation-name", "none");
    await expect(refresh).toHaveAttribute("aria-busy", "false");
    await expect(refresh).toHaveText("Обновить");
  } finally {
    await signOutOfApp(app);
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
