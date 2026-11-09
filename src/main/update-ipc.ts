import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
} from "electron";
import electronUpdater from "electron-updater";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AppUpdates } from "./app-updates.js";
import { updateChannels } from "../shared/updates.js";

export function registerUpdates(
  trusted: (event: IpcMainInvokeEvent) => boolean,
) {
  const configured =
    app.isPackaged &&
    process.platform === "darwin" &&
    existsSync(join(process.resourcesPath, "app-update.yml"));
  const driver = configured ? electronUpdater.autoUpdater : undefined;
  // Packager produces complete ZIPs; no blockmaps are published by this pipeline.
  if (driver) driver.disableDifferentialDownload = true;
  const updates = new AppUpdates(
    app.getVersion(),
    driver,
    app.isPackaged
      ? "В этой сборке автообновление недоступно. Установите выпуск с подписью Developer ID."
      : "В режиме разработки автообновление отключено. Оно доступно в подписанном выпуске macOS.",
    (state) => {
      for (const window of BrowserWindow.getAllWindows())
        if (!window.isDestroyed())
          window.webContents.send(updateChannels.changed, state);
    },
  );
  for (const action of ["read", "check"] as const) {
    ipcMain.handle(updateChannels[action], (event) => {
      if (!trusted(event)) throw new Error("Доступ к обновлениям отклонён");
      return updates[action]();
    });
  }
  let confirming = false;
  ipcMain.handle(updateChannels.install, async (event) => {
    if (!trusted(event) || confirming || updates.read().status !== "ready")
      return { ok: false };
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return { ok: false };
    confirming = true;
    try {
      const answer = await dialog.showMessageBox(window, {
        type: "question",
        title: "Установить обновление?",
        message: "Перезапустить календарь и установить обновление?",
        detail:
          "Сохраните несохранённые изменения и завершите голосовой ввод. Настройки, авторизация и сохранённый контекст останутся на месте.",
        buttons: ["Позже", "Перезапустить и установить"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return {
        ok: answer.response === 1 && trusted(event) && updates.install(),
      };
    } catch {
      return { ok: false };
    } finally {
      confirming = false;
    }
  });
  app.once("before-quit", updates.start());
}
