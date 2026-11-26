// Wails bridge. Unported operations are unavailable in this preview.
import { CalendarError, CalendarService } from "../src/main/calendar.js";
import type {
  CalendarChange,
  CalendarReadQuery,
  CalendarReply,
  CalendarResult,
} from "../src/shared/calendar.js";
import { diffEvents } from "../src/shared/calendar-diff.js";
import {
  cachedEventsSchema,
  cachedPeopleSchema,
} from "../src/shared/calendar-cache-schema.js";
import { eventRangeKey } from "../src/shared/calendar-time.js";
import type { MemoryReply } from "../src/shared/assistant-memory.js";
import type { AgentSettingsReply } from "../src/shared/agent-settings.js";
import type {
  SeriesApplyResult,
  SeriesGateState,
} from "../src/shared/series-scope.js";
import type { MeetingDraft } from "../src/shared/meeting-draft.js";
import type { MeetingReply } from "../src/shared/meeting-operations.js";
import type {
  AgentEvent,
  DesktopBridge,
  StartResult,
} from "../src/shared/assistant.js";
import type { ProfileReply } from "../src/shared/profiles.js";
import type { TopicRulesReply } from "../src/shared/analytics.js";
import type { SlotsResult } from "../src/shared/calendar.js";
import type {
  AvailabilityAnalysis,
  AvailabilityOpening,
} from "../src/shared/availability-analysis.js";
import type { EventListResult } from "../src/shared/event-list.js";
import type { SmallAuthReply } from "../src/shared/small-auth.js";
import type { UpdateState } from "../src/shared/updates.js";
import type {
  ReminderReply,
  NativeNotificationState,
} from "../src/shared/reminders.js";
import type { VoiceReply, VoiceRequest } from "../src/shared/voice.js";

const runtimeURL = "/wails/runtime.js";
const runtime = import(/* @vite-ignore */ runtimeURL) as Promise<{
  Call: { ByID<T>(id: number, ...args: unknown[]): Promise<T> };
  Events: {
    On(name: string, listener: (event: { data: unknown }) => void): () => void;
  };
}>;
// IDs are registered in main.go.
const bindings = {
  Read: 1,
  Login: 2,
  Logout: 3,
  Calendars: 4,
  EventSource: 5,
  EventDetail: 6,
  Respond: 7,
  ApplyChange: 8,
  Reschedule: 9,
  PrepareMeeting: 10,
  ConfirmMeeting: 11,
  ReadMeeting: 12,
  EditMeeting: 13,
  People: 14,
  GateSeries: 15,
  ApplySeries: 16,
  Attach: 17,
  Assistant: 18,
  Reminders: 19,
  Notifications: 20,
  Voice: 21,
  ReadUpdates: 22,
  CheckUpdates: 23,
  InstallUpdate: 24,
  ImportedCalendarCache: 25,
  OpenLink: 26,
  CopyLink: 27,
} as const;
async function call<T>(
  method: keyof typeof bindings,
  ...args: unknown[]
): Promise<T> {
  return (await runtime).Call.ByID<T>(bindings[method], ...args);
}

function voiceRequest(input: VoiceRequest) {
  if (input.action !== "transcribe") return call<VoiceReply>("Voice", input);
  if (input.pcm.byteLength > 7_680_000)
    return Promise.resolve({
      ok: false as const,
      error: "Слишком длинная запись",
    });
  const bytes = new Uint8Array(input.pcm);
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 32_768)
    chunks.push(
      String.fromCharCode(...bytes.subarray(offset, offset + 32_768)),
    );
  return call<VoiceReply>("Voice", { ...input, pcm: btoa(chunks.join("")) });
}

