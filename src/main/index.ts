import { EventMutationJournal } from "./event-mutation-journal.js";
import { ParticipantMemory } from "./participant-memory.js";
import { AgentSettingsStore } from "./agent-settings.js";
import { registerAgentSettingsHandlers } from "./agent-settings-ipc.js";
import { EventRescheduleService } from "./event-reschedule.js";
import { registerReminders } from "./reminder-ipc.js";
import { TopicRuleStore } from "./topic-rules.js";
import { registerTopicRuleHandlers } from "./analytics-ipc.js";
import { SmallSeriesBackend } from "./series-backend.js";
import { SeriesMutationService } from "./series-adapter.js";
import { SeriesController } from "./series-controller.js";
import { registerSeriesHandlers } from "./series-ipc.js";
import { EventChangeService } from "./event-change.js";
import { MeetingOperations } from "./meeting-operations.js";
import { MeetingJournal } from "./meeting-journal.js";
import { SmallMeetingWriter } from "./meeting-writer.js";
import { registerMeetingHandlers } from "./meeting-ipc.js";
import { createCalendarToolExecutor } from "./calendar-tools.js";
import { app, BrowserWindow, net, protocol, session } from "electron";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerAssistantHandlers } from "./assistant.js";
import { ProfileStore } from "./profiles.js";
import { KeychainSecrets } from "./keychain.js";
import { registerProfileHandlers } from "./profile-ipc.js";

import { CalendarService } from "./calendar.js";
import { CalendarSync } from "./calendar-sync.js";
import { CachedCatalog, assistantCalendarSource } from "./calendar-catalog.js";
import { EventCache } from "./event-cache.js";
import { safeStorageCipher } from "./event-cache-cipher.js";
import { calendarChannels, type CalendarChange } from "../shared/calendar.js";
import type { MeetingWriter } from "./meeting-operations.js";
import { meetingTarget } from "./write-target.js";
import { invalidatingSeries } from "./series-invalidation.js";
import { AvailabilityService } from "./availability.js";
import { registerCalendarHandlers } from "./calendar-ipc.js";
import { SmallAuth } from "./small-auth.js";
import { createSmallSession } from "./small-session.js";
import { registerSmallAuthHandlers } from "./small-auth-ipc.js";

const here = dirname(fileURLToPath(import.meta.url));
const rendererRoot = resolve(here, "../renderer");
const appIcon = resolve(
  app.isPackaged ? rendererRoot : resolve(here, "../../prototype/public"),
  "app-icon.png",
);
const localUrl = "small-app://workspace/index.html";
const configuredDevUrl = !app.isPackaged
  ? process.env.ELECTRON_RENDERER_URL
  : undefined;
const devUrl = configuredDevUrl ? new URL(configuredDevUrl).href : undefined;
if (devUrl && new URL(devUrl).origin !== "http://127.0.0.1:5174") {
  throw new Error("Unexpected renderer development origin");
}

