import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockSmall } from "./fixtures/small-api.js";
import { calendarToday } from "../../src/shared/calendar-time.js";
type Inspection = typeof globalThis & {
  syntheticAuthStatus?: number;
  syntheticAuthOffline?: boolean;
  syntheticAuthDelayMs?: number;
};

test("authentication UI distinguishes verified, offline and expired sessions and preserves a meeting form", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-auth-states-"));
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
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page
      .getByRole("button", { name: "Профиль Small", exact: true })
      .click();
    const profile = page.locator(".small-account");
    await expect(profile.getByLabel("Логин", { exact: true })).toHaveValue("");
    await expect(profile.getByLabel("Пароль", { exact: true })).toHaveValue("");
    await expect(profile.getByLabel("Логин", { exact: true })).toHaveCSS(
      "font-size",
      "14px",
    );
    await page.screenshot({ path: "test-results/desktop/auth-empty.png" });
    await profile.getByLabel("Логин", { exact: true }).fill("employee-a");
    await profile.getByLabel("Пароль", { exact: true }).fill("stale-password");
    await profile.getByRole("button", { name: "Показать пароль" }).click();
    await expect(profile.getByLabel("Пароль", { exact: true })).toHaveAttribute(
      "type",
      "text",
    );
    // Browser/password-manager autofill can change the field without a React change event.
    await profile
      .getByLabel("Пароль", { exact: true })
      .evaluate((input: HTMLInputElement) => {
        input.value = "synthetic-password";
      });
    await profile
      .getByRole("button", { name: "Войти в Small", exact: true })
      .click();
    await expect(profile.getByRole("status")).toContainText("Вход подтверждён");
    await expect(
      page.locator(".small-account-trigger .small-auth-dot"),
    ).toHaveClass(/verified/);
    await expect(page.locator(".workspace-header .small-auth-dot")).toHaveCount(
      0,
    );
    await expect(profile.locator("h2")).toHaveCSS("font-size", "18px");
    await expect(
      profile.getByRole("button", { name: "Проверить доступ" }),
    ).toHaveCSS("font-size", "14px");
    await app.evaluate(() => {
      (globalThis as Inspection).syntheticAuthStatus = 503;
    });
    await profile.getByRole("button", { name: "Проверить доступ" }).click();
    await expect(profile).toContainText("Small временно недоступен");
    await expect(profile.locator("h2")).toHaveText("Профиль Small");
    await expect(profile.getByRole("alert")).toHaveCount(1);
    await expect(profile.getByRole("status")).toHaveCount(0);
    await expect(profile.locator(".small-account-name")).toHaveText(
      "employee-a",
    );
    await expect(profile.getByLabel("Пароль", { exact: true })).toHaveCount(0);
    await app.evaluate(() => {
      delete (globalThis as Inspection).syntheticAuthStatus;
    });
    await profile.getByRole("button", { name: "Повторить проверку" }).click();
    await expect(profile.getByRole("status")).toContainText("Вход подтверждён");
    await app.evaluate(() => {
      (globalThis as Inspection).syntheticAuthOffline = true;
    });
    await profile.getByRole("button", { name: "Проверить доступ" }).click();
    await expect(profile.getByRole("alert")).toContainText("Нет связи с Small");
    await expect(profile.getByRole("alert")).toContainText("VPN");
    await expect(profile.getByRole("alert")).toHaveCount(1);
    await expect(profile.getByRole("status")).toHaveCount(0);
    await expect(profile.getByLabel("Пароль", { exact: true })).toHaveCount(0);
    await expect(profile.locator(".small-account-name")).toHaveText(
      "employee-a",
    );
    await profile.screenshot({
      path: "test-results/desktop/auth-network-only.png",
    });
    await app.evaluate(() => {
      delete (globalThis as Inspection).syntheticAuthOffline;
    });
    await profile.getByRole("button", { name: "Повторить проверку" }).click();
    await expect(profile.getByRole("status")).toContainText("Вход подтверждён");
    await page.screenshot({ path: "test-results/desktop/auth-verified.png" });
    await profile
      .getByRole("button", { name: "Закрыть профиль Small" })
      .click();
    await page
      .getByRole("button", { name: "Создать событие", exact: true })
      .click();
    const meeting = page.getByRole("dialog", {
      name: "Новое событие",
      exact: true,
    });
    await meeting
      .getByPlaceholder("Введите наименование")
      .fill("Синтетический черновик");
    await app.evaluate(() => {
      (globalThis as Inspection).syntheticAuthStatus = 401;
    });
    await page.evaluate(() => window.smallDesktop.smallAuth.read());
    await expect(meeting).toContainText("Войдите повторно");
    await app.evaluate(() => {
      (globalThis as Inspection).syntheticAuthDelayMs = 400;
    });
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    // With no session the check can finish before an intermediate checking state renders.
    await expect(
      meeting.getByRole("button", { name: "Создать", exact: true }),
    ).toBeDisabled();
    await expect(
      page.locator(".small-account-trigger .small-auth-dot"),
    ).toHaveClass(/required/);
    await meeting
      .getByRole("button", {
        name: "Войти в Small — открыть форму",
        exact: true,
      })
      .click();
    await expect(profile).toContainText("Сессия Small завершена");
    await expect(profile).toContainText("Введите пароль для повторного входа");
    await expect(profile).toContainText("Пароль не сохраняется");
    await expect(profile.getByRole("status")).toHaveCount(1);
    await expect(profile.getByRole("alert")).toHaveCount(0);
    await expect(profile.getByLabel("Логин", { exact: true })).toHaveValue(
      "employee-a",
    );
    await expect(profile.getByLabel("Пароль", { exact: true })).toBeVisible();
    await profile.screenshot({
      path: "test-results/desktop/auth-required-fields.png",
    });
    await app.evaluate(() => {
      delete (globalThis as Inspection).syntheticAuthStatus;
    });
    await profile
      .getByLabel("Пароль", { exact: true })
      .fill("synthetic-password");
    await profile.getByRole("button", { name: "Войти повторно" }).click();
    await expect(profile.getByRole("status")).toContainText("Вход подтверждён");
    await profile
      .getByRole("button", { name: "Закрыть профиль Small" })
      .click();
    await expect(meeting.getByPlaceholder("Введите наименование")).toHaveValue(
      "Синтетический черновик",
    );
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
