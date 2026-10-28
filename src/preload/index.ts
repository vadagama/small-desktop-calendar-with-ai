import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  assistantChannels,
  type AgentEvent,
  type DesktopBridge,
} from "../shared/assistant.js";

const bridge: DesktopBridge = {
  platform: process.platform,
  sandboxed: process.sandboxed === true,
  contextIsolated: process.contextIsolated === true,
  assistant: {
    start: (request) => ipcRenderer.invoke(assistantChannels.start, request),
    cancel: (requestId) =>
      ipcRenderer.invoke(assistantChannels.cancel, requestId),
    subscribe: (listener) => {
      const handler = (_event: IpcRendererEvent, data: AgentEvent) =>
        listener(data);
      ipcRenderer.on(assistantChannels.event, handler);
      return () => ipcRenderer.removeListener(assistantChannels.event, handler);
    },
  },
};
contextBridge.exposeInMainWorld("smallDesktop", bridge);
