// Run after npm run build:desktop: node --import tsx scripts/capture-help.mjs
// Only synthetic Small responses are used. The isolated profile is removed on exit.
import { _electron, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockSmall } from "../tests/desktop/fixtures/small-api.ts";
import { calendarToday } from "../src/shared/calendar-time.ts";

const userData = await mkdtemp(join(tmpdir(), "small-guide-images-"));
const app = await _electron.launch({
  args: [
    ".",
    `--user-data-dir=${userData}`,
    "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
  ],
  env: { ...process.env, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
});
try {
  await mockSmall(app, calendarToday());
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "Напоминания", exact: true }).click();
  const reminders = page.getByRole("dialog", {
    name: "Напоминания",
    exact: true,
  });
  await expect(
    reminders.getByRole("button", { name: "Сохранить напоминания" }),
  ).toBeVisible();
  await reminders.screenshot({
    path: "resources/renderer/help/notifications.png",
  });
  await page.getByRole("button", { name: "Закрыть напоминания" }).click();
  await page
    .getByRole("button", { name: "Настройки AI-помощника", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Настройки AI-помощника" });
  await expect(settings.getByLabel("Ваши инструкции")).toBeVisible();
  await settings.screenshot({ path: "resources/renderer/help/settings.png" });
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Профиль Small", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Вход в Small", exact: true })
    .screenshot({ path: "resources/renderer/help/auth.png" });
  await page.getByRole("button", { name: "Закрыть профиль Small" }).click();
  await page
    .getByRole("button", { name: "Настройки модели", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Настройки модели", exact: true })
    .screenshot({ path: "resources/renderer/help/llm.png" });
  await page.getByRole("button", { name: "Закрыть настройки модели" }).click();
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
  await expect(page.locator(".calendar-event")).toHaveCount(2);
  await page.screenshot({ path: "resources/renderer/help/workspace.png" });
  await page.locator(".calendar-event").first().click();
  await page
    .getByRole("dialog")
    .screenshot({ path: "resources/renderer/help/event.png" });
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Память ассистента", exact: true })
    .click();
  const memory = page.getByRole("dialog", { name: "Память", exact: true });
  await expect(
    memory.getByRole("region", { name: "Группы участников", exact: true }),
  ).toBeVisible();
  await expect(
    memory.getByText("Пока нет сохранённых записей", { exact: true }),
  ).toBeVisible();
  await expect(
    memory.getByText("Пока нет сохранённых групп", { exact: true }),
  ).toBeVisible();
  await expect(
    memory.getByText("Пока нет сохранённых форматов", { exact: true }),
  ).toBeVisible();
  await memory.screenshot({ path: "resources/renderer/help/memory.png" });
  console.log("Captured guide images from Electron using synthetic data.");
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true });
}
