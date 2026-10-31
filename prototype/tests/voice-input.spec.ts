import { test, expect } from "@playwright/test";

async function install(page: import("@playwright/test").Page) {
  await page
    .getByRole("button", { name: "Настройки AI-помощника", exact: true })
    .click();
  await page.getByRole("button", { name: /Скачать модель/ }).click();
  await expect(
    page.getByRole("progressbar", { name: "Скачивание модели" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Пауза", exact: true }).click();
  await expect(page.getByText("Скачивание приостановлено")).toBeVisible();
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await expect(page.getByText("Модель готова", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await page.getByLabel("Источник звука").selectOption("headset");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
}

test("installation gates voice input; stop inserts at selection without sending", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Начать голосовой ввод" }),
  ).toHaveCount(0);
  await install(page);
  const input = page.getByRole("textbox", { name: "Сообщение ассистенту" });
  await input.fill("Мой черновик: ");
  await page.getByRole("button", { name: "Начать голосовой ввод" }).click();
  await expect(page.getByText(/Слушаю ·/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Отправить сообщение", exact: true }),
  ).toBeDisabled();
  await input.press("Enter");
  await page.getByRole("button", { name: "Остановить запись" }).click();
  await expect(input).toHaveValue(
    "Мой черновик: Найди 30 минут для команды завтра.",
  );
  await expect(page.locator(".message.user")).toHaveCount(0);
  await expect(input).toBeFocused();
  await page.getByRole("button", { name: "Начать голосовой ввод" }).click();
  await page.keyboard.press("Escape");
  await expect(input).toHaveValue(
    "Мой черновик: Найди 30 минут для команды завтра.",
  );
  await expect(
    page.getByRole("button", { name: "Начать голосовой ввод" }),
  ).toBeVisible();
});

test("download survives dialog closure and can be cancelled; removal hides microphone", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Настройки AI-помощника", exact: true })
    .click();
  await page.getByRole("button", { name: /Скачать модель/ }).click();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Настройки AI-помощника", exact: true })
    .click();
  await expect(page.getByRole("progressbar")).toBeVisible();
  await page.getByRole("button", { name: "Отменить скачивание" }).click();
  await expect(
    page.getByRole("button", { name: /Скачать модель/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await install(page);
  await page
    .getByRole("button", { name: "Настройки AI-помощника", exact: true })
    .click();
  await expect(page.getByLabel("Источник звука")).toHaveValue("headset");
  await page.getByRole("button", { name: "Удалить модель" }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Начать голосовой ввод" }),
  ).toHaveCount(0);
});
