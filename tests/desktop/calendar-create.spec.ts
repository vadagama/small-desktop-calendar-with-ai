import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockSmall } from "./fixtures/small-api.js";
import { addDateDays, calendarToday } from "../../src/shared/calendar-time.js";

test("calendar cells create timed drafts and protect unsaved changes", async () => {
  test.setTimeout(60000);
  const userData = await mkdtemp(join(tmpdir(), "small-grid-create-"));
  const app = await _electron.launch({
    args: [
      process.env.SMALL_TEST_APP_ROOT ?? ".",
      `--user-data-dir=${userData}`,
      "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
    ],
  });
  try {
    const tomorrow = addDateDays(calendarToday(), 1);
    await mockSmall(app, tomorrow);
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
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
    await page
      .getByRole("button", { name: "Предыдущий период", exact: true })
      .click();
    await expect(page.locator(".calendar-slot:disabled")).toHaveCount(48);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Сегодня", exact: true }).click();

    await page
      .getByRole("button", { name: "Следующий период", exact: true })
      .click();
    const cell = page.locator('.calendar-slot[data-create-start="780"]');
    await expect(page.locator(".calendar-slot")).toHaveCount(48);
    await cell.click();
    const form = page.getByRole("dialog", {
      name: "Новое событие",
      exact: true,
    });
    const confirmation = page.getByRole("dialog", {
      name: "Отменить несохранённые изменения?",
      exact: true,
    });
    await expect(form.getByLabel("Дата", { exact: true })).toHaveValue(
      tomorrow,
    );
    await expect(form.getByLabel("Начало", { exact: true })).toHaveValue(
      "13:00",
    );
    await expect(form.getByLabel("Окончание", { exact: true })).toHaveValue(
      "13:30",
    );
    // An untouched draft can close immediately.
    await form.getByRole("button", { name: "Закрыть новое событие" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await cell.click();
    await form
      .getByLabel("Наименование", { exact: false })
      .fill("Синтетический черновик");
    await form
      .getByRole("textbox", { name: "Описание", exact: true })
      .fill("Сохранить при возврате");
    await form.getByRole("button", { name: "Закрыть новое событие" }).click();
    await expect(confirmation).toBeVisible();
    await page.screenshot({
      path: "test-results/desktop/discard-new-meeting.png",
    });
    await confirmation
      .getByRole("button", { name: "Отмена", exact: true })
      .click();
    await expect(form.getByLabel("Наименование", { exact: false })).toHaveValue(
      "Синтетический черновик",
    );
    await expect(
      form.getByRole("textbox", { name: "Описание", exact: true }),
    ).toHaveValue("Сохранить при возврате");
    await page.keyboard.press("Escape");
    await expect(confirmation).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await expect(form).toBeVisible();
    await form.getByRole("button", { name: "Отмена", exact: true }).click();
    await confirmation
      .getByRole("button", { name: "Не сохранять", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      await app.evaluate(
        () =>
          (globalThis as typeof globalThis & { syntheticMeetingWrites: number })
            .syntheticMeetingWrites,
      ),
    ).toBe(0);

    const drag = async (cancel = false) => {
      await cell.evaluate((el) =>
        el.scrollIntoView({ block: "center", behavior: "instant" }),
      );
      await cell.hover();
      const box = (await cell.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + 80, { steps: 10 });
      await expect(page.locator(".calendar-selection")).toContainText(
        "13:00 – 14:15",
      );
      if (cancel) await page.keyboard.press("Escape");
      else
        await page.screenshot({
          path: "test-results/desktop/calendar-range-selection.png",
        });
      await page.mouse.up();
    };
    await drag(true);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".calendar-selection")).toHaveCount(0);
    await cell.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(form.getByLabel("Начало", { exact: true })).toHaveValue(
      "13:30",
    );
    await page.keyboard.press("Escape");
    await page.locator('.calendar-slot[data-create-start="1410"]').click();
    await expect(form.getByLabel("Начало", { exact: true })).toHaveValue(
      "23:30",
    );
    await expect(form.getByLabel("Окончание", { exact: true })).toHaveValue(
      "00:00",
    );
    await expect(form).toContainText("Окончание на следующий день");
    await page.keyboard.press("Escape");
    await drag();
    await expect(form.getByLabel("Начало", { exact: true })).toHaveValue(
      "13:00",
    );
    await expect(form.getByLabel("Окончание", { exact: true })).toHaveValue(
      "14:15",
    );
    await form
      .getByLabel("Наименование", { exact: false })
      .fill("Синтетическое выделение");
    await app.evaluate((_, date) => {
      (
        globalThis as typeof globalThis & {
          syntheticAvailableSlots: { start: string; end: string }[];
        }
      ).syntheticAvailableSlots = [
        { start: `${date}T13:00:00+05:00`, end: `${date}T14:15:00+05:00` },
      ];
    }, tomorrow);
    await form.getByRole("button", { name: "Создать", exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(confirmation).toHaveCount(0);
    await expect(page.locator('[data-new-event="true"]')).toContainText(
      "Синтетическое выделение",
    );
    const payload = await app.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            syntheticCreatedPayload: { starts_at: string; ends_at: string };
          }
        ).syntheticCreatedPayload,
    );
    expect(Date.parse(payload.ends_at) - Date.parse(payload.starts_at)).toBe(
      75 * 60000,
    );
    expect(Date.parse(payload.starts_at)).toBe(
      Date.parse(`${tomorrow}T13:00:00+05:00`),
    );
    expect(errors).toEqual([]);
    await page
      .getByRole("button", { name: "Профиль Small", exact: true })
      .click();
    await page.getByRole("button", { name: "Выйти из Small" }).click();
    await expect(
      page.getByRole("button", { name: "Войти в Small", exact: true }),
    ).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
