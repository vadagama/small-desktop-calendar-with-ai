import { topicRuleChannels } from "../shared/topic-rule-channels.js";
import { memoryChannels } from "../shared/assistant-memory-channels.js";
import { seriesChannels } from "../shared/series-channels.js";
import { agentSettingsChannels } from "../shared/agent-settings.js";
import {
  reminderChannels,
  nativeNotificationChannels,
} from "../shared/reminders.js";
import { meetingChannels } from "../shared/meeting-operations.js";
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  assistantChannels,
  type AgentEvent,
  type DesktopBridge,
} from "../shared/assistant.js";
import { calendarChannels, type CalendarChange } from "../shared/calendar.js";
import { smallAuthChannels } from "../shared/small-auth.js";
import { profileChannels } from "../shared/profiles.js";

const bridge: DesktopBridge = {
  memory: {
    read: () => ipcRenderer.invoke(memoryChannels.read),
    write: (input) => ipcRenderer.invoke(memoryChannels.write, input),
    confirm: (input) => ipcRenderer.invoke(memoryChannels.confirm, input),
    reset: () => ipcRenderer.invoke(memoryChannels.reset),
  },
  notifications: {
    read: () => ipcRenderer.invoke(nativeNotificationChannels.read),
    test: () => ipcRenderer.invoke(nativeNotificationChannels.test),
    settings: () => ipcRenderer.invoke(nativeNotificationChannels.settings),
  },
  reminders: {
    read: () => ipcRenderer.invoke(reminderChannels.read),
    save: (input) => ipcRenderer.invoke(reminderChannels.save, input),
    join: (id) => ipcRenderer.invoke(reminderChannels.join, id),
  },
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
    attach: (remaining) =>
      ipcRenderer.invoke(meetingChannels.attach, remaining),
    prepare: (input) => ipcRenderer.invoke(meetingChannels.prepare, input),
    read: (input) => ipcRenderer.invoke(meetingChannels.read, input),
    edit: (input) => ipcRenderer.invoke(meetingChannels.edit, input),
    confirm: (input) => ipcRenderer.invoke(meetingChannels.confirm, input),
    reconcile: (input) => ipcRenderer.invoke(meetingChannels.reconcile, input),
  },
  calendar: {
    respond: (input) => ipcRenderer.invoke(calendarChannels.respond, input),
    openLink: (url) => ipcRenderer.invoke(calendarChannels.openLink, url),
    copyLink: (url) => ipcRenderer.invoke(calendarChannels.copyLink, url),
    reschedule: (input) =>
      ipcRenderer.invoke(calendarChannels.reschedule, input),
    updateEvent: (input) =>
      ipcRenderer.invoke(calendarChannels.updateEvent, input),
    applyChange: (input) =>
      ipcRenderer.invoke(calendarChannels.applyChange, input),
    previewChange: (input) =>
      ipcRenderer.invoke(calendarChannels.previewChange, input),
    people: (input) => ipcRenderer.invoke(calendarChannels.people, input),
    slots: (input) => ipcRenderer.invoke(calendarChannels.slots, input),
    calendars: (input) => ipcRenderer.invoke(calendarChannels.calendars, input),
    events: (input) => ipcRenderer.invoke(calendarChannels.events, input),
    detail: (input) => ipcRenderer.invoke(calendarChannels.detail, input),
    subscribe: (listener) => {
      const handler = (_event: IpcRendererEvent, change: CalendarChange) =>
        listener(change);
      ipcRenderer.on(calendarChannels.changed, handler);
      return () =>
        ipcRenderer.removeListener(calendarChannels.changed, handler);
    },
  },
  smallAuth: {
    subscribeRequired: (listener) => {
      const handler = () => listener();
      ipcRenderer.on(smallAuthChannels.required, handler);
      return () =>
        ipcRenderer.removeListener(smallAuthChannels.required, handler);
    },
    read: () => ipcRenderer.invoke(smallAuthChannels.read),
    login: (input) => ipcRenderer.invoke(smallAuthChannels.login, input),
    logout: () => ipcRenderer.invoke(smallAuthChannels.logout),
  },
  agentSettings: {
    read: () => ipcRenderer.invoke(agentSettingsChannels.read),
    save: (input) => ipcRenderer.invoke(agentSettingsChannels.save, input),
    reset: () => ipcRenderer.invoke(agentSettingsChannels.reset),
  },
  topicRules: {
    read: () => ipcRenderer.invoke(topicRuleChannels.read),
    save: (rules) => ipcRenderer.invoke(topicRuleChannels.save, rules),
  },
  series: {
    gate: (request) => ipcRenderer.invoke(seriesChannels.gate, request),
    apply: (request) => ipcRenderer.invoke(seriesChannels.apply, request),
  },
  profiles: {
    read: () => ipcRenderer.invoke(profileChannels.read),
    save: (input) => ipcRenderer.invoke(profileChannels.save, input),
    activate: (id) => ipcRenderer.invoke(profileChannels.activate, id),
    remove: (id) => ipcRenderer.invoke(profileChannels.remove, id),
  },
};
contextBridge.exposeInMainWorld("smallDesktop", bridge);
