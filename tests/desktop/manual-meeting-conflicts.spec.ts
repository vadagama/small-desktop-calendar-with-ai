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

async function open(
  run: (app: ElectronApplication, page: Page) => Promise<void>,
) {
  const profile = await mkdtemp(join(tmpdir(), "small-manual-conflicts-"));
  const app = await _electron.launch({
    args: [
      ".",
      `--user-data-dir=${profile}`,
      "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
    ],
  });
  try {
    await mockSmall(app, "2099-10-29");
    const page = await app.firstWindow();
    await page.clock.setFixedTime(new Date("2099-10-29T00:00:00Z"));
    await page.reload();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page
      .getByRole("button", { name: "Профиль Small", exact: true })
      .click();
    await expect(page.getByLabel("Логин", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Пароль", { exact: true })).toHaveValue("");
    await page.getByLabel("Логин", { exact: true }).fill("employee-a");
    await page.getByLabel("Пароль", { exact: true }).fill("synthetic-password");
    await page
      .getByRole("button", { name: "Войти в Small", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Выйти из Small" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Закрыть профиль Small" }).click();
    await run(app, page);
    expect(errors).toEqual([]);
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((w) => w.isVisible()),
      ),
    ).toBe(false);
  } finally {
    await signOutOfApp(app);
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
}

test("manual creation asks before writing a conflicting meeting and preserves the form on cancel", async () => {
  await open(async (app, page) => {
    await page
      .getByRole("button", { name: "Создать событие", exact: true })
      .click();
    const form = page.getByRole("dialog", {
      name: "Новое событие",
      exact: true,
    });
    await form
      .getByLabel("Наименование", { exact: false })
      .fill("Ручная встреча с пересечениями");
    await form
      .getByLabel("Описание", { exact: true })
      .fill("Сохранить повестку");
    await form.getByLabel("Поиск участников", { exact: true }).fill("Тест");
    await form
      .getByRole("button", { name: "Найти сотрудников", exact: true })
      .click();
    await form.locator(".meeting-person-option").nth(1).click();
    await form.getByLabel("Дата", { exact: true }).fill("2099-10-29");
    await form.getByLabel("Начало", { exact: true }).fill("09:00");
    await form.getByLabel("Окончание", { exact: true }).fill("09:30");
    await form.getByRole("button", { name: "Создать", exact: true }).click();
    const confirm = page.getByRole("dialog", {
      name: "Есть пересечения",
      exact: true,
    });
    await expect(confirm).toContainText(
      "Вы действительно хотите создать встречу?",
    );
    const writes = () =>
      app.evaluate(
        () =>
          (globalThis as typeof globalThis & { syntheticMeetingWrites: number })
            .syntheticMeetingWrites,
      );
    expect(await writes()).toBe(0);
    await page.keyboard.press("Escape");
    await expect(confirm).toHaveCount(0);
    await expect(
      form.getByRole("textbox", { name: "Описание", exact: true }),
    ).toHaveValue("Сохранить повестку");
    await expect(form.getByLabel("Начало", { exact: true })).toHaveValue(
      "09:00",
    );
    await form.getByRole("button", { name: "Создать", exact: true }).click();
    await expect(confirm).toBeVisible();
    await expect(confirm.locator("h2")).toHaveCSS("font-size", "18px");
    await expect(confirm.locator("p")).toHaveCSS("font-size", "14px");
    const accept = confirm.getByRole("button", {
      name: "Создать встречу",
      exact: true,
    });
    await expect(accept).toHaveCSS("font-size", "14px");
    await page.screenshot({
      path: "test-results/desktop/manual-create-conflict.png",
    });
    await accept.focus();
    await page.keyboard.press("Enter");
    await expect(form).toHaveCount(0);
    expect(await writes()).toBe(1);
    expect(
      await app.evaluate(
        () =>
          (globalThis as typeof globalThis & { syntheticCreateForce: string })
            .syntheticCreateForce,
      ),
    ).toBe("true");
  });
});

test("manual editing translates backend conflicts into confirmation and saves once with consent", async () => {
  await open(async (app, page) => {
    await page.getByRole("button", { name: "День", exact: true }).click();
    await page
      .locator(".calendar-event")
      .filter({ hasText: "Синтетическая встреча A" })
      .click();
    const details = page.locator("dialog.small-event-details");
    await details.getByLabel("Действия со встречей").click();
    await page
      .getByRole("button", { name: "Редактировать", exact: true })
      .click();
    const form = page.getByRole("dialog", {
      name: "Редактирование события",
      exact: true,
    });
    await form
      .getByLabel("Наименование", { exact: false })
      .fill("Изменённая встреча с пересечениями");
    await app.evaluate(() => {
      (
        globalThis as typeof globalThis & { syntheticUpdateConflict: boolean }
      ).syntheticUpdateConflict = true;
    });
    await form.getByRole("button", { name: "Сохранить", exact: true }).click();
    const confirm = page.getByRole("dialog", {
      name: "Есть пересечения",
      exact: true,
    });
    await expect(confirm).toContainText(
      "Вы действительно хотите сохранить изменения встречи?",
    );
    await expect(confirm).toContainText("Тестовый участник");
    await confirm
      .getByRole("button", { name: "Вернуться", exact: true })
      .click();
    await expect(confirm).toHaveCount(0);
    await expect(form.getByLabel("Наименование", { exact: false })).toHaveValue(
      "Изменённая встреча с пересечениями",
    );
    const attempts = () =>
      app.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              syntheticUpdateForces: string[];
            }
          ).syntheticUpdateForces,
      );
    expect(await attempts()).toEqual(["false"]);
    await form.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(confirm).toBeVisible();
    await page.screenshot({
      path: "test-results/desktop/manual-edit-conflict.png",
    });
    await confirm
      .getByRole("button", { name: "Сохранить изменения", exact: true })
      .click();
    await expect(form).toHaveCount(0);
    expect(await attempts()).toEqual(["false", "false", "true"]);
    await expect(
      page
        .locator(".calendar-event")
        .filter({ hasText: "Изменённая встреча с пересечениями" }),
    ).toHaveCount(1);
  });
});
