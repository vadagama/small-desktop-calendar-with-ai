import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockSmall } from "./fixtures/small-api.js";

test("header creates a meeting without a model, preserves fields and blocks unknown retries", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-manual-create-"));
  const app = await _electron.launch({
    args: [
      ".",
      `--user-data-dir=${userData}`,
      "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
    ],
  });
  try {
    await mockSmall(app, "2099-10-29");
    const syntheticFile = join(userData, "synthetic.txt");
    await writeFile(syntheticFile, "synthetic attachment");
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, syntheticFile);
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
    await page
      .getByRole("button", { name: "Создать событие", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Новое событие",
      exact: true,
    });
    await expect(dialog).toContainText("Организатор: employee-a");
    await page.setViewportSize({ width: 900, height: 800 });
    await dialog.screenshot({
      path: "test-results/desktop/manual-meeting-empty.png",
    });
    const rootFont = await page
      .locator("html")
      .evaluate((el) => getComputedStyle(el).fontSize);
    await expect(dialog.getByLabel("Наименование", { exact: false })).toHaveCSS(
      "font-size",
      rootFont,
    );
    await expect(
      dialog.getByRole("button", { name: "Создать", exact: true }),
    ).toHaveCSS("font-size", rootFont);
    for (const size of [
      { width: 900, height: 640 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(size);
      const footer = dialog.locator(".new-meeting-footer");
      const before = (await footer.boundingBox())!;
      expect(before.y + before.height).toBeLessThan(size.height);
      expect(before.x).toBeGreaterThanOrEqual(0);
      expect(before.x + before.width).toBeLessThanOrEqual(size.width);
      const body = dialog.locator(".new-meeting-body");
      await body.hover();
      await page.mouse.wheel(0, 1500);
      await expect
        .poll(() => body.evaluate((el) => el.scrollTop))
        .toBeGreaterThan(0);
      expect((await footer.boundingBox())!.y).toBe(before.y);
      expect(await dialog.evaluate((el) => el.scrollTop)).toBe(0);
      expect(
        await body.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await dialog.screenshot({
        path: `test-results/desktop/manual-meeting-${size.width}.png`,
      });
      await dialog.getByLabel("Наименование", { exact: false }).focus();
    }

    await page.setViewportSize({ width: 1440, height: 932 });
    await dialog
      .getByLabel("Наименование", { exact: false })
      .fill("Синтетическая ручная встреча");
    await dialog
      .getByLabel("Описание", { exact: true })
      .fill("План обсуждения");
    await dialog
      .getByRole("button", { name: "Сгенерировать ссылку", exact: true })
      .click();
    const url = await dialog
      .getByLabel("Ссылка на встречу", { exact: true })
      .inputValue();
    expect(url).toMatch(/^https:\/\/meet.small.kz\//);
    await dialog.getByLabel("Поиск участников", { exact: true }).fill("Тест");
    await dialog
      .getByRole("button", { name: "Найти сотрудников", exact: true })
      .click();
    await dialog.getByRole("checkbox").first().check();
    await dialog.getByRole("checkbox").nth(1).check();
    await dialog.getByLabel("Дата", { exact: true }).fill("2099-10-29");
    await dialog.getByLabel("Начало", { exact: true }).fill("09:30");
    await dialog.getByLabel("Окончание", { exact: true }).fill("10:00");
    await dialog
      .getByRole("button", { name: "Информируемые", exact: true })
      .click();
    await dialog
      .getByLabel("Поиск информируемых", { exact: true })
      .fill("Тест");
    await dialog
      .getByRole("button", { name: "Найти информируемых", exact: true })
      .click();
    await dialog.getByRole("checkbox").nth(3).check();
    await dialog.getByLabel("Переговорная", { exact: true }).selectOption("11");
    await dialog.getByRole("switch", { name: "Повторяемость" }).check();
    await dialog.getByLabel("Дата", { exact: true }).fill("");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Дата", { exact: true }).fill("2099-10-29");
    await dialog.getByRole("checkbox", { name: "Пн", exact: true }).uncheck();
    await dialog.getByRole("checkbox", { name: "Чт", exact: true }).check();
    await dialog.getByLabel("Повторять до", { exact: true }).fill("2099-11-05");
    await dialog
      .getByRole("button", { name: "Прикрепить файл", exact: true })
      .click();
    await expect(dialog).toContainText("synthetic.txt");
    await page.screenshot({
      path: "test-results/desktop/manual-meeting-form.png",
    });
    await dialog.getByRole("button", { name: "Создать", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText(
      "Встреча создана и проверена",
    );
    expect(
      await app.evaluate(
        () =>
          (globalThis as typeof globalThis & { syntheticMeetingWrites: number })
            .syntheticMeetingWrites,
      ),
    ).toBe(1);
    const payload = await app.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            syntheticCreatedPayload: Record<string, unknown>;
          }
        ).syntheticCreatedPayload,
    );
    expect(payload.calendar_ids).toEqual([11]);
    expect(payload.participant_ids).toContain("synthetic-organizer");
    expect(payload.attachments).toEqual(["synthetic-file"]);
    expect(payload.notification_recipient_ids).toEqual(["synthetic-b"]);
    expect(payload.recurrence_rule).toEqual({
      FREQ: "WEEKLY",
      BYDAY: ["TH"],
      UNTIL: "2099-11-05",
    });
    expect(payload.description).toBe(`План обсуждения\n\n${url}`);
    await dialog.getByRole("button", { name: "Готово", exact: true }).click();
    await page
      .getByRole("button", { name: "Создать событие", exact: true })
      .click();
    await dialog
      .getByLabel("Наименование", { exact: false })
      .fill("Неизвестный результат");
    await dialog.getByLabel("Поиск участников", { exact: true }).fill("Тест");
    await dialog
      .getByRole("button", { name: "Найти сотрудников", exact: true })
      .click();
    await dialog.getByRole("checkbox").first().check();
    await dialog.getByLabel("Дата", { exact: true }).fill("2099-10-30");
    await dialog.getByLabel("Начало", { exact: true }).fill("09:30");
    await dialog.getByLabel("Окончание", { exact: true }).fill("10:00");
    await dialog.getByRole("button", { name: "Создать", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText(
      "Результат отправки неизвестен",
    );
    await expect(
      dialog.getByRole("button", { name: "Создать", exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "Проверить результат", exact: true })
      .click();
    await expect(dialog.getByRole("status")).toContainText(
      "Результат отправки неизвестен",
    );
    expect(
      await app.evaluate(
        () =>
          (globalThis as typeof globalThis & { syntheticMeetingWrites: number })
            .syntheticMeetingWrites,
      ),
    ).toBe(2);
    await dialog
      .getByRole("button", { name: "Закрыть новое событие", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Профиль Small", exact: true })
      .click();
    await page.getByRole("button", { name: "Выйти из Small" }).click();
    await expect(
      page.getByRole("button", { name: "Войти в Small", exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
