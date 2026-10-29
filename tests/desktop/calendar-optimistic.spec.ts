import {
  _electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockSmall } from "./fixtures/small-api.js";
import { signOutOfApp } from "./fixtures/keychain.js";
import { calendarToday } from "../../src/shared/calendar-time.js";

type Inspection = typeof globalThis & {
  syntheticEventExtra: Record<string, unknown>;
  syntheticUpdateOutcome?: "reject" | "lose" | "lose-applied";
  syntheticUpdateDelayMs?: number;
  syntheticListDelayMs?: number;
};

/** Polling is far away, so only replies and explicit refreshes decide a move. */
async function open(run: (context: Context) => Promise<void>) {
  const userData = await mkdtemp(join(tmpdir(), "small-optimistic-"));
  const app = await _electron.launch({
    args: [
      ".",
      `--user-data-dir=${userData}`,
      "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
    ],
    env: { ...process.env, SMALL_TEST_SYNC_INTERVAL_MS: "600000" },
  });
  try {
    const date = calendarToday();
    await mockSmall(app, date);
    await app.evaluate((_electron, day) => {
      (globalThis as Inspection).syntheticEventExtra = {
        starts_at: `${day}T09:00:00+05:00`,
        ends_at: `${day}T09:30:00+05:00`,
      };
    }, date);
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
    await page.getByRole("button", { name: "День", exact: true }).click();
    const card = page
      .locator(".calendar-event")
      .filter({ hasText: "Синтетическая встреча A" });
    await expect(card).toContainText("09:00 – 09:30");
    await run({ app, page, card, date });
  } finally {
    await signOutOfApp(app);
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
}
interface Context {
  app: ElectronApplication;
  page: Page;
  card: ReturnType<Page["locator"]>;
  date: string;
}
const server = (
  app: ElectronApplication,
  values: Partial<
    Pick<
      Inspection,
      | "syntheticUpdateOutcome"
      | "syntheticUpdateDelayMs"
      | "syntheticListDelayMs"
    >
  >,
) =>
  app.evaluate((_electron, patch) => Object.assign(globalThis, patch), values);
async function dragDown({ page, card }: Context) {
  await card.hover();
  const box = (await card.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 16, { steps: 8 });
  await page.mouse.up();
}

test("a confirmed move shows at once, is marked while saving and stays", async () => {
  await open(async (context) => {
    const { app, page, card } = context;
    await server(app, { syntheticUpdateDelayMs: 1200 });
    await dragDown(context);
    // The card is already at the new time while Small has not answered.
    await expect(card).toContainText("09:15 – 09:45");
    await expect(card).toHaveAttribute("data-pending", "saving");
    await expect(page.getByText("Сохраняю время встречи…")).toHaveCount(0);
    expect(
      await page
        .locator(".calendar-toolbar")
        .evaluate((el) => getComputedStyle(el).fontSize),
    ).toBe("14px");
    await page.screenshot({
      path: "test-results/desktop/calendar-move-without-banner.png",
    });
    await expect(page.getByText("Время события изменено")).toBeVisible();
    await expect(card).not.toHaveAttribute("data-pending", /.+/);
    await expect(card).toContainText("09:15 – 09:45");
  });
});

test("a refused move goes back to the old time with an error", async () => {
  await open(async (context) => {
    const { app, page, card } = context;
    await server(app, {
      syntheticUpdateOutcome: "reject",
      syntheticUpdateDelayMs: 800,
    });
    await dragDown(context);
    await expect(card).toContainText("09:15 – 09:45");
    await expect(card).toHaveAttribute("data-pending", "saving");
    await expect(page.getByText(/Не удалось/).first()).toBeVisible();
    await expect(card).toContainText("09:00 – 09:30");
    await expect(card).not.toHaveAttribute("data-pending", /.+/);
  });
});

test("an unknown outcome is marked, then Small's own data decides: not applied", async () => {
  await open(async (context) => {
    const { app, page, card } = context;
    await server(app, {
      syntheticUpdateOutcome: "lose",
      syntheticListDelayMs: 1500,
    });
    await dragDown(context);
    await expect(card).toHaveAttribute("data-pending", "unknown");
    await expect(card).toContainText("09:15 – 09:45");
    // While the outcome is unknown the card is locked: it does not follow the pointer.
    await card.hover();
    const box = (await card.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 16, { steps: 8 });
    expect((await card.boundingBox())!.y).toBeCloseTo(box.y, 0);
    await page.mouse.up();
    await expect(card).toContainText("09:15 – 09:45");
    await expect(
      page.getByText(/Не удалось подтвердить действие/),
    ).toBeVisible();
    await expect(page.getByText(/Перенос не применён/)).toBeVisible();
    await expect(card).toContainText("09:00 – 09:30");
    await expect(card).not.toHaveAttribute("data-pending", /.+/);
  });
});

test("an unknown outcome is confirmed when the data shows it was applied", async () => {
  await open(async (context) => {
    const { app, page, card } = context;
    await server(app, {
      syntheticUpdateOutcome: "lose-applied",
      syntheticListDelayMs: 1500,
    });
    await dragDown(context);
    await expect(card).toHaveAttribute("data-pending", "unknown");
    await expect(page.getByText(/Перенос подтверждён/)).toBeVisible();
    await expect(card).toContainText("09:15 – 09:45");
    await expect(card).not.toHaveAttribute("data-pending", /.+/);
  });
});

test("a card that waits for Small cannot be dragged again", async () => {
  await open(async (context) => {
    const { app, page, card } = context;
    await server(app, { syntheticUpdateDelayMs: 1500 });
    await dragDown(context);
    await expect(card).toHaveAttribute("data-pending", "saving");
    await dragDown(context);
    await expect(card).toContainText("09:15 – 09:45");
    await expect(page.getByText("Время события изменено")).toBeVisible();
    await expect(card).toContainText("09:15 – 09:45");
  });
});
