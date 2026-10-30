import type { ElectronApplication } from "@playwright/test";

/** Signs out of the isolated test profile before removing it. */
export async function signOutOfApp(app: ElectronApplication) {
  try {
    const page = await app.firstWindow();
    await page.evaluate(() => window.smallDesktop.smallAuth.logout());
  } catch {
    // The window is gone or nobody is signed in: nothing is left to remove.
  }
}
