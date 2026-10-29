import { registerReminders } from "./reminder-ipc.js";
import { EventMutations } from "./event-mutations.js";
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
  const meetings = new MeetingOperations(
    new MeetingJournal(resolve(app.getPath("userData"), "meeting-operations")),
    new SmallMeetingWriter(smallAuth, calendar, availability),
  );
  const assistant = registerAssistantHandlers(
    devUrl || localUrl,
    resolve(here, "agent-worker.js"),
    (signal) => profiles.resolveActive(signal),
    async (prompt, signal) => {
      const state = await smallAuth.read();
      signal.throwIfAborted();
      return state.status === "signed-in"
        ? createCalendarToolExecutor(
            state.profile.id,
            prompt,
            signal,
            calendar,
            availability,
            state.profile.name,
            (draft) => meetings.register(draft),
          )
        : null;
    },
  );
  registerProfileHandlers(profiles, assistant.trusted, assistant.cancelActive);
  registerMeetingHandlers(meetings, smallAuth, assistant.trusted, availability);

  const eventOwner = async (accountId: string) => {
    const state = await smallAuth.read();
    if (
      state.status !== "signed-in" ||
      state.profile.id !== accountId ||
      !state.profile.participantId
    )
      throw new Error("Нет подтверждённого GUID организатора.");
    return state.profile.participantId;
  };
  const mutations = new EventMutations(
    smallAuth,
    new MeetingJournal(resolve(app.getPath("userData"), "event-mutations")),
    eventOwner,
  );
  registerCalendarHandlers(
    calendar,
    assistant.trusted,
    availability,
    new EventChangeService(smallAuth, eventOwner, (account, raw, change) =>
      mutations.register(account, raw, change),
    ),
    mutations,
    smallAuth,
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
      } else void createWindow();
    },
  );
  app.on("before-quit", () => reminders.stop());
  registerSmallAuthHandlers(smallAuth, assistant.trusted, () => {
    assistant.cancelActive();
    reminders.invalidate();
  });
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
