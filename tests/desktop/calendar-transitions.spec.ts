import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockSmall } from "./fixtures/small-api.js";
import { signOutOfApp } from "./fixtures/keychain.js";
import { calendarToday } from "../../src/shared/calendar-time.js";

type Spy = { calls: number; finished: number; skipped: number };
type SpiedWindow = typeof window & { transitions: Spy };

test("a real server change runs one view transition and silent revalidations run none", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-transitions-"));
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
      title: "Событие для перехода",
      starts_at: `${date}T09:00:00+05:00`,
      ends_at: `${date}T09:30:00+05:00`,
    });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
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
    await page.getByRole("button", { name: "День", exact: true }).click();
    const card = page
      .locator(".calendar-event")
      .filter({ hasText: "Событие для перехода" });
    await expect(card).toContainText("09:00 – 09:30");
    await page.evaluate(() => {
      const spied = window as SpiedWindow;
      spied.transitions = { calls: 0, finished: 0, skipped: 0 };
      const original = document.startViewTransition.bind(document);
      document.startViewTransition = (callback) => {
        spied.transitions.calls++;
        const transition = original(callback);
        transition.finished.then(
          () => spied.transitions.finished++,
          () => spied.transitions.skipped++,
        );
        return transition;
      };
    });
    const spy = () => page.evaluate(() => (window as SpiedWindow).transitions);

    // About five polls pass without any change: nothing may animate.
    await page.waitForTimeout(1500);
    expect(await spy()).toEqual({ calls: 0, finished: 0, skipped: 0 });

    await serve({
      title: "Событие для перехода",
      starts_at: `${date}T10:00:00+05:00`,
      ends_at: `${date}T10:30:00+05:00`,
    });
    await expect(card).toContainText("10:00 – 10:30");
    await expect.poll(async () => (await spy()).finished).toBe(1);
    // Further idle polls stay silent and the page stays interactive.
    await page.waitForTimeout(900);
    expect(await spy()).toEqual({ calls: 1, finished: 1, skipped: 0 });
    await card.click();
    await expect(
      page.getByRole("dialog", { name: "Событие для перехода" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await signOutOfApp(app);
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