function calendarReader(
  allowStale = false,
  observeSource?: (source: { fetchedAt: number; stale: boolean }) => void,
) {
  return new CalendarService({
    async readCalendar(accountId, action) {
      const auth = await call<SmallAuthReply>("Read");
      if (!auth.ok) {
        throw new CalendarError(
          auth.kind === "denied" ||
            auth.kind === "auth" ||
            auth.kind === "invalid"
            ? auth.kind
            : "network",
          auth.error,
        );
      }
      if (
        auth.state.status !== "signed-in" ||
        auth.state.profile.id !== accountId
      )
        throw new CalendarError("auth", "Войдите в нужный аккаунт Small.");
      return action(async (path) => {
        const url = new URL(path, "https://team.small.kz");
        if (url.pathname === "/gate/employee/api/search/persons") {
          const people = await call<CalendarReply<string>>(
            "People",
            accountId,
            url.searchParams.get("q"),
            Number(url.searchParams.get("page")),
          );
          if (!people.ok) throw new CalendarError(people.kind, people.error);
          return new Response(people.data);
        }
        const source =
          /^\/gate\/team\/api\/calendars\/([A-Za-z0-9_-]+)\/events$/.exec(
            url.pathname,
          )?.[1];
        if (!source) {
          const detail =
            /^\/gate\/team\/api\/calendar\/events\/([A-Za-z0-9_-]+)$/.exec(
              url.pathname,
            )?.[1];
          const id =
            detail === "generated"
              ? url.searchParams.get("original_event_id")
              : detail;
          const date =
            detail === "generated" ? url.searchParams.get("date") : "";
          if (!id || date === null)
            throw new CalendarError("invalid", "Неизвестный тип календаря.");
          const detailReply = await call<CalendarReply<string>>(
            "EventDetail",
            accountId,
            id,
            date,
          );
          if (!detailReply.ok)
            throw new CalendarError(detailReply.kind, detailReply.error);
          return new Response(detailReply.data);
        }
        const reply = await call<
          CalendarReply<{ body: string; fetchedAt: number; stale: boolean }>
        >(
          "EventSource",
          accountId,
          source,
          url.searchParams.get("start_date") ?? "",
          url.searchParams.get("end_date") ?? "",
          allowStale,
        );
        if (!reply.ok) throw new CalendarError(reply.kind, reply.error);
        observeSource?.(reply.data);
        return new Response(reply.data.body);
      }, auth.state.profile.participantId);
    },
  });
}

async function readEvents({
  allowStale = false,
  accountId,
  date,
  view,
  myCalendar,
  calendarIds,
}: CalendarReadQuery): Promise<CalendarReply<CalendarResult>> {
  let fetchedAt = Date.now();
  let stale = false;
  const calendar = calendarReader(allowStale, (source) => {
    fetchedAt = Math.min(fetchedAt, source.fetchedAt);
    stale ||= source.stale;
  });
  try {
    const query = {
      accountId,
      date,
      view,
      myCalendar,
      calendarIds,
    };
    const data = await calendar.events(query);
    if (
      allowStale &&
      data.issues.length > 0 &&
      data.issues.every((issue) => issue.kind === "network")
    ) {
      const saved = await readImportedCache(
        accountId,
        "events",
        eventRangeKey(query),
      );
      if (saved) {
        const normalized = cachedEventsSchema.safeParse(saved.value);
        if (normalized.success && normalized.data.issues.length === 0)
          return {
            ok: true,
            data: {
              ...normalized.data,
              freshness: "stale",
              fetchedAt: saved.fetchedAt,
            },
          };
      }
    }
    return {
      ok: true,
      data: { ...data, freshness: stale ? "stale" : "fresh", fetchedAt },
    };
  } catch (error) {
    if (error instanceof CalendarError)
      return { ok: false, kind: error.kind, error: error.message };
    return {
      ok: false,
      kind: "network",
      error: "Не удалось загрузить календарь Small.",
    };
  }
}

async function readImportedCache(
  accountId: string,
  kind: "events" | "catalog",
  key: string,
) {
  return call<{ value: unknown; fetchedAt: number } | null>(
    "ImportedCalendarCache",
    accountId,
    kind,
    key,
  ).catch(() => null);
}

const calendarListeners = new Set<(change: CalendarChange) => void>();
const publish = (change: CalendarChange) => {
  for (const listener of calendarListeners) listener(change);
};
type ActiveCalendar = {
  query: CalendarReadQuery;
  result?: CalendarResult;
  refreshing: boolean;
};
let activeCalendar: ActiveCalendar | undefined;

async function openCalendar(query: CalendarReadQuery) {
  const active: ActiveCalendar = { query, refreshing: true };
  activeCalendar = active;
  const reply = await readEvents(query);
  active.refreshing = false;
  if (active === activeCalendar && reply.ok) {
    active.result = reply.data;
    publish({
      type: "status",
      status: reply.data.freshness === "stale" ? "offline" : "online",
    });
  }
  return reply;
}

