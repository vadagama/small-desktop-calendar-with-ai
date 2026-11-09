import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockSmall } from "./fixtures/small-api.js";
import { signOutOfApp } from "./fixtures/keychain.js";

test("organizer is fixed, row selection clears search and debounce rejects stale queries", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-people-picker-"));
  const app = await _electron.launch({
    args: [
      ".",
      `--user-data-dir=${userData}`,
      "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
    ],
  });
  try {
    await mockSmall(app, "2099-10-29");
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.reload();
    await page
      .getByRole("button", { name: "Профиль Small", exact: true })
      .click();
    await expect(page.getByLabel("Логин", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Пароль", { exact: true })).toHaveValue("");
    const initial = await page.evaluate(async () => ({
      auth: await window.smallDesktop.smallAuth.read(),
      settings: await window.smallDesktop.agentSettings.read(),
      profiles: await window.smallDesktop.profiles.read(),
    }));
    expect(initial.auth.ok && initial.auth.state.status).toBe("signed-out");
    expect(initial.settings.ok && initial.settings.state.settings.mood).toBe(
      "neutral",
    );
    expect(
      initial.settings.ok && initial.settings.state.settings.instructions,
    ).toBe("");
    expect(
      initial.profiles.ok &&
        initial.profiles.state.profiles.every((p) => !p.hasKey),
    ).toBe(true);
    await page.getByLabel("Логин", { exact: true }).fill("employee-a");
    await page.getByLabel("Пароль", { exact: true }).fill("synthetic-password");
    await page
      .getByRole("button", { name: "Войти в Small", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Выйти из Small" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Закрыть профиль Small" }).click();
    const memory = await page.evaluate(() => window.smallDesktop.memory.read());
    expect(memory.ok).toBe(true);
    if (memory.ok) {
      expect(memory.state.preferences).toEqual({});
      expect(memory.state.entries).toEqual([]);
      expect(memory.state.groups).toEqual([]);
      expect(memory.state.presets).toEqual([]);
    }
    await page
      .getByRole("button", { name: "Создать событие", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Новое событие",
      exact: true,
    });
    const picker = dialog.locator(".meeting-people-picker").first();
    const input = picker.getByLabel("Поиск участников", { exact: true });
    const options = picker.locator(".meeting-person-option");
    await expect(
      picker.getByRole("button", { name: "Убрать employee-a" }),
    ).toHaveCount(0);
    await expect(picker.getByRole("checkbox")).toHaveCount(0);
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (w) => !w.isVisible() && !w.isFocused(),
        ),
      ),
    ).toBe(true);
    const queries = () =>
      app.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              syntheticPeopleQueries?: string[];
            }
          ).syntheticPeopleQueries ?? [],
      );
    await page.clock.install({ time: new Date("2099-10-29T00:00:00Z") });
    await page.clock.pauseAt(new Date("2099-10-29T00:01:00Z"));
    await input.fill("Т");
    await page.clock.runFor(200);
    await input.fill("Тест");
    await page.clock.runFor(299);
    expect(await queries()).toEqual([]);
    await page.clock.runFor(1);
    await expect(options).toHaveCount(2);
    await expect(picker.getByRole("checkbox")).toHaveCount(0);
    expect(await queries()).toEqual(["Тест"]);
    await input.press("ArrowDown");
    await page.clock.runFor(17);
    await expect(options.first()).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(input).toHaveValue("");
    await expect(input).toBeFocused();
    await expect(options).toHaveCount(0);
    await expect(picker.locator(".meeting-chips")).toContainText(
      "Тестовый сотрудник",
    );
    await page.clock.runFor(1000);
    expect(await queries()).toEqual(["Тест"]);
    await input.fill("Тест");
    await input.press("Enter");
    await expect(options).toHaveCount(1);
    await expect(options.first()).toContainText("Отдел B");
    await options.first().click();
    await expect(input).toHaveValue("");
    await expect(picker.locator(".meeting-chips > span")).toHaveCount(3);
    await input.fill("Тест");
    await input.press("Enter");
    await picker.getByRole("button", { name: "Следующая страница" }).click();
    await expect(options).toHaveCount(1);
    await options.first().click();
    await expect(picker.locator(".meeting-chips")).toContainText(
      "Другой сотрудник",
    );
    await expect(input).toHaveValue("");
    await picker
      .getByRole("button", { name: "Убрать Другой сотрудник" })
      .click();
    await expect(picker.locator(".meeting-chips")).not.toContainText(
      "Другой сотрудник",
    );
    await input.fill("пусто");
    await input.press("Enter");
    await expect(picker).toContainText("Не найдено");
    await page.clock.runFor(600);
    expect((await queries()).filter((q) => q === "пусто")).toHaveLength(1);
    await app.evaluate(() => {
      (
        globalThis as typeof globalThis & { syntheticPeopleDelayMs: number }
      ).syntheticPeopleDelayMs = 500;
    });
    await input.fill("медленно");
    await page.clock.runFor(300);
    await expect.poll(queries).toContain("медленно");
    await input.fill("");
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                syntheticPeopleCompleted?: string[];
              }
            ).syntheticPeopleCompleted ?? [],
        ),
      )
      .toContain("медленно");
    await expect(options).toHaveCount(0);
    await expect(picker.locator(".meeting-people-results")).toHaveCount(0);
    await input.fill("несохранённый запрос");
    await page.clock.runFor(100);
    await input.fill("");
    await page.clock.runFor(600);
    expect(await queries()).not.toContain("несохранённый запрос");
    await input.fill("Тест");
    await input.press("Enter");
    await picker.getByRole("button", { name: "Следующая страница" }).click();
    await expect(options).toHaveCount(1);
    await expect(options.first()).toHaveCSS("font-size", "13px");
    await picker.screenshot({ path: "test-results/desktop/people-picker.png" });
    await page.clock.resume();
    expect(errors).toEqual([]);
  } finally {
    await signOutOfApp(app);
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
