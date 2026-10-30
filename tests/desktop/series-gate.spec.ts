import { _electron, expect, test } from "@playwright/test";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockSmall } from "./fixtures/small-api.js";
import { addDateDays, calendarToday } from "../../src/shared/calendar-time.js";

test("series operations stay closed through the real preload and IPC, with no write attempted", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-series-gate-"));
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
    const day = addDateDays(calendarToday(), 7);
    const request = {
      accountId: "employee-a",
      operation: "rename",
      scope: "occurrence",
      seriesId: "43",
      originalDate: day,
      beforeStart: `${day}T10:00:00+05:00`,
      beforeEnd: `${day}T11:00:00+05:00`,
      title: "Новая",
    };
    const gateCall = (input: unknown) =>
      page.evaluate((v) => window.smallDesktop.series.gate(v as never), input);
    const applyCall = (input: unknown) =>
      page.evaluate((v) => window.smallDesktop.series.apply(v as never), input);
    // Signed out: the session decides, not the renderer.
    const signedOut = await gateCall(request);
    expect(signedOut).toMatchObject({ ok: false, kind: "auth" });

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

    const gate = await gateCall(request);
    expect(gate).toMatchObject({
      ok: true,
      data: { open: false, reason: "contract-unverified" },
    });
    expect(JSON.stringify(gate)).toContain(
      "не подтверждено проверкой на тестовой среде",
    );
    expect(JSON.stringify(gate)).toContain("Только это вхождение");
    expect(JSON.stringify(gate)).not.toContain("approval");

    for (const input of [
      request,
      {
        ...request,
        operation: "move",
        scope: "following",
        title: undefined,
        newStartsAt: `${day}T12:00:00+05:00`,
        newEndsAt: `${day}T13:00:00+05:00`,
      },
    ]) {
      const result = await applyCall(input);
      expect(result).toMatchObject({ ok: false, kind: "denied" });
      expect(JSON.stringify(result)).toContain("не подтверждено");
    }
    const past = await gateCall({
      ...request,
      originalDate: addDateDays(calendarToday(), -3),
      beforeStart: `${addDateDays(calendarToday(), -3)}T10:00:00+05:00`,
      beforeEnd: `${addDateDays(calendarToday(), -3)}T11:00:00+05:00`,
    });
    expect(past).toMatchObject({
      ok: true,
      data: { open: false, reason: "past" },
    });

    for (const bad of [
      { ...request, approval: "token" },
      { ...request, title: undefined },
      { ...request, scope: "all" },
      { ...request, accountId: "employee-b" },
    ]) {
      const result = await applyCall(bad);
      expect(result).toMatchObject({ ok: false });
    }
    // Nothing reached the (synthetic) server and no journal was started.
    expect(
      await app.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              syntheticEventMutations: number;
            }
          ).syntheticEventMutations,
      ),
    ).toBe(0);
    await expect(access(join(userData, "series-mutations"))).rejects.toThrow();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
