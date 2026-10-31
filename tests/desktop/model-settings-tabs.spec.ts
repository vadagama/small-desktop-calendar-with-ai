import { _electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("model settings switch between LLM and Voice and preserve the LLM draft", async () => {
  const profile = await mkdtemp(join(tmpdir(), "small-model-tabs-"));
  const app = await _electron.launch({
    args: [".", `--user-data-dir=${profile}`],
  });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Настройки AI-помощника", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Голосовой ввод" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Закрыть настройки AI-помощника" })
      .click();
    await page
      .getByRole("button", { name: "Настройки модели", exact: true })
      .click();
    const llm = page.getByRole("tab", { name: "LLM", exact: true }),
      voice = page.getByRole("tab", { name: "Voice", exact: true });
    await expect(llm).toHaveAttribute("aria-selected", "true");
    await page.getByLabel("Model ID", { exact: true }).fill("draft-model");
    await voice.click();
    await expect(page.getByLabel("Источник звука")).toBeVisible();
    await expect(
      page.getByLabel("Model ID", { exact: true }),
    ).not.toBeVisible();
    expect(await voice.evaluate((el) => getComputedStyle(el).fontSize)).toBe(
      "14px",
    );
    await page.screenshot({ path: "/tmp/model-settings-voice-tab.png" });
    await voice.press("ArrowLeft");
    await expect(llm).toBeFocused();
    await expect(page.getByLabel("Model ID", { exact: true })).toHaveValue(
      "draft-model",
    );
    await expect(page.getByLabel("Источник звука")).toHaveCount(0);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
