import { _electron, expect, test } from "@playwright/test";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockSmall } from "./fixtures/small-api.js";
import { addDateDays, calendarToday } from "../../src/shared/calendar-time.js";

const writes = (app: Awaited<ReturnType<typeof _electron.launch>>) =>
  app.evaluate(
    () =>
      (globalThis as typeof globalThis & { syntheticEventMutations: number })
        .syntheticEventMutations,
  );

test("series changes ask for an explicit scope and stay closed until the contract is confirmed", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-series-dialog-"));
  const app = await _electron.launch({
    args: [
      ".",
      `--user-data-dir=${userData}`,
      "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
    ],
  });
  try {
    await mockSmall(app, calendarToday());
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
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

    // A plain meeting opens the full editor without asking for a series scope.
    await page
      .locator(".calendar-event")
      .filter({ hasText: "Синтетическая встреча A" })
      .click();
    const plain = page.getByRole("dialog", { name: "Синтетическая встреча A" });
    await plain.getByLabel("Действия со встречей").click();
    await plain
      .getByRole("button", { name: "Редактировать", exact: true })
      .click();
    const editor = page.getByRole("dialog", { name: "Редактирование события" });
    await expect(editor.getByPlaceholder("Введите наименование")).toHaveValue(
      "Синтетическая встреча A",
    );
    await expect(page.locator(".series-scope-dialog")).toHaveCount(0);
    await expect(
      plain.getByRole("button", { name: "Перенести", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page
      .locator(".calendar-event")
      .filter({ hasText: "Синтетическая серия A" })
      .click();
    const card = page.getByRole("dialog", { name: "Синтетическая серия A" });
    await expect(card).toContainText("11:00");
    const scopeDialog = (name: string) =>
      page.getByRole("dialog", { name, exact: true });

    // Rename: single occurrence by default, both scopes explicit.
    await card.getByLabel("Действия со встречей").click();
    await card
      .getByRole("button", { name: "Редактировать", exact: true })
      .click();
    const rename = scopeDialog("Переименовать повторяющуюся встречу");
    await expect(rename).toBeVisible();
    await expect(rename).toContainText("11:00–11:30");
    const single = rename.getByRole("radio", { name: "Только это вхождение" });
    const following = rename.getByRole("radio", { name: "Это и последующие" });
    await expect(single).toBeChecked();
    await expect(following).not.toBeChecked();
    await expect(following).toBeEnabled();
    const confirm = rename.getByRole("button", { name: "Сохранить название" });
    await expect(rename.getByTestId("series-summary")).toContainText(
      "Только это вхождение",
    );
    await expect(rename.getByTestId("series-summary")).toContainText(
      "Остальные встречи серии не изменятся",
    );
    await expect(rename.getByRole("status")).toContainText(
      "не подтверждено проверкой на тестовой среде",
    );
    await expect(rename.getByRole("status")).toContainText(
      "Переименование (только это вхождение)",
    );
    await expect(confirm).toBeDisabled();
    // Settled state is stable: the gate is asked once, not in a render loop.
    const churn = await rename.evaluate(async (node) => {
      let count = 0;
      const observer = new MutationObserver((records) => {
        count += records.length;
      });
      observer.observe(node, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 700));
      observer.disconnect();
      return count;
    });
    expect(churn).toBe(0);
    await following.check();
    await expect(rename.getByTestId("series-summary")).toContainText(
      "Это и последующие: с",
    );
    await expect(rename.getByTestId("series-summary")).toContainText(
      "Прошедшие встречи не изменятся",
    );
    await expect(rename.getByRole("status")).toContainText(
      "Переименование (это и последующие)",
    );
    await expect(confirm).toBeDisabled();
    await page.screenshot({
      path: "test-results/desktop/series-scope-dialog.png",
    });
    await rename.getByLabel("Новое название").fill("   ");
    await expect(rename.getByTestId("series-summary")).toHaveCount(0);
    await expect(confirm).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(rename).toHaveCount(0);
    await expect(card).toBeVisible();

    // Move: inputs are validated before the gate is asked.
    await card.getByLabel("Действия со встречей").click();
    await card.getByRole("button", { name: "Перенести", exact: true }).click();
    const move = scopeDialog("Перенести повторяющуюся встречу");
    await expect(move.getByLabel("Начало")).toHaveValue("11:00");
    await expect(move.getByLabel("Конец")).toHaveValue("11:30");
    await expect(move.getByRole("status")).toContainText(
      "Перенос (только это вхождение)",
    );
    await move.getByLabel("Конец").fill("10:00");
    // An invalid interval is never sent to the gate: no reply can arrive late either.
    await page.waitForTimeout(400);
    await expect(move.getByRole("status")).toHaveCount(0);
    await expect(move.getByTestId("series-summary")).toHaveCount(0);
    await expect(
      move.getByRole("button", { name: "Перенести", exact: true }),
    ).toBeDisabled();
    await move.getByLabel("Конец").fill("12:00");
    await expect(move.getByRole("status")).toContainText("Перенос");
    await expect(
      move.getByRole("button", { name: "Перенести", exact: true }),
    ).toBeDisabled();
    await move.getByRole("button", { name: "Отмена" }).click();
    await expect(move).toHaveCount(0);

    // Deletion supports an explicit choice; cancel keeps the calendar unchanged.
    await card.getByLabel("Действия со встречей").click();
    await card.getByRole("button", { name: "Удалить", exact: true }).click();
    const remove = scopeDialog("Удалить повторяющуюся встречу");
    await expect(
      remove.getByRole("radio", { name: /Только это вхождение/ }),
    ).toBeChecked();
    await expect(
      remove.getByRole("radio", { name: /Это и последующие/ }),
    ).toBeEnabled();
    await remove.getByRole("radio", { name: /Это и последующие/ }).check();
    await expect(remove.getByTestId("series-summary")).toContainText(
      "Прошедшие встречи не изменятся",
    );
    await expect(
      remove.getByRole("button", { name: "Удалить", exact: true }),
    ).toBeEnabled();
    await page.keyboard.press("Escape");

    // Nothing was written and no series journal exists.
    expect(await writes(app)).toBe(0);
    await expect(access(join(userData, "series-mutations"))).rejects.toThrow();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("a past series occurrence offers no change at all", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-series-past-"));
  const app = await _electron.launch({
    args: [
      ".",
      `--user-data-dir=${userData}`,
      "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
    ],
  });
  try {
    const yesterday = addDateDays(calendarToday(), -1);
    await mockSmall(app, yesterday);
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
    // The month grid always contains yesterday, even on the first day of a week.
    await page.getByRole("button", { name: "Месяц", exact: true }).click();
    await page
      .locator(".month-event")
      .filter({ hasText: "Синтетическая серия A" })
      .first()
      .click();
    const card = page.getByRole("dialog", { name: "Синтетическая серия A" });
    await expect(card).toBeVisible();
    await card.getByLabel("Действия со встречей").click();
    await expect(
      card.getByRole("button", {
        name: "Скопировать ссылку на встречу",
        exact: true,
      }),
    ).toBeVisible();
    for (const name of ["Редактировать", "Перенести", "Удалить"])
      await expect(card.getByRole("button", { name, exact: true })).toHaveCount(
        0,
      );
    expect(await writes(app)).toBe(0);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