async function refreshCalendar() {
  const active = activeCalendar;
  if (!active || active.refreshing || !calendarListeners.size) return;
  active.refreshing = true;
  try {
    const reply = await readEvents({ ...active.query, allowStale: false });
    if (active !== activeCalendar) return;
    if (!reply.ok) {
      if (reply.kind === "auth") {
        activeCalendar = undefined;
        publish({ type: "status", status: "auth-expired" });
      } else {
        publish({ type: "status", status: "offline" });
      }
      return;
    }
    if (reply.data.issues.length) {
      publish({ type: "status", status: "offline" });
      return;
    }
    const previous = active.result?.events ?? reply.data.events;
    active.result = reply.data;
    publish({
      type: "events",
      query: active.query,
      result: reply.data,
      diff: diffEvents(previous, reply.data.events),
    });
    publish({ type: "status", status: "online" });
  } finally {
    active.refreshing = false;
  }
}

window.addEventListener("focus", () => void refreshCalendar());
window.setInterval(() => {
  if (!document.hidden) void refreshCalendar();
}, 60_000);

async function changeSession(method: "Login" | "Logout", ...args: unknown[]) {
  activeCalendar = undefined;
  return call<SmallAuthReply>(method, ...args);
}

const assistantListeners = new Set<(event: AgentEvent) => void>();
const updateListeners = new Set<(state: UpdateState) => void>();
const eventListListeners = new Set<(event: EventListResult) => void>();
const availabilityListeners = new Set<(event: AvailabilityOpening) => void>();
function listen<T>(
  listeners: Set<(event: T) => void>,
  listener: (event: T) => void,
) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const assistantEventsReady = runtime.then(({ Events }) => {
  Events.On("small:update", ({ data }) => {
    for (const listener of updateListeners) listener(data as UpdateState);
  });
  Events.On("small:assistant", ({ data }) => {
    for (const listener of assistantListeners) listener(data as AgentEvent);
  });
  Events.On("small:event-list", ({ data }) => {
    for (const listener of eventListListeners)
      listener(data as EventListResult);
  });
  Events.On("small:availability", ({ data }) => {
    for (const listener of availabilityListeners)
      listener(data as AvailabilityOpening);
  });
});
async function assistant<T>(method: string, input: unknown = null): Promise<T> {
  await assistantEventsReady;
  return call<T>("Assistant", method, input);
}

