import { meetingChannels } from "../shared/meeting-operations.js";
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  assistantChannels,
  type AgentEvent,
  type DesktopBridge,
} from "../shared/assistant.js";
import { calendarChannels } from "../shared/calendar.js";
import { smallAuthChannels } from "../shared/small-auth.js";
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
  meetings: {
    read: (input) => ipcRenderer.invoke(meetingChannels.read, input),
    edit: (input) => ipcRenderer.invoke(meetingChannels.edit, input),
    confirm: (input) => ipcRenderer.invoke(meetingChannels.confirm, input),
    reconcile: (input) => ipcRenderer.invoke(meetingChannels.reconcile, input),
  },
  calendar: {
    previewChange: (input) =>
      ipcRenderer.invoke(calendarChannels.previewChange, input),
    people: (input) => ipcRenderer.invoke(calendarChannels.people, input),
    slots: (input) => ipcRenderer.invoke(calendarChannels.slots, input),
    calendars: (input) => ipcRenderer.invoke(calendarChannels.calendars, input),
    events: (input) => ipcRenderer.invoke(calendarChannels.events, input),
    detail: (input) => ipcRenderer.invoke(calendarChannels.detail, input),
  },
  smallAuth: {
    read: () => ipcRenderer.invoke(smallAuthChannels.read),
    login: (input) => ipcRenderer.invoke(smallAuthChannels.login, input),
    logout: () => ipcRenderer.invoke(smallAuthChannels.logout),
  },
  profiles: {
    read: () => ipcRenderer.invoke(profileChannels.read),
    save: (input) => ipcRenderer.invoke(profileChannels.save, input),
    activate: (id) => ipcRenderer.invoke(profileChannels.activate, id),
    remove: (id) => ipcRenderer.invoke(profileChannels.remove, id),
  },
};
contextBridge.exposeInMainWorld("smallDesktop", bridge);
