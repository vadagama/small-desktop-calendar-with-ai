import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  assistantChannels,
  type AgentEvent,
  type DesktopBridge,
} from "../shared/assistant.js";
import { profileChannels } from "../shared/profiles.js";

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
  profiles: {
    read: () => ipcRenderer.invoke(profileChannels.read),
    save: (input) => ipcRenderer.invoke(profileChannels.save, input),
    activate: (id) => ipcRenderer.invoke(profileChannels.activate, id),
    remove: (id) => ipcRenderer.invoke(profileChannels.remove, id),
  },
};
contextBridge.exposeInMainWorld("smallDesktop", bridge);
