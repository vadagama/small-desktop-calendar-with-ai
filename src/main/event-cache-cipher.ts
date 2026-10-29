import { safeStorage } from "electron";
import type { CacheCipher } from "./event-cache.js";

// The synchronous safeStorage methods are deprecated in Electron 45; use the async ones.
export const safeStorageCipher: CacheCipher = {
  // On Linux without a keyring Electron falls back to a fixed built-in password
  // ("basic_text"), which is obfuscation rather than encryption: keep the cache in memory.
  isAvailable: async () =>
    !(
      process.platform === "linux" &&
      safeStorage.getSelectedStorageBackend() === "basic_text"
    ) && safeStorage.isAsyncEncryptionAvailable(),
  encrypt: (text) => safeStorage.encryptStringAsync(text),
  decrypt: (data) => safeStorage.decryptStringAsync(data),
};
