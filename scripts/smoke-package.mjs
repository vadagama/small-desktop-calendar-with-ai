import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";

function rssKiB(rootPid) {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,rss="], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number));
  const ids = new Set([rootPid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const [pid, parent] of rows)
      if (ids.has(parent) && !ids.has(pid)) {
        ids.add(pid);
        changed = true;
      }
  }
  return rows
    .filter(([pid]) => ids.has(pid))
    .reduce((sum, row) => sum + row[2], 0);
}

/** Renderer CDP works without enabling the privileged Node inspector in release builds. */
export async function smokePackage(executable, userData) {
  const start = performance.now();
  const child = spawn(
    executable,
    ["--remote-debugging-port=0", `--user-data-dir=${userData}`],
    {
      env: {
        ...process.env,
        SMALL_TEST_SYNTHETIC: "1",
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let browser;
  let output = "";
  const exited = once(child, "exit");
  try {
    const endpoint = await new Promise((done, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`No renderer debugger: ${output.slice(-1500)}`)),
        20_000,
      );
      const cleanup = () => {
        clearTimeout(timer);
        child.stderr.off("data", data);
        child.off("exit", earlyExit);
        child.off("error", failed);
      };
      const failed = (error) => {
        cleanup();
        reject(error);
      };
      const earlyExit = () =>
        failed(
          new Error(`Packaged app exited before UI: ${output.slice(-1500)}`),
        );
      const data = (chunk) => {
        output += chunk.toString();
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) {
          cleanup();
          done(match[1]);
        }
      };
      child.stderr.on("data", data);
      child.once("error", failed);
      child.once("exit", earlyExit);
    });
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? (await context.waitForEvent("page"));
    await expect(
      page.getByRole("heading", { name: "Календарь Small", exact: true }),
    ).toBeVisible();
    const readyMs = Math.round(performance.now() - start);
    assert.deepEqual(
      await page.evaluate(() => ({
        node: typeof globalThis.process,
        sandbox: window.smallDesktop.sandboxed,
        isolation: window.smallDesktop.contextIsolated,
      })),
      { node: "undefined", sandbox: true, isolation: true },
    );
    const idleRssKiB = rssKiB(child.pid);
    await page
      .getByRole("textbox", { name: "Сообщение ассистенту" })
      .fill("Сложи 2 и 3");
    await page.getByRole("button", { name: "Отправить сообщение" }).click();
    await expect(page.getByRole("log")).toContainText("Результат: 5");
    await expect(
      page.getByRole("button", { name: "Остановить ответ" }),
    ).toHaveCount(0);
    const chatRssKiB = rssKiB(child.pid);
    await page.close();
    const closedWindowRssKiB = rssKiB(child.pid);
    return { readyMs, idleRssKiB, chatRssKiB, closedWindowRssKiB };
  } finally {
    child.kill("SIGTERM");
    const kill = setTimeout(() => child.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(kill);
    await browser?.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const executable = process.argv[2];
  if (!executable)
    throw new Error("Usage: node scripts/smoke-package.mjs path/to/executable");
  const userData = await mkdtemp(join(tmpdir(), "small-package-smoke-"));
  try {
    console.log(
      JSON.stringify(
        await smokePackage(resolve(executable), userData),
        null,
        2,
      ),
    );
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
}
