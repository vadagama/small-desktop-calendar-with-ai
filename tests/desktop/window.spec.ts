import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("local desktop UI runs with an isolated renderer and no external navigation", async () => {
  const userData = await mkdtemp(join(tmpdir(), "small-desktop-test-"));
  const executablePath = process.env.SMALL_APP_EXECUTABLE;
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
    ? new URL(process.env.ELECTRON_RENDERER_URL).href
    : "small-app://workspace/index.html";
  const app = await _electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : ["."]), `--user-data-dir=${userData}`],
    env: { ...process.env, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
  });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning")
        errors.push(message.text());
    });
    await expect(
      page.getByRole("heading", { name: "26 октября — 1 ноября" }),
    ).toBeVisible();
    expect(page.url()).toBe(rendererUrl);
    expect(
      await page.evaluate(() => ({
        node: typeof (globalThis as Record<string, unknown>).process,
        require: typeof (globalThis as Record<string, unknown>).require,
        bridge: {
          platform: window.smallDesktop.platform,
          sandboxed: window.smallDesktop.sandboxed,
          contextIsolated: window.smallDesktop.contextIsolated,
        },
      })),
    ).toEqual({
      node: "undefined",
      require: "undefined",
      bridge: { platform: "darwin", sandboxed: true, contextIsolated: true },
    });
    const preferences = await app.evaluate(({ app }) => ({
      rendererSandboxes: app
        .getAppMetrics()
        .filter((metric) => metric.type === "Tab")
        .map((metric) => metric.sandboxed),
      packaged: app.isPackaged,
      architecture: process.arch,
    }));
    expect(preferences.rendererSandboxes.length).toBeGreaterThan(0);
    expect(preferences.rendererSandboxes.every(Boolean)).toBe(true);
    expect(preferences.packaged).toBe(Boolean(executablePath));
    expect(preferences.architecture).toBe("arm64");
    const localSecurity = await app.evaluate(async ({ net }) => ({
      csp: (await net.fetch("small-app://workspace/index.html")).headers.get(
        "content-security-policy",
      ),
      traversal: (
        await net.fetch(
          "small-app://workspace/assets/%2f..%2f..%2fmain%2findex.js",
        )
      ).status,
    }));
    expect(localSecurity.csp).toContain("script-src 'self'");
    expect(localSecurity.csp).toContain("object-src 'none'");
    expect(localSecurity.traversal).toBe(404);
    await page.getByRole("button", { name: "Месяц", exact: true }).click();
    await expect(page.locator(".month-day")).toHaveCount(35);
    await page.screenshot({ path: "test-results/desktop/window.png" });
    await page.evaluate(() => {
      window.open("https://example.invalid");
    });
    expect(app.windows()).toHaveLength(1);
    await page.evaluate(() => {
      window.location.href = "https://example.invalid";
    });
    expect(await page.evaluate(() => location.href)).toBe(rendererUrl);
    // Electron cancels the navigation; Playwright's locator navigation wait can remain pending.
    // Inspect the document and native URL directly after the cancelled attempt.
    expect(
      await page.evaluate(() => document.querySelectorAll(".month-day").length),
    ).toBe(35);
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.webContents.getURL(),
      ),
    ).toBe(rendererUrl);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
