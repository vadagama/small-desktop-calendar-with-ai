import { defineConfig } from "@playwright/test";

// Electron has no browser headless option; its test launch hides native windows.
process.env.SMALL_E2E_BACKGROUND ??= "1";

export default defineConfig({
  testDir: "./tests/desktop",
  workers: 1,
  timeout: 30_000,
  reporter: "list",
  outputDir: "test-results/desktop",
});
