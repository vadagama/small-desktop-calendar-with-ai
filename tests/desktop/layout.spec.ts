import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("workspace moves and resizes panels without losing the conversation, draft or date", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-layout-test-"));
  const executablePath = process.env.SMALL_APP_EXECUTABLE;
  const app = await _electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : ["."]), `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      SMALL_TEST_SYNTHETIC: "1",
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    },
  });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (["warning", "error"].includes(message.type()))
        errors.push(message.text());
    });
    await page.setViewportSize({ width: 1440, height: 960 });
    const workspace = page.locator(".dock-workspace");
    const settings = page.getByRole("button", {
      name: "Настройки пространства",
      exact: true,
    });
    const selectPlacement = async (next: string) => {
      await settings.click();
      const dialog = page.getByRole("dialog", { name: "Рабочее пространство" });
      const labels: Record<string, string> = {
        left: "Слева",
        right: "Справа",
        above: "Сверху",
        below: "Снизу",
      };
      const option = dialog.getByRole("button", {
        name: labels[next]!,
        exact: true,
      });
      await option.click();
      await expect(option).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(workspace).toHaveAttribute("data-assistant-placement", next);
      await expect
        .poll(async () => {
          const c = (await page.locator(".calendar-panel").boundingBox())!;
          const a = (await page.locator(".desktop-assistant").boundingBox())!;
          if (next === "left") return a.x + a.width <= c.x;
          if (next === "above") return a.y + a.height <= c.y;
          if (next === "below") return c.y + c.height <= a.y;
          return c.x + c.width <= a.x;
        })
        .toBe(true);
    };
    await expect(settings).toBeVisible();
    await expect(page.locator(".dock-toolbar")).toHaveCount(0);
    await page.screenshot({ path: "test-results/desktop/style-initial.png" });
    await settings.click();
    await expect(
      page.getByRole("dialog", { name: "Рабочее пространство" }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/desktop/style-settings.png" });
    await page.keyboard.press("Escape");
    const calendar = page
      .getByRole("region", {
        name: "Календарь",
        exact: true,
      })
      .and(page.locator("section"));
    const assistant = page.getByRole("region", { name: "AI-ассистент" });
    const input = page.getByRole("textbox", { name: "Сообщение ассистенту" });
    await input.fill("Сложи 2 и 3");
    await page.getByRole("button", { name: "Отправить сообщение" }).click();
    await expect(page.getByRole("log")).toContainText("Результат: 5");
    await input.fill("Черновик следующего сообщения");
    await page.getByRole("button", { name: "Месяц", exact: true }).click();
    await page.getByRole("button", { name: "Следующий период" }).click();
    const dateTitle = await page.locator(".calendar-toolbar h2").innerText();
    for (const direction of ["left", "above", "below", "right"]) {
      await selectPlacement(direction);
      await expect
        .poll(async () => {
          const c = (await calendar.boundingBox())!;
          const a = (await assistant.boundingBox())!;
          if (direction === "left") return a.x + a.width <= c.x;
          if (direction === "above") return a.y + a.height <= c.y;
          if (direction === "below") return c.y + c.height <= a.y;
          return c.x + c.width <= a.x;
        })
        .toBe(true);
      await expect(input).toHaveValue("Черновик следующего сообщения");
      await expect(page.getByRole("log")).toContainText("Результат: 5");
      await expect(page.locator(".calendar-toolbar h2")).toHaveText(dateTitle);
      await expect(
        page.getByRole("button", { name: "Месяц", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await page.screenshot({
        path: `test-results/desktop/layout-${direction}.png`,
      });
    }
    await page
      .getByRole("button", { name: "Поменять панели местами", exact: true })
      .click();
    await expect(workspace).toHaveAttribute("data-assistant-placement", "left");
    await selectPlacement("right");
    const before = (await calendar.boundingBox())!;
    const sash = page.locator(".dv-sash:visible").first();
    const handle = (await sash.boundingBox())!;
    await page.mouse.move(
      handle.x + handle.width / 2,
      handle.y + handle.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(handle.x - 100, handle.y + handle.height / 2, {
      steps: 10,
    });
    await page.mouse.up();
    await expect
      .poll(async () => (await calendar.boundingBox())!.width)
      .toBeLessThan(before.width - 50);
    await expect(input).toHaveValue("Черновик следующего сообщения");
    await selectPlacement("below");
    const beforeVertical = (await assistant.boundingBox())!;
    const horizontalHandle = (await sash.boundingBox())!;
    await page.mouse.move(
      horizontalHandle.x + horizontalHandle.width / 2,
      horizontalHandle.y + horizontalHandle.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      horizontalHandle.x + horizontalHandle.width / 2,
      horizontalHandle.y - 80,
      { steps: 10 },
    );
    await page.mouse.up();
    await expect
      .poll(async () => (await assistant.boundingBox())!.height)
      .toBeGreaterThan(beforeVertical.height + 40);
    const resized = (await assistant.boundingBox())!;
    await settings.click();
    await page
      .getByRole("button", { name: "Уменьшить панель ассистента" })
      .focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect
      .poll(async () => (await assistant.boundingBox())!.height)
      .toBeLessThan(resized.height - 20);
    await selectPlacement("right");
    const box = (await calendar.boundingBox())!;
    const tab = (await page
      .getByRole("tab", { name: "Ассистент", exact: true })
      .boundingBox())!;
    await page.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2);
    await page.mouse.down();
    await page.mouse.move(tab.x + tab.width / 2 - 12, tab.y + tab.height / 2, {
      steps: 3,
    });
    await page.mouse.move(box.x + box.width / 2, box.y + 5, { steps: 15 });
    await page.mouse.up();
    await expect(workspace).toHaveAttribute(
      "data-assistant-placement",
      "above",
    );
    await expect(input).toHaveValue("Черновик следующего сообщения");
    await expect(page.getByRole("log")).toContainText("Результат: 5");
    await expect(page.locator(".calendar-toolbar h2")).toHaveText(dateTitle);
    await selectPlacement("right");
    await input.fill("Сложи 7 и 8");
    await page.getByRole("button", { name: "Отправить сообщение" }).click();
    await expect(
      page.getByRole("button", { name: "Остановить ответ" }),
    ).toBeVisible();
    await selectPlacement("below");
    await expect(page.getByRole("log")).toContainText("Результат: 15");
    await expect(page.getByRole("log")).toContainText("Результат: 5");
    await selectPlacement("right");
    await page.setViewportSize({ width: 900, height: 640 });
    await expect(input).toBeVisible();
    await expect(settings).toBeVisible();
    await page.screenshot({ path: "test-results/desktop/layout-900.png" });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