const preview = {
  platform: "darwin",
  smallAuth: {
    read: () => call<SmallAuthReply>("Read"),
    logout: () => changeSession("Logout"),
    login: (input) => changeSession("Login", input),
    subscribeRequired: () => () => {},
  },
  calendar: {
    calendars: (input) =>
      call<Awaited<ReturnType<DesktopBridge["calendar"]["calendars"]>>>(
        "Calendars",
        input,
      ),
    events: openCalendar,
    openLink: (url) => call<CalendarReply<void>>("OpenLink", url),
    copyLink: (url) => call<CalendarReply<void>>("CopyLink", url),
    async people(input) {
      try {
        return { ok: true, data: await calendarReader().searchPeople(input) };
      } catch (error) {
        if (error instanceof CalendarError && error.kind === "network") {
          const saved = await readImportedCache(
            input.accountId,
            "catalog",
            JSON.stringify(["people", input.query.trim(), input.page]),
          );
          const cached = cachedPeopleSchema.safeParse(saved?.value);
          if (cached.success) return { ok: true, data: cached.data };
        }
        if (error instanceof CalendarError)
          return { ok: false, kind: error.kind, error: error.message };
        return {
          ok: false,
          kind: "network",
          error: "Не удалось прочитать каталог участников.",
        };
      }
    },
    respond: (input) => call<CalendarReply<void>>("Respond", input),
    applyChange: (input) => call<CalendarReply<void>>("ApplyChange", input),
    reschedule: (input) => call<CalendarReply<void>>("Reschedule", input),
    updateEvent: ({ accountId, eventId, before, after, allowConflicts }) =>
      call<CalendarReply<void>>("ApplyChange", {
        accountId,
        eventId,
        change: { kind: "edit", before, after, allowConflicts },
      }),
    async detail(input) {
      try {
        return { ok: true, data: await calendarReader().detail(input) };
      } catch (error) {
        if (error instanceof CalendarError)
          return { ok: false, kind: error.kind, error: error.message };
        return {
          ok: false,
          kind: "network",
          error: "Не удалось прочитать карточку Small.",
        };
      }
    },
    subscribe(listener) {
      calendarListeners.add(listener);
      return () => {
        calendarListeners.delete(listener);
      };
    },
    subscribeAvailability: (listener) =>
      listen(availabilityListeners, listener),
    subscribeEventList: (listener) => listen(eventListListeners, listener),
    availabilityAnalysis: (input) =>
      assistant<CalendarReply<AvailabilityAnalysis>>(
        "availability.read",
        input,
      ),
    slots: (input) =>
      assistant<CalendarReply<SlotsResult>>("availability.slots", input),
    updateAvailabilityContext: async (input) => {
      await assistant("availability.context", input);
    },
  },
  series: {
    gate: (input) => call<CalendarReply<SeriesGateState>>("GateSeries", input),
    apply: (input) =>
      call<CalendarReply<SeriesApplyResult>>("ApplySeries", input),
  },
  meetings: {
    attach: (remaining) =>
      call<Awaited<ReturnType<DesktopBridge["meetings"]["attach"]>>>(
        "Attach",
        remaining,
      ),
    prepare: (input) =>
      call<{ ok: true; data: MeetingDraft } | { ok: false; error: string }>(
        "PrepareMeeting",
        input,
      ),
    confirm: (input) => call<MeetingReply>("ConfirmMeeting", input),
    read: (input) => call<MeetingReply>("ReadMeeting", input),
    reconcile: (input) => call<MeetingReply>("ReadMeeting", input),
    edit: (input) => call<MeetingReply>("EditMeeting", input),
  },
  assistant: {
    start: (input) => assistant<StartResult>("assistant.start", input),
    cancel: async (id) => {
      await assistant("assistant.cancel", id);
    },
    subscribe: (listener) => listen(assistantListeners, listener),
  },
  profiles: {
    read: () => assistant<ProfileReply>("profiles.read"),
    save: (input) => assistant<ProfileReply>("profiles.save", input),
    activate: (id) => assistant<ProfileReply>("profiles.activate", id),
    remove: (id) => assistant<ProfileReply>("profiles.remove", id),
  },
  agentSettings: {
    read: () => assistant<AgentSettingsReply>("settings.read"),
    save: (input) => assistant<AgentSettingsReply>("settings.save", input),
    reset: () => assistant<AgentSettingsReply>("settings.reset"),
  },
  memory: {
    read: () => assistant<MemoryReply>("memory.read"),
    write: (input) => assistant<MemoryReply>("memory.write", input),
    confirm: (input) => assistant<MemoryReply>("memory.confirm", input),
    reset: () => assistant<MemoryReply>("memory.reset"),
  },
  topicRules: {
    read: () => assistant<TopicRulesReply>("topics.read"),
    save: (input) => assistant<TopicRulesReply>("topics.save", input),
  },
  updates: {
    read: () => call<UpdateState>("ReadUpdates"),
    check: () => call<UpdateState>("CheckUpdates"),
    install: () => call<{ ok: boolean }>("InstallUpdate"),
    subscribe: (listener) => listen(updateListeners, listener),
  },
  reminders: {
    read: () => call<ReminderReply>("Reminders", "read", null),
    save: (input) => call<ReminderReply>("Reminders", "save", input),
    join: (id) => call<ReminderReply>("Reminders", "join", id),
  },
  notifications: {
    read: () => call<NativeNotificationState>("Notifications", "read"),
    test: () => call<NativeNotificationState>("Notifications", "test"),
    settings: () => call<NativeNotificationState>("Notifications", "settings"),
  },
  voice: { request: voiceRequest },
} satisfies Partial<{
  [Key in keyof DesktopBridge]: DesktopBridge[Key] extends object
    ? Partial<DesktopBridge[Key]>
    : DesktopBridge[Key];
}>;

Object.defineProperty(window, "smallDesktop", { value: preview });
