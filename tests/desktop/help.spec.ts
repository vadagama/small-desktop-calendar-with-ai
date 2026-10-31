import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("guide works offline in a clean profile and inserts prompts without sending", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-guide-"));
  const executablePath = process.env.SMALL_APP_EXECUTABLE;
  const app = await _electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : ["."]), `--user-data-dir=${userData}`],
    env: { ...process.env, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
  });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const input = page.getByRole("textbox", { name: "Сообщение ассистенту" });
    await input.fill("Мой черновик");
    const trigger = page.getByRole("button", { name: "Помощь", exact: true });
    await trigger.click();
    const guide = page.getByRole("region", { name: "Руководство Small" });
    await expect(guide).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".dock-workspace")).not.toBeVisible();
    await expect(trigger).toHaveAttribute("aria-current", "page");
    await guide.getByRole("searchbox").fill("несуществующая тема");
    await expect(guide.getByText("Ничего не найдено")).toBeVisible();
    await guide.getByRole("button", { name: "Сбросить поиск" }).click();
    for (const name of [
      "С чего начать",
      "Аутентификация",
      "Настройка LLM",
      "Работать с календарём",
      "Подобрать время",
      "Найти события",
      "Посмотреть загрузку",
      "Настройка уведомлений",
      "Память ассистента",
      "Настроить ассистента",
    ]) {
      await guide.getByRole("button", { name, exact: true }).click();
      await expect
        .poll(() =>
          guide
            .locator("img")
            .evaluate(
              (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
            ),
        )
        .toBe(true);
    }
    await guide
      .getByRole("button", { name: "Память ассистента", exact: true })
      .click();
    await expect(
      guide.getByRole("heading", { name: "Память ассистента" }),
    ).toHaveCSS("font-size", "18px");
    await expect(guide.locator(".help-summary")).toHaveCSS("font-size", "14px");
    await guide.getByRole("button", { name: "Подставить запрос" }).click();
    await expect(input).toHaveValue(
      "Мой черновик\nЗапомни, что архитекторы - это Олег Краснов, Денис Данилин и Анатолий Сульгин",
    );
    await expect(input).toBeFocused();
    await expect(page.locator(".message.user")).toHaveCount(0);
    await input.fill("");
    await input.fill("x".repeat(1990));
    await expect(input).toHaveValue("x".repeat(1990));
    await trigger.click();
    await guide.getByRole("button", { name: "Подставить запрос" }).click();
    await expect(input).toHaveValue("x".repeat(1990));
    await expect(
      page.getByText("В поле ввода недостаточно места для примера.", {
        exact: false,
      }),
    ).toBeVisible();
    await input.fill("");
    await trigger.click();
    await expect(
      guide.getByRole("heading", { name: "Память ассистента" }),
    ).toBeVisible();
    await guide.getByRole("button", { name: "Открыть память" }).click();
    const memory = page.getByRole("dialog", { name: "Память", exact: true });
    await expect(memory).toBeVisible();
    await page.keyboard.press("Escape");
    await guide
      .getByRole("button", { name: "Настроить ассистента", exact: true })
      .click();
    await guide.getByRole("button", { name: "Открыть настройки AI" }).click();
    const settings = page.getByRole("dialog", {
      name: "Настройки AI-помощника",
    });
    await expect(settings.getByLabel("Mood · стиль общения")).toHaveValue(
      "neutral",
    );
    await expect(settings.getByLabel("Ваши инструкции")).toHaveValue("");
    await page.keyboard.press("Escape");
    await guide
      .getByRole("button", { name: "Аутентификация", exact: true })
      .click();
    await guide.getByRole("button", { name: "Открыть вход в Small" }).click();
    const login = page.getByRole("dialog", {
      name: "Вход в Small",
      exact: true,
    });
    await expect(login.getByLabel("Логин", { exact: true })).toHaveValue("");
    await expect(login.getByLabel("Пароль", { exact: true })).toHaveValue("");
    await page.keyboard.press("Escape");
    await expect(guide).toBeVisible();
    await guide
      .getByRole("button", { name: "Настройка LLM", exact: true })
      .click();
    await guide
      .getByRole("button", { name: "Открыть настройки модели" })
      .click();
    await expect(
      page
        .getByRole("dialog", { name: "Настройки модели" })
        .getByLabel("API-ключ"),
    ).toHaveValue("");
    await page.keyboard.press("Escape");
    await trigger.click();
    await expect(
      guide.getByRole("heading", { name: "Настройка LLM", exact: true }),
    ).toBeVisible();
    await guide
      .getByRole("button", { name: "Настройка уведомлений", exact: true })
      .click();
    await guide.getByRole("button", { name: "Открыть напоминания" }).click();
    const reminders = page.getByRole("dialog", {
      name: "Напоминания",
      exact: true,
    });
    await expect(
      reminders.getByRole("button", { name: "Настройки macOS" }),
    ).toBeVisible();
    await expect(
      reminders.getByRole("button", { name: "Отправить тестовое уведомление" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.screenshot({ path: "test-results/desktop/guide.png" });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
