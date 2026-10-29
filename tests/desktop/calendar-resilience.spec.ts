import {
  _electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockSmall } from "./fixtures/small-api.js";
import { signOutOfApp } from "./fixtures/keychain.js";
import { calendarToday } from "../../src/shared/calendar-time.js";

type Inspection = typeof globalThis & {
  syntheticEventExtra: Record<string, unknown>;
  syntheticListStatus?: number;
};

async function open(
  run: (context: {
    app: ElectronApplication;
    page: Page;
    date: string;
  }) => Promise<void>,
) {
  const userData = await mkdtemp(join(tmpdir(), "small-resilience-"));
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
    await app.evaluate((_electron, day) => {
      (globalThis as Inspection).syntheticEventExtra = {
        title: "Устойчивая встреча",
        starts_at: `${day}T09:00:00+05:00`,
        ends_at: `${day}T09:30:00+05:00`,
      };
    }, date);
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
    await expect(
      page.locator(".calendar-event").filter({ hasText: "Устойчивая встреча" }),
    ).toContainText("09:00 – 09:30");
    await run({ app, page, date });
  } finally {
    await signOutOfApp(app);
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
}
const serve = (app: ElectronApplication, status: number | null) =>
  app.evaluate((_electron, value) => {
    const inspected = globalThis as Inspection;
    if (value === null) delete inspected.syntheticListStatus;
    else inspected.syntheticListStatus = value;
  }, status);

test("when Small stops answering the data stays on screen with a warning, and recovery is announced", async () => {
  await open(async ({ app, page }) => {
    const card = page
      .locator(".calendar-event")
      .filter({ hasText: "Устойчивая встреча" });
    const bar = page.locator(".calendar-freshness");
    // While everything works the panel is not shown at all.
    await expect(bar).toHaveCount(0);
    await serve(app, 503);
    await expect(bar).toContainText("Нет связи с Small. Данные на");
    await expect(bar).toHaveAttribute("role", "status");
    // Nothing is hidden and nothing is invented: the confirmed data is still shown.
    await expect(card).toContainText("09:00 – 09:30");
    await expect(page.getByText("Загружаю календарь Small…")).toHaveCount(0);
    await serve(app, null);
    // Contact is back: the warning goes away on its own.
    await expect(bar).toHaveCount(0);
    await expect(card).toContainText("09:00 – 09:30");
  });
});

test("an expired session in the background sends the user back to sign-in", async () => {
  await open(async ({ app, page }) => {
    await serve(app, 401);
    await expect(
      page.getByText("Войдите в Small через кнопку профиля внизу слева."),
    ).toBeVisible();
    await expect(page.locator(".calendar-event")).toHaveCount(0);
  });
});

test("with reduced motion a change is marked by a static outline, not an animation", async () => {
  await open(async ({ app, page, date }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await app.evaluate((_electron, day) => {
      (globalThis as Inspection).syntheticEventExtra = {
        title: "Устойчивая встреча",
        starts_at: `${day}T10:00:00+05:00`,
        ends_at: `${day}T10:30:00+05:00`,
      };
    }, date);
    const moved = page
      .locator(".calendar-event")
      .filter({ hasText: "10:00 – 10:30" });
    await expect(moved).toHaveAttribute("data-change", "moved");
    await expect(moved).toHaveCSS("animation-name", "none");
    await expect(moved).toHaveCSS("outline-style", "solid");
    await expect(moved).not.toHaveAttribute("data-change", /.+/);
  });
});
