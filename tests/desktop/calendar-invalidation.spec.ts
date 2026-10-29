import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockSmall } from "./fixtures/small-api.js";
import { signOutOfApp } from "./fixtures/keychain.js";
import { calendarToday } from "../../src/shared/calendar-time.js";

type Inspection = typeof globalThis & {
  syntheticEventExtra: Record<string, unknown>;
  syntheticListRequests?: number;
};

test("a write renews only the ranges it may have changed; others stay served from the cache", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-invalidation-"));
  const app = await _electron.launch({
    args: [
      ".",
      `--user-data-dir=${userData}`,
      "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
    ],
    // No polling: only the user's actions reach Small.
    env: { ...process.env, SMALL_TEST_SYNC_INTERVAL_MS: "600000" },
  });
  try {
    const date = calendarToday();
    await mockSmall(app, date);
    await app.evaluate((_electron, day) => {
      (globalThis as Inspection).syntheticEventExtra = {
        starts_at: `${day}T09:00:00+05:00`,
        ends_at: `${day}T09:30:00+05:00`,
      };
    }, date);
    const requests = () =>
      app.evaluate(() => (globalThis as Inspection).syntheticListRequests ?? 0);
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
    await page.getByRole("button", { name: "День", exact: true }).click();
    const card = page
      .locator(".calendar-event")
      .filter({ hasText: "Синтетическая встреча A" });
    await expect(card).toContainText("09:00 – 09:30");

    // Tomorrow is loaded once, then today again from what is already known.
    await page.getByRole("button", { name: "Следующий период" }).click();
    await expect(
      page.getByText("В этом периоде встреч нет.", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Предыдущий период" }).click();
    await expect(card).toContainText("09:00 – 09:30");

    // Move today's meeting: today's range must be renewed from Small.
    const before = await requests();
    await card.hover();
    const box = (await card.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 16, { steps: 8 });
    await page.mouse.up();
    await expect(card).toContainText("09:15 – 09:45");
    await expect(page.getByText("Время события изменено")).toBeVisible();
    await expect.poll(requests).toBeGreaterThan(before);

    // Tomorrow cannot have changed: no request, and no loading screen either.
    await page.waitForTimeout(500);
    const afterWrite = await requests();
    await page.getByRole("button", { name: "Следующий период" }).click();
    await expect(
      page.getByText("В этом периоде встреч нет.", { exact: true }),
    ).toBeVisible();
    await page.waitForTimeout(500);
    expect(await requests()).toBe(afterWrite);

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
