import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("smallDesktop", {
  platform: process.platform,
  sandboxed: process.sandboxed === true,
  contextIsolated: process.contextIsolated === true,
});
