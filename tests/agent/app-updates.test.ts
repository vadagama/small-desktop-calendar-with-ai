import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { AppUpdates } from "../../src/main/app-updates.js";

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = true;
  allowDowngrade = true;
  checks = 0;
  downloads = 0;
  installs = 0;
  async checkForUpdates() {
    this.checks++;
  }
  async downloadUpdate() {
    this.downloads++;
  }
  quitAndInstall() {
    this.installs++;
  }
}

test("downloads once, preserves ready state, installs only explicitly", async () => {
  const driver = new FakeUpdater();
  const updates = new AppUpdates("1.0.0", driver);
  assert.equal(updates.install(), false);
  await Promise.all([updates.check(), updates.check()]);
  assert.equal(driver.checks, 1);
  driver.emit("update-available", { version: "1.1.0", releaseNotes: "Fixes" });
  driver.emit("update-available", { version: "1.1.0" });
  await Promise.resolve();
  assert.equal(driver.downloads, 1);
  driver.emit("download-progress", { percent: 42.5 });
  assert.equal(updates.read().percent, 42.5);
  driver.emit("update-downloaded", { version: "1.1.0" });
  await updates.check();
  assert.equal(updates.read().status, "ready");
  assert.equal(updates.read().notes, "Fixes");
  assert.equal(driver.autoInstallOnAppQuit, false);
  assert.equal(driver.allowDowngrade, false);
  assert.equal(driver.allowPrerelease, false);
  assert.equal(driver.installs, 0);
  assert.equal(updates.install(), true);
  assert.equal(updates.install(), false);
  assert.equal(driver.installs, 1);
});

test("network failures are safe and retryable; errors do not leak URLs or credentials", async () => {
  const driver = new FakeUpdater();
  const updates = new AppUpdates("1.0.0", driver);
  driver.checkForUpdates = async () => {
    throw Error("https://secret:token@host");
  };
  await updates.check();
  assert.equal(updates.read().status, "error");
  assert.doesNotMatch(updates.read().message!, /secret|token|host/);
  driver.checkForUpdates = async () => {
    driver.emit("update-not-available");
  };
  await updates.check();
  assert.equal(updates.read().status, "current");
});

test("download rejection can be retried without losing the new release", async () => {
  const driver = new FakeUpdater();
  const updates = new AppUpdates("1.0.0", driver);
  driver.downloadUpdate = async () => {
    throw Error("offline");
  };
  driver.emit("update-available", {
    version: "1.1.0",
    releaseNotes: [{ version: "1.1.0", note: "Fix" }],
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updates.read().status, "error");
  assert.equal(updates.read().version, "1.1.0");
  assert.equal(updates.read().notes, "Fix");
  driver.downloadUpdate = async () => {
    driver.emit("update-downloaded", { version: "1.1.0" });
  };
  await updates.check();
  assert.equal(updates.read().status, "ready");
});

test("unconfigured builds never contact the feed or install", async () => {
  const updates = new AppUpdates(
    "1.0.0",
    undefined,
    "Нужна подписанная сборка",
  );
  assert.equal((await updates.check()).status, "unsupported");
  assert.equal(updates.install(), false);
});

test("startup and periodic timers stop cleanly", async () => {
  const driver = new FakeUpdater();
  const updates = new AppUpdates("1.0.0", driver);
  driver.checkForUpdates = async () => {
    driver.checks++;
    driver.emit("update-not-available");
  };
  const stop = updates.start(5, 15);
  await new Promise((resolve) => setTimeout(resolve, 45));
  stop();
  const count = driver.checks;
  assert.ok(count >= 2);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(driver.checks, count);
});
