import type { ElectronApplication } from "@playwright/test";

/**
 * Every sign-in in a test stores a session in the real macOS Keychain. The entry is owned
 * by the Electron process, so a test runner cannot delete it from outside ("Invalid
 * attempt to change the owner of this item"); only the app can, by signing out. Call this
 * before closing the app so test runs do not pile up credentials.
 */
export async function signOutOfApp(app: ElectronApplication) {
  try {
    const page = await app.firstWindow();
    await page.evaluate(() => window.smallDesktop.smallAuth.logout());
  } catch {
    // The window is gone or nobody is signed in: nothing is left to remove.
  }
}
