import { _electron, expect, test, type Page } from "@playwright/test";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockSmall } from "./fixtures/small-api.js";
import { signOutOfApp } from "./fixtures/keychain.js";
import { calendarToday } from "../../src/shared/calendar-time.js";

type Inspection = typeof globalThis & {
  syntheticEventExtra: Record<string, unknown>;
};

const SECRETS = [
  "Секретное название",
  "Секретная повестка",
  "Секретная переговорная",
  "employee-a",
  "event:42",
];

async function cacheFiles(userData: string) {
  const root = join(userData, "event-cache");
  const entries = await readdir(root, { recursive: true }).catch(() => []);
  return entries
    .filter((entry) => entry.endsWith(".json"))
    .map((e) => join(root, e));
}

test("on disk the cache is ciphertext with tight modes, and sign-out or another account leaves nothing behind", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-cache-security-"));
  const app = await _electron.launch({
    args: [
      ".",
      `--user-data-dir=${userData}`,
      "--host-resolver-rules=MAP team.small.kz ~NOTFOUND",
    ],
    env: { ...process.env, SMALL_TEST_SYNC_INTERVAL_MS: "600000" },
  });
  try {
    // Any accidental reintroduction of Electron's OS key storage must fail this flow.
    await app.evaluate(({ safeStorage }) => {
      const denied = () => {
        throw Error("Native credential storage is forbidden in this test");
      };
      safeStorage.isAsyncEncryptionAvailable = denied;
      safeStorage.encryptStringAsync = denied;
      safeStorage.decryptStringAsync = denied;
      safeStorage.isEncryptionAvailable = denied;
      safeStorage.encryptString = denied;
      safeStorage.decryptString = denied;
    });
    const date = calendarToday();
    await mockSmall(app, date);
    await app.evaluate((_electron, day) => {
      (globalThis as Inspection).syntheticEventExtra = {
        title: "Секретное название",
        description: "Секретная повестка",
        location: "Секретная переговорная",
        starts_at: `${day}T09:00:00+05:00`,
        ends_at: `${day}T09:30:00+05:00`,
      };
    }, date);
    const page = await app.firstWindow();
    const signIn = async (user: string, reopen: boolean) => {
      if (reopen)
        await page
          .getByRole("button", { name: "Профиль Small", exact: true })
          .click();
      await page.getByLabel("Логин", { exact: true }).fill(user);
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
    };
    const signOut = async (page: Page) => {
      await page
        .getByRole("button", { name: "Профиль Small", exact: true })
        .click();
      await page.getByRole("button", { name: "Выйти из Small" }).click();
    };
    await signIn("employee-a", true);
    await page.getByRole("button", { name: "День", exact: true }).click();
    await expect(
      page.locator(".calendar-event").filter({ hasText: "Секретное название" }),
    ).toBeVisible();

    // Events and catalogs reached the disk, as ciphertext only, in private files.
    await expect
      .poll(async () => (await cacheFiles(userData)).length)
      .toBeGreaterThan(0);
    const files = await cacheFiles(userData);
    for (const path of files) {
      expect((await stat(path)).mode & 0o777, path).toBe(0o600);
      const text = await readFile(path, "utf8");
      // The envelope carries the ciphertext as base64, so look inside it too: plaintext
      // would be invisible in the file yet obvious after decoding.
      const inner = Buffer.from(
        (JSON.parse(text) as { data: string }).data,
        "base64",
      ).toString("utf8");
      expect(() => JSON.parse(inner), "payload is readable JSON").toThrow();
      for (const secret of SECRETS) {
        expect(text, `${secret} in file content`).not.toContain(secret);
        expect(inner, `${secret} in decoded payload`).not.toContain(secret);
        expect(path, `${secret} in file name`).not.toContain(secret);
      }
    }
    expect((await stat(join(userData, "event-cache"))).mode & 0o777).toBe(
      0o700,
    );

    // Signing out removes every cached byte.
    await signOut(page);
    await expect.poll(async () => (await cacheFiles(userData)).length).toBe(0);

    // Another account sees only its own data, and nothing of the first one is on disk.
    await signIn("employee-b", false);
    await page.getByRole("button", { name: "День", exact: true }).click();
    await expect(
      page.locator(".calendar-event").filter({ hasText: "Секретное название" }),
    ).toBeVisible();
    for (const path of await cacheFiles(userData)) {
      const text = await readFile(path, "utf8");
      const inner = Buffer.from(
        (JSON.parse(text) as { data: string }).data,
        "base64",
      ).toString("utf8");
      expect(text).not.toContain("employee-a");
      expect(inner).not.toContain("employee-a");
    }
    await signOut(page);
    await expect.poll(async () => (await cacheFiles(userData)).length).toBe(0);
  } finally {
    await signOutOfApp(app);
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
