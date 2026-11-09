import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockSmall } from "./fixtures/small-api.js";

test("time picker opens at the current time and duration helpers support midnight", async () => {
  const profile = await mkdtemp(join(tmpdir(), "small-meeting-time-"));
  const app = await _electron.launch({
    args: [".", `--user-data-dir=${profile}`],
  });
  try {
    await mockSmall(app, "2099-10-29");
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2099-10-29T00:00:00Z"));
    await page.reload();
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
    await page
      .getByRole("button", { name: "Создать событие", exact: true })
      .click();
    const form = page.getByRole("dialog", {
      name: "Новое событие",
      exact: true,
    });
    const start = form.getByLabel("Начало", { exact: true });
    const end = form.getByLabel("Окончание", { exact: true });
    await start.fill("14:00");
    await form
      .getByRole("button", { name: "Выбрать время: начало", exact: true })
      .click();
    const list = page.getByRole("listbox", {
      name: "Время: начало",
      exact: true,
    });
    const selected = list.getByRole("option", { name: "14:00", exact: true });
    await expect(selected).toHaveAttribute("aria-selected", "true");
    expect(
      await selected.evaluate((el) => {
        const item = el.getBoundingClientRect(),
          menu = el.parentElement!.getBoundingClientRect();
        return item.top >= menu.top && item.bottom <= menu.bottom;
      }),
    ).toBe(true);
    expect(await selected.evaluate((el) => getComputedStyle(el).fontSize)).toBe(
      "12px",
    );
    await start.press("ArrowDown");
    await start.press("Enter");
    await expect(start).toHaveValue("14:15");
    await expect(list).not.toBeVisible();
    await start.press("ArrowDown");
    await start.press("Escape");
    await expect(list).not.toBeVisible();
    await expect(form).toBeVisible();
    await start.fill("14:00");
    const helpers = form.getByRole("group", { name: "Длительность встречи" });
    for (const [label, expected] of [
      ["15 мин", "14:15"],
      ["Полчаса", "14:30"],
      ["Час", "15:00"],
      ["Полтора", "15:30"],
      ["2 часа", "16:00"],
    ]) {
      const button = helpers.getByRole("button", { name: label!, exact: true });
      await button.click();
      await expect(end).toHaveValue(expected!);
      await expect(button).toHaveAttribute("aria-pressed", "true");
    }
    await end.fill("16:10");
    await expect(helpers.locator('[aria-pressed="true"]')).toHaveCount(0);
    await start.fill("");
    await expect(
      helpers.getByRole("button", { name: "Час", exact: true }),
    ).toBeDisabled();
    await start.fill("23:45");
    await helpers.getByRole("button", { name: "Полтора", exact: true }).click();
    await expect(end).toHaveValue("01:15");
    await expect(form).toContainText("Окончание на следующий день");
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await helpers.scrollIntoViewIfNeeded();
      expect(
        await helpers.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
    }
    await page.screenshot({ path: "/tmp/small-meeting-time-helpers.png" });
    // Save inside Small's existing working-hours policy.
    await start.fill("14:00");
    await helpers.getByRole("button", { name: "Полтора", exact: true }).click();
    await form
      .getByLabel("Наименование", { exact: false })
      .fill("Synthetic overnight helper");
    await app.evaluate(() => {
      (
        globalThis as typeof globalThis & {
          syntheticAvailableSlots: { start: string; end: string }[];
        }
      ).syntheticAvailableSlots = [
        { start: "2099-10-29T09:00:00.000Z", end: "2099-10-29T10:30:00.000Z" },
      ];
    });
    await form.getByRole("button", { name: "Создать", exact: true }).click();
    await expect(form).not.toBeVisible();
    const payload = await app.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            syntheticCreatedPayload: { starts_at: string; ends_at: string };
          }
        ).syntheticCreatedPayload,
    );
    expect(Date.parse(payload.ends_at) - Date.parse(payload.starts_at)).toBe(
      90 * 60000,
    );
    expect(payload.starts_at).toBe("2099-10-29T09:00:00.000Z");
    expect(payload.ends_at).toBe("2099-10-29T10:30:00.000Z");
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
