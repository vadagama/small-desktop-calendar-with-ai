import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockSmall } from "./fixtures/small-api.js";
import { calendarToday, addDateDays } from "../../src/shared/calendar-time.js";

for (const scenario of ["00", "30", "recurring", "past"]) {
  const seconds = scenario === "30" ? "30" : "00";
  test(`30 minute events move and resize at both edges (scenario=${scenario})`, async () => {
    const userData = await mkdtemp(join(tmpdir(), "small-short-event-"));
    const app = await _electron.launch({
      args: [
        ".",
        `--user-data-dir=${userData}`,
        "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
      ],
    });
    try {
      const date =
        scenario === "past"
          ? addDateDays(calendarToday(), -1)
          : calendarToday();
      await mockSmall(app, date);
      await app.evaluate(
        (_electron, { day, seconds, scenario }) => {
          (
            globalThis as typeof globalThis & {
              syntheticEventExtra: Record<string, unknown>;
            }
          ).syntheticEventExtra = {
            starts_at: `${day}T09:00:${seconds}+05:00`,
            ends_at: `${day}T09:30:00+05:00`,
            ...(scenario === "recurring"
              ? {
                  is_recurring: true,
                  recurrence_rule: { FREQ: "WEEKLY", BYDAY: ["TH"] },
                }
              : {}),
          };
        },
        { day: date, seconds, scenario },
      );
      const page = await app.firstWindow();

      await page
        .getByRole("button", { name: "Профиль Small", exact: true })
        .click();
      await page.getByLabel("Логин", { exact: true }).fill("employee-a");
      await page
        .getByLabel("Пароль", { exact: true })
        .fill("synthetic-password");
      await page
        .getByRole("button", { name: "Войти в Small", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Выйти из Small" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Закрыть профиль Small" }).click();
      await page.getByRole("button", { name: "День", exact: true }).click();
      if (scenario === "past")
        await page.getByRole("button", { name: "Предыдущий период" }).click();
      const event = page
        .locator(".calendar-event")
        .filter({ hasText: "Синтетическая встреча A" });
      await expect(event).toHaveClass(/compact/);
      const drag = async (edge: string | null, delta: number) => {
        const target = edge ? event.locator(`.event-resize.${edge}`) : event;
        await target.hover();
        const box = (await target.boundingBox())!;
        expect(box.height).toBeGreaterThan(0);
        const x = box.x + box.width / 2,
          y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x, y + delta, { steps: 8 });
        await page.mouse.up();
        // The next gesture must wait until Small has answered for this one.
        await expect(event).not.toHaveAttribute("data-pending", /.+/);
      };

      if (scenario === "past") {
        await expect(event.locator(".event-resize")).toHaveCount(0);
        await event.click();
        await page.getByLabel("Действия со встречей").click();
        await expect(
          page.getByRole("button", { name: "Редактировать", exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "Удалить", exact: true }),
        ).toHaveCount(0);
        await page.getByRole("button", { name: "Закрыть событие" }).click();
      } else {
        await drag(null, 16);
        await expect(event).toContainText("09:15 – 09:45");
        await drag("end", 16);
        await expect(event).toContainText("09:15 – 10:00");
        await drag("start", 16);
        await expect(event).toContainText("09:30 – 10:00");
      }

      await page
        .getByRole("button", { name: "Профиль Small", exact: true })
        .click();
      await page.getByRole("button", { name: "Выйти из Small" }).click();
    } finally {
      await app.close();
      await rm(userData, { recursive: true, force: true });
    }
  });
}
