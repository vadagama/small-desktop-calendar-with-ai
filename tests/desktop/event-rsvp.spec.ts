import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockSmall } from "./fixtures/small-api.js";
import { calendarToday } from "../../src/shared/calendar-time.js";

test("invitation without is_informed supports both answers and preserves selection after reopening", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-rsvp-"));
  const app = await _electron.launch({
    args: [
      ".",
      `--user-data-dir=${userData}`,
      "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
    ],
  });
  try {
    await mockSmall(app, calendarToday());
    await app.evaluate(() => {
      (
        globalThis as typeof globalThis & {
          syntheticEventExtra: Record<string, unknown>;
        }
      ).syntheticEventExtra = {
        creator_id: "another-organizer",
        participants: [
          {
            id: "synthetic-organizer",
            name: "Тестовый участник",
            status: "pending",
          },
        ],
      };
    });
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
    const event = page
      .locator(".calendar-event")
      .filter({ hasText: "Синтетическая встреча A" });
    const card = page.getByRole("dialog", { name: "Синтетическая встреча A" });
    await event.click();
    await expect(card.locator(".event-rsvp")).toContainText("Придёте?");
    await expect(card.locator(".event-rsvp button").first()).toHaveCSS(
      "font-size",
      "14px",
    );
    await page.evaluate(() => {
      const state = window as typeof window & { modalTransitions: number };
      state.modalTransitions = 0;
      const original = document.startViewTransition.bind(document);
      document.startViewTransition = (callback) => {
        if (document.querySelector("dialog:modal")) state.modalTransitions++;
        return original(callback);
      };
    });
    for (const answer of ["Нет", "Да"]) {
      await card.getByRole("button", { name: answer, exact: true }).click();
      await expect(
        card.getByRole("button", { name: answer, exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      // Let the confirmed write and the calendar renewal finish while the dialog stays open.
      await page.waitForTimeout(700);
      expect(
        await page.evaluate(
          () =>
            (window as typeof window & { modalTransitions: number })
              .modalTransitions,
        ),
      ).toBe(0);
      await card.getByRole("button", { name: "Закрыть событие" }).click();
      await event.click();
      await expect(
        card.getByRole("button", { name: answer, exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
    }
    await page.screenshot({ path: "test-results/desktop/event-rsvp.png" });
    expect(errors).toEqual([]);
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((w) => w.isVisible()),
      ),
    ).toBe(false);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