// https://www.electronjs.org/docs/latest/api/protocol
protocol.registerSchemesAsPrivileged([
  {
    scheme: "small-app",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app.setName("Small Calendar");

const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  devUrl ? "connect-src 'self' ws://127.0.0.1:5174" : "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "form-action 'none'",
].join("; ");

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#ffffff",
    icon: appIcon,
    show: false,
    webPreferences: {
      preload: resolve(here, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
    },
  });
  // https://www.electronjs.org/docs/latest/tutorial/security
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-frame-navigate", (event) =>
    event.preventDefault(),
  );
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.once("ready-to-show", () => window.show());
  await window.loadURL(devUrl || localUrl);
}

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on("second-instance", () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  } else if (app.isReady()) void createWindow();
});
app.whenReady().then(async () => {
  if (!primaryInstance) return;
  app.dock?.setIcon(appIcon);
  const participantMemory = new ParticipantMemory(app.getPath("userData"));
  const agentSettings = new AgentSettingsStore(app.getPath("userData"));
  const topicRules = new TopicRuleStore(app.getPath("userData"));
  const profiles = new ProfileStore(
    app.getPath("userData"),
    new KeychainSecrets(app.getPath("userData")),
  );
  const smallAuth = new SmallAuth(
    createSmallSession(),
    new KeychainSecrets(app.getPath("userData")),
  );
  const calendar = new CalendarService(smallAuth);
  const availability = new AvailabilityService(smallAuth);
  // One cache for events and catalogs, so sign-in and sign-out clear both.
  const eventCache = new EventCache(
    resolve(app.getPath("userData"), "event-cache"),
    safeStorageCipher,
  );
  const catalog = new CachedCatalog(calendar, eventCache);
  const calendarSync = new CalendarSync(
    calendar,
    eventCache,
    (change: CalendarChange) => {
      for (const window of BrowserWindow.getAllWindows())
        if (!window.isDestroyed())
          window.webContents.send(calendarChannels.changed, change);
    },
    {
      // Desktop tests shorten the poll period; a packaged app always uses 60 s.
      ...(!app.isPackaged && Number(process.env.SMALL_TEST_SYNC_INTERVAL_MS) > 0
        ? { intervalMs: Number(process.env.SMALL_TEST_SYNC_INTERVAL_MS) }
        : {}),
      online: () => net.isOnline(),
      visible: () =>
        BrowserWindow.getAllWindows().some(
          (window) => window.isVisible() && !window.isMinimized(),
        ),
    },
  );
  app.on("browser-window-focus", () => calendarSync.wake());
  app.on("before-quit", () => calendarSync.stop());
  const meetingWriter = new SmallMeetingWriter(
    smallAuth,
    calendar,
    availability,
  );
  // Creating a meeting changes Small's calendar, so the cached copy is dropped.
  const writer: MeetingWriter = {
    preflight: (draft) => meetingWriter.preflight(draft),
    verify: (draft, eventId) => meetingWriter.verify(draft, eventId),
    wasDeleted: (draft, eventId) => meetingWriter.wasDeleted(draft, eventId),
    create: async (draft) => {
      try {
        return await meetingWriter.create(draft);
      } finally {
        await calendarSync.invalidate(meetingTarget(draft));
      }
    },
  };
  const meetings = new MeetingOperations(
    new MeetingJournal(resolve(app.getPath("userData"), "meeting-operations")),
    writer,
  );
  const eventChanges = new EventChangeService(smallAuth);
  const assistant = registerAssistantHandlers(
    devUrl || localUrl,
    resolve(here, "agent-worker.js"),
    (signal) => profiles.resolveActive(signal),
    async (prompt, signal, conversation) => {
      const state = await smallAuth.read();
      signal.throwIfAborted();
      conversation.bindAccount(
        state.status === "signed-in" ? state.profile.id : null,
      );
      return state.status === "signed-in"
        ? createCalendarToolExecutor(
            state.profile.id,
            prompt,
            signal,
            assistantCalendarSource(calendar, catalog),
            availability,
            state.profile.name,
            (draft) => meetings.register(draft),
            conversation,
            participantMemory,
            state.profile.participantId,
            () => topicRules.read(),
            eventChanges,
          )
        : null;
    },
    () => agentSettings.read(),
  );
  registerAgentSettingsHandlers(agentSettings, assistant.trusted);
  registerTopicRuleHandlers(topicRules, assistant.trusted);
  registerProfileHandlers(profiles, assistant.trusted, assistant.cancelActive);
  registerMeetingHandlers(meetings, smallAuth, assistant.trusted, availability);

  registerCalendarHandlers(
    calendar,
    assistant.trusted,
    availability,
    eventChanges,
    new EventRescheduleService(
      smallAuth,
      new EventMutationJournal(
        resolve(app.getPath("userData"), "event-mutations"),
      ),
    ),
    calendarSync,
    catalog,
  );
  const series = new SeriesController(
    smallAuth,
    new SeriesMutationService(
      new SmallSeriesBackend(smallAuth, calendar),
      new EventMutationJournal(
        resolve(app.getPath("userData"), "series-mutations"),
      ),
    ),
  );
  registerSeriesHandlers(
    invalidatingSeries(series, calendarSync),
    assistant.trusted,
  );
  const reminders = registerReminders(
    app.getPath("userData"),
    smallAuth,
    calendar,
    assistant.trusted,
    () => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window) {
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
      } else return createWindow();
    },
  );
  app.on("before-quit", () => reminders.stop());
  registerSmallAuthHandlers(
    smallAuth,
    assistant.trusted,
    () => {
      assistant.cancelActive();
      reminders.invalidate();
    },
    () => calendarSync.reset().catch(() => {}),
  );
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });
  protocol.handle("small-app", async (request) => {
    try {
      if (request.method !== "GET") return new Response(null, { status: 405 });
      const url = new URL(request.url);
      const path = resolve(
        rendererRoot,
        `.${decodeURIComponent(url.pathname)}`,
      );
      if (
        url.host !== "workspace" ||
        url.username ||
        url.password ||
        !path.startsWith(rendererRoot + sep)
      ) {
        return new Response("Not found", { status: 404 });
      }
      const response = await net.fetch(pathToFileURL(path).href);
      const headers = new Headers(response.headers);
      headers.set("Content-Security-Policy", csp);
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(response.body, {
        status: response.status,
        headers,
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

// Closing the last window keeps the process alive on macOS; Cmd+Q quits.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
