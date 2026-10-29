import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockSmall } from "./fixtures/small-api.js";
import { signOutOfApp } from "./fixtures/keychain.js";
import { calendarToday } from "../../src/shared/calendar-time.js";

test("the calendar follows server changes without a refresh and keeps data on screen while renewing", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-sync-"));
  const app = await _electron.launch({
    args: [
      ".",
      `--user-data-dir=${userData}`,
      "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
    ],
    env: { ...process.env, SMALL_TEST_SYNC_INTERVAL_MS: "300" },
  });
  try {
    const date = calendarToday();
    await mockSmall(app, date);
    const serve = (extra: Record<string, unknown>) =>
      app.evaluate((_electron, value) => {
        (
          globalThis as typeof globalThis & {
            syntheticEventExtra: Record<string, unknown>;
          }
        ).syntheticEventExtra = value;
      }, extra);
    await serve({
      title: "Первое название",
      starts_at: `${date}T09:00:00+05:00`,
      ends_at: `${date}T09:30:00+05:00`,
    });
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
    const event = page
      .locator(".calendar-event")
      .filter({ hasText: "Первое название" });
    await expect(event).toContainText("09:00 – 09:30");
    await expect(page.locator(".calendar-freshness")).toContainText(
      "Обновлено",
    );
    // Keep the card open: its owner's changes must be announced.
    await event.click();
    const details = page.getByRole("dialog", { name: "Первое название" });
    await expect(details).toBeVisible();

    // Remember whether the loading screen ever appears from now on.
    await page.evaluate(() => {
      const seen = window as typeof window & { sawLoading?: boolean };
      seen.sawLoading = false;
      new MutationObserver(() => {
        if (document.body.innerText.includes("Загружаю календарь Small"))
          seen.sawLoading = true;
      }).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });
    const sawLoading = () =>
      page.evaluate(
        () => (window as typeof window & { sawLoading?: boolean }).sawLoading,
      );

    // The server moves and renames the meeting; nobody presses "Обновить".
    await serve({
      title: "Название с сервера",
      starts_at: `${date}T10:00:00+05:00`,
      ends_at: `${date}T10:30:00+05:00`,
    });
    const changed = page
      .locator(".calendar-event")
      .filter({ hasText: "Название с сервера" });
    await expect(changed).toContainText("10:00 – 10:30");
    await expect(changed).toHaveAttribute("data-change", "moved");
    await expect(details.locator(".event-remote-change")).toContainText(
      "изменилось на сервере",
    );
    // The highlight is temporary.
    await expect(changed).not.toHaveAttribute("data-change", /.+/);
    await page.keyboard.press("Escape");
    await expect(details).toHaveCount(0);
    await expect(
      page.locator(".calendar-event").filter({ hasText: "Первое название" }),
    ).toHaveCount(0);

    expect(await sawLoading()).toBe(false);

    // A manual refresh keeps the events on screen.
    await serve({
      title: "Вручную обновлено",
      starts_at: `${date}T10:00:00+05:00`,
      ends_at: `${date}T10:30:00+05:00`,
    });
    await page.getByRole("button", { name: "Обновить календарь" }).click();
    await expect(
      page.locator(".calendar-event").filter({ hasText: "Вручную обновлено" }),
    ).toBeVisible();
    await expect(page.locator(".calendar-freshness")).toContainText(
      "Обновлено только что",
    );
    expect(await sawLoading()).toBe(false);
    // The sidebar button does the same.
    await serve({
      title: "Через панель",
      starts_at: `${date}T10:00:00+05:00`,
      ends_at: `${date}T10:30:00+05:00`,
    });
    await page.getByRole("button", { name: "Обновить", exact: true }).click();
    await expect(
      page.locator(".calendar-event").filter({ hasText: "Через панель" }),
    ).toBeVisible();

    // Returning to a range that was already loaded does not show the loading screen.
    await page.getByRole("button", { name: "Следующий период" }).click();
    // A range that was never opened legitimately loads first.
    await expect(
      page.getByText("В этом периоде встреч нет.", { exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      (window as typeof window & { sawLoading?: boolean }).sawLoading = false;
    });
    await page.getByRole("button", { name: "Предыдущий период" }).click();
    await expect(
      page.locator(".calendar-event").filter({ hasText: "Через панель" }),
    ).toBeVisible();
    expect(await sawLoading()).toBe(false);

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
