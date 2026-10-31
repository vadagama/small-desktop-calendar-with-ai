import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("assistant instructions and skills can be edited, persisted and restored", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-agent-settings-"));
  await mkdir(join(userData, "assistant-templates"));
  await writeFile(
    join(userData, "assistant-templates", "welcome.md"),
    "# Тестовый календарь\n\n**Выберите участников** обычным сообщением.",
  );
  const launch = () =>
    _electron.launch({
      args: [".", `--user-data-dir=${userData}`],
      env: { ...process.env, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "Тестовый календарь" }),
    ).toBeVisible();
    await expect(page.locator(".assistant-intro strong")).toHaveText(
      "Выберите участников",
    );
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page
      .getByRole("button", { name: "Настройки AI-помощника", exact: true })
      .click();
    let dialog = page.getByRole("dialog", { name: "Настройки AI-помощника" });
    await dialog.getByLabel("Шаблон 1", { exact: true }).fill("Сложи 2 и 3");
    await expect(dialog.getByLabel("Шаблон 4", { exact: true })).toHaveValue(
      "Найди все события за месяц, где организатором была Жанна",
    );
    await dialog
      .getByRole("button", { name: "Удалить шаблон 4", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Добавить шаблон", exact: true })
      .click();
    await dialog
      .getByLabel("Шаблон 4", { exact: true })
      .fill("Какие встречи завтра?");
    await dialog
      .getByRole("button", { name: "Добавить шаблон", exact: true })
      .click();
    await dialog
      .getByLabel("Шаблон 5", { exact: true })
      .fill("Покажи следующую неделю");
    await expect(
      dialog.getByRole("button", { name: "Добавить шаблон", exact: true }),
    ).toBeDisabled();
    await dialog
      .getByRole("button", { name: "Удалить шаблон 5", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Добавить шаблон", exact: true }),
    ).toBeEnabled();
    expect(
      await dialog
        .getByLabel("Шаблон 1", { exact: true })
        .evaluate((el) => getComputedStyle(el).fontSize),
    ).toBe("14px");
    await dialog
      .getByRole("region", { name: "Шаблоны запросов" })
      .screenshot({ path: "test-results/desktop/prompt-templates.png" });
    await dialog.getByLabel("Mood · стиль общения").selectOption("technical");
    await dialog
      .getByLabel("Ваши инструкции")
      .fill("Предлагай утренние варианты.");
    await dialog
      .locator("summary")
      .filter({ hasText: "Поиск сотрудников" })
      .click();
    await dialog
      .getByLabel("Включить: Поиск сотрудников", { exact: true })
      .uncheck();
    await dialog
      .getByLabel("Инструкции: Поиск сотрудников", { exact: true })
      .fill("# Поиск\nПоказывай должность рядом с именем.");
    await dialog
      .getByRole("button", { name: "Сохранить настройки", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(errors).toEqual([]);
    await expect(page.locator(".assistant-suggestions button")).toHaveCount(4);
    await page
      .getByRole("button", { name: "Сложи 2 и 3", exact: true })
      .click();
    await expect(page.locator(".message.user")).toContainText("Сложи 2 и 3");
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator(".assistant-suggestions button")).toHaveCount(4);
    await expect(
      page.getByRole("button", { name: "Сложи 2 и 3", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Настройки AI-помощника", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Настройки AI-помощника" });
    await expect(dialog.getByLabel("Mood · стиль общения")).toHaveValue(
      "technical",
    );
    await expect(dialog.getByLabel("Ваши инструкции")).toHaveValue(
      "Предлагай утренние варианты.",
    );
    await dialog
      .locator("summary")
      .filter({ hasText: "Поиск сотрудников" })
      .click();
    await expect(
      dialog.getByLabel("Включить: Поиск сотрудников", { exact: true }),
    ).not.toBeChecked();
    await expect(
      dialog.getByLabel("Инструкции: Поиск сотрудников", { exact: true }),
    ).toHaveValue("# Поиск\nПоказывай должность рядом с именем.");
    await dialog
      .getByRole("button", { name: "Восстановить стандартные" })
      .click();
    await expect(
      dialog
        .getByRole("status")
        .filter({ hasText: "Стандартные настройки восстановлены" }),
    ).toHaveText("Стандартные настройки восстановлены");
    await expect(dialog.getByLabel("Ваши инструкции")).toHaveValue("");
    await expect(dialog.getByLabel("Шаблон 1", { exact: true })).toHaveValue(
      "На завтра создай встречу на 30 минут в любой свободный слот после 12:00",
    );
    await expect(dialog.getByLabel("Mood · стиль общения")).toHaveValue(
      "neutral",
    );
    await expect(
      dialog.getByLabel("Включить: Поиск сотрудников", { exact: true }),
    ).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Настройки AI-помощника", exact: true }),
    ).toBeFocused();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
