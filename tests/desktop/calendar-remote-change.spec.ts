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
  syntheticEventRemoved?: boolean;
  syntheticDetailDelayMs?: number;
};

async function open(
  run: (context: {
    app: ElectronApplication;
    page: Page;
    date: string;
  }) => Promise<void>,
) {
  const userData = await mkdtemp(join(tmpdir(), "small-remote-"));
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
        title: "Исходное название",
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
    await run({ app, page, date });
  } finally {
    await signOutOfApp(app);
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
}
async function startEditing(page: Page) {
  await page
    .locator(".calendar-event")
    .filter({ hasText: "Исходное название" })
    .click();
  // The dialog is named after the event, so it is found by class, not by name.
  const details = page.locator("dialog.small-event-details");
  await expect(details).toBeVisible();
  await details.getByLabel("Действия со встречей").click();
  await page
    .getByRole("button", { name: "Редактировать", exact: true })
    .click();
  const field = details.getByLabel("Новое название");
  await field.fill("Моя правка");
  return { details, field };
}

test("a change on the server is announced on the open card and the form being filled in survives", async () => {
  await open(async ({ app, page, date }) => {
    const { details, field } = await startEditing(page);
    await app.evaluate((_electron, day) => {
      (globalThis as Inspection).syntheticEventExtra = {
        title: "Название с сервера",
        starts_at: `${day}T09:00:00+05:00`,
        ends_at: `${day}T09:30:00+05:00`,
      };
    }, date);
    await expect(details.locator(".event-remote-change")).toContainText(
      "Событие изменилось на сервере",
    );
    // The announcement does not touch what the user typed or what the card shows.
    await expect(field).toHaveValue("Моя правка");
    await expect(details).toBeVisible();
    // The card is read again over a slow round trip, as with a real Small.
    await app.evaluate(() => {
      (globalThis as Inspection).syntheticDetailDelayMs = 800;
    });
    await details.getByRole("button", { name: "Обновить карточку" }).click();
    await page.waitForTimeout(300);
    await expect(field).toBeVisible();
    await expect(field).toHaveValue("Моя правка");
    await expect(
      page.getByRole("dialog", { name: "Название с сервера" }),
    ).toBeVisible();
    await expect(field).toHaveValue("Моя правка");
    await expect(details.locator(".event-remote-change")).toHaveCount(0);
    await expect(
      details.getByRole("button", { name: "Сохранить", exact: true }),
    ).toBeEnabled();
  });
});

test("an event that is gone from Small locks the open card after it is checked", async () => {
  await open(async ({ app, page }) => {
    const { details, field } = await startEditing(page);
    await app.evaluate(() => {
      (globalThis as Inspection).syntheticEventRemoved = true;
    });
    await expect(details.locator(".event-remote-change")).toContainText(
      "больше не показано в этом периоде",
    );
    // Disappearing from the range proves nothing yet: the card stays usable.
    await expect(field).toBeEnabled();
    await details.getByRole("button", { name: "Обновить карточку" }).click();
    await expect(details.locator(".event-remote-change")).toContainText(
      "удалено или отменено на сервере",
    );
    await expect(field).toBeDisabled();
    await expect(field).toHaveValue("Моя правка");
    await expect(
      details.getByRole("button", { name: "Сохранить", exact: true }),
    ).toBeDisabled();
    await details.getByLabel("Действия со встречей").click();
    await expect(
      page.getByRole("button", { name: "Удалить", exact: true }),
    ).toBeDisabled();
  });
});
