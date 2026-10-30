import { eventUpdateBody, type EventUpdateBody } from "./event-reschedule.js";
import { seriesUpdateBody, type SeriesUpdateBody } from "./series-adapter.js";
import { attachmentPath, isAttachmentUpload } from "./attachment-request.js";
import { meetingCreateBody, meetingCreatePath } from "./meeting-request.js";
import { z } from "zod";
import { CalendarError } from "./calendar.js";
import { isAvailabilityRequest } from "./availability-request.js";
import type { SecretStore } from "./profiles.js";
import type {
  SmallAuthFailureKind,
  SmallAuthState,
} from "../shared/small-auth.js";

export interface AuthTransport {
  request(path: string, init: RequestInit): Promise<Response>;
  snapshot(): Promise<string>;
  restore(value: string): Promise<void>;
  clear(): Promise<void>;
}
export class SmallAuthError extends Error {
  constructor(
    message: string,
    public code: "auth" | "network" = "network",
    public kind: SmallAuthFailureKind = code,
  ) {
    super(message);
  }
}
const account = "small-auth-session-v1";
const credentials = z.strictObject({
  username: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(1024),
});
const tokenResponse = z.object({
  data: z.object({ access_token: z.string().min(1).max(32000) }),
});
const identity = z.object({
  uid: z.union([z.string().min(1), z.number()]),
  guidfl: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .optional(),
  preferred_username: z.string().min(1).max(200),
  name: z.string().min(1).max(500),
});
const savedSession = z.strictObject({
  version: z.literal(3),
  session: z.string().nullable(),
  username: z.string().max(200),
  accountId: z.string().min(1).nullable(),
  expired: z.boolean(),
});
function unpackSession(saved: string): z.infer<typeof savedSession> {
  let value: unknown;
  try {
    value = JSON.parse(saved);
  } catch {
    /* Legacy cookie snapshot. */
  }
  if (value && typeof value === "object" && "version" in value) {
    if (value.version === 2) {
      // Strip legacy passwords before any network request, including offline starts.
      const legacy = z
        .object({
          version: z.literal(2),
          session: z.string(),
          login: z
            .object({
              username: credentials.shape.username,
              accountId: z.string().min(1),
            })
            .nullable(),
        })
        .safeParse(value);
      if (legacy.success)
        return {
          version: 3,
          session: legacy.data.session,
          username: legacy.data.login?.username ?? "",
          accountId: legacy.data.login?.accountId ?? null,
          expired: false,
        };
    }
    const parsed = savedSession.safeParse(value);
    if (!parsed.success)
      throw new SmallAuthError(
        "Сохранённая сессия Small повреждена. Введите пароль для повторного входа.",
        "auth",
      );
    return parsed.data;
  }
  return {
    version: 3,
    session: saved,
    username: "",
    accountId: null,
    expired: false,
  };
}

/** Serializes transitions so logout/account switching cannot race a refresh. */
export class SmallAuth {
  private pending: Promise<unknown> = Promise.resolve();
  private token: string | null = null;
  private username = "";
  private accountId: string | null = null;
  private expired = false;
  private version = 0;
  private restored = false;
  private requiredListeners = new Set<() => void>();
  subscribeRequired(listener: () => void) {
    this.requiredListeners.add(listener);
    return () => {
      this.requiredListeners.delete(listener);
    };
  }
  private requireSignIn(): SmallAuthState {
    for (const listener of this.requiredListeners) listener();
    return this.signedOut();
  }
  private signedOut(): SmallAuthState {
    return {
      status: "signed-out",
      ...(this.username ? { username: this.username } : {}),
      ...(this.expired ? { reason: "expired" as const } : {}),
    };
  }
  private async loadSaved() {
    const saved = await this.storedSecret(() => this.secrets.get(account));
    if (!saved) return null;
    const snapshot = unpackSession(saved);
    this.username = snapshot.username;
    this.accountId = snapshot.accountId;
    this.expired = snapshot.expired;
    const sanitized = JSON.stringify(snapshot);
    if (sanitized !== saved)
      await this.storedSecret(() => this.secrets.set(account, sanitized));
    return snapshot.session;
  }
  constructor(
    private transport: AuthTransport,
    private secrets: SecretStore,
  ) {}

  private run<T>(action: () => Promise<T>): Promise<T> {
    const result = this.pending.then(action).catch((error: unknown) => {
      throw error instanceof SmallAuthError || error instanceof CalendarError
        ? error
        : new SmallAuthError(
            "Не удалось связаться с Small. Проверьте сеть и повторите.",
          );
    });
    this.pending = result.catch(() => {});
    return result;
  }
  private async storedSecret<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch {
      throw new SmallAuthError(
        "Не удалось получить доступ к локальному хранилищу. Повторите операцию.",
        "network",
        "storage",
      );
    }
  }
  private async clear(expired = false) {
    this.token = null;
    this.accountId = null;
    this.expired = expired;
    this.restored = true;
    // Persist the username-only tombstone before clearing Chromium's cookies.
    try {
      await this.persist(null);
    } finally {
      await this.transport.clear();
    }
  }

  private async request(path: string, method = "POST", body?: unknown) {
    return this.transport.request(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      ...(["POST", "PUT", "PATCH"].includes(method)
        ? { body: JSON.stringify(body ?? {}) }
        : {}),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  }
  private async accept(response: Response) {
    if (!response.ok)
      throw new SmallAuthError(
        "Small временно недоступен. Повторите позже.",
        "network",
        "service",
      );
    const parsed = tokenResponse.safeParse(
      await response.json().catch(() => null),
    );
    if (!parsed.success)
      throw new SmallAuthError(
        "Small вернул неизвестный формат сессии.",
        "network",
        "invalid",
      );
    const nextToken = parsed.data.data.access_token;
    if (
      this.accountId &&
      String(this.claims(nextToken).uid) !== this.accountId
    ) {
      try {
        await this.clear(true);
      } finally {
        this.requireSignIn();
      }
      throw new SmallAuthError(
        "Изменился аккаунт Small. Войдите заново.",
        "auth",
      );
    }
    await this.persist();
    this.token = nextToken;
  }
  /** Writes are never replayed, even after a 401. */
  private async write(path: string, method: string, body?: unknown) {
    return this.checkWrite(await this.request(path, method, body));
  }
  private async checkWrite(response: Response) {
    if (response.status === 401) {
      let recovery: "true" | "pending";
      try {
        if (!(await this.renew())) return response;
        recovery = "true";
      } catch (error) {
        if (error instanceof SmallAuthError && error.code === "auth")
          throw error;
        recovery = "pending";
      }
      // Preserve the explicit 401 for retry journals; never replay this write.
      return new Response(null, {
        status: 401,
        headers: { "X-Small-Session-Recovered": recovery },
      });
    }
    return response;
  }
  private async persist(session?: string | null) {
    const snapshot = JSON.stringify({
      version: 3,
      session:
        session === undefined ? await this.transport.snapshot() : session,
      username: this.username,
      accountId: this.accountId,
      expired: this.expired,
    });
    await this.storedSecret(() => this.secrets.set(account, snapshot));
  }
  private async renew(): Promise<boolean> {
    const response = await this.request("/gate/auth/refresh");
    if (response.status === 401 || response.status === 403) {
      try {
        await this.clear(true);
      } finally {
        this.requireSignIn();
      }
      return false;
    }
    await this.accept(response);
    return true;
  }
  private async authorized(path: string, body?: unknown): Promise<Response> {
    const method = body === undefined ? "GET" : "POST";
    let response = await this.request(path, method, body);
    if (response.status === 401) {
      if (!(await this.renew())) return new Response(null, { status: 401 });
      response = await this.request(path, method, body);
      if (response.status === 401) {
        try {
          await this.clear(true);
        } finally {
          this.requireSignIn();
        }
      }
    }
    return response;
  }
  private claims(token: string): z.infer<typeof identity> {
    try {
      return identity.parse(
        JSON.parse(
          Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"),
        ),
      );
    } catch {
      throw new SmallAuthError(
        "Small вернул неизвестный формат пользователя.",
        "network",
        "invalid",
      );
    }
  }
  private async profile(): Promise<SmallAuthState> {
    const response = await this.authorized("/gate/team/api/user/info");
    if (response.status === 401) return this.requireSignIn();
    if (response.status === 403)
      throw new SmallAuthError(
        "Нет доступа к профилю Small.",
        "network",
        "denied",
      );
    if (!response.ok)
      throw new SmallAuthError(
        "Small временно недоступен. Повторите проверку позже.",
        "network",
        "service",
      );
    const info = z
      .object({ data: z.record(z.string(), z.unknown()) })
      .safeParse(await response.json().catch(() => null));
    if (!info.success)
      throw new SmallAuthError(
        "Small вернул неизвестный формат профиля.",
        "network",
        "invalid",
      );
    // Same display claims used by the official client. They never grant permissions.
    const claims = this.claims(this.token!);
    if (!this.accountId || !this.username) {
      this.accountId = String(claims.uid);
      this.username = claims.preferred_username;
      await this.persist();
    }
    return {
      status: "signed-in",
      profile: {
        id: String(claims.uid),
        name: claims.name,
        username: claims.preferred_username,
        ...(claims.guidfl ? { participantId: claims.guidfl } : {}),
      },
    };
  }
  private async current(): Promise<SmallAuthState> {
    if (!this.restored) {
      const session = await this.loadSaved();
      if (session === null) {
        this.restored = true;
        return this.requireSignIn();
      }
      await this.transport.restore(session);
      if (!(await this.renew())) return this.signedOut();
      this.restored = true;
    }
    return this.token ? this.profile() : this.requireSignIn();
  }
  get sessionRevision() {
    return this.version;
  }
  read() {
    return this.run(() => this.current());
  }
  readCalendar<T>(
    accountId: string,
    action: (
      get: (path: string, body?: unknown) => Promise<Response>,
      participantId?: string,
    ) => Promise<T>,
  ): Promise<T> {
    const version = this.version;
    const assertCurrent = () => {
      if (version !== this.version)
        throw new SmallAuthError(
          "Изменился аккаунт Small. Повторите загрузку.",
          "auth",
        );
    };
    return this.run(async () => {
      assertCurrent();
      const state = await this.current();
      if (state.status !== "signed-in" || state.profile.id !== accountId)
        throw new SmallAuthError("Войдите в нужный аккаунт Small.", "auth");
      const result = await action(async (path, body) => {
        assertCurrent();
        if (body !== undefined && !isAvailabilityRequest(path, body))
          throw new SmallAuthError("Операция Small недоступна.");
        if (!this.token)
          throw new SmallAuthError(
            "Сессия Small завершена. Введите пароль для повторного входа.",
            "auth",
          );
        const response = await this.authorized(path, body);
        assertCurrent();
        if (response.status === 401)
          throw new SmallAuthError(
            "Сессия Small завершена. Введите пароль для повторного входа.",
            "auth",
          );
        return response;
      }, state.profile.participantId);
      assertCurrent();
      if (!this.token)
        throw new SmallAuthError(
          "Сессия Small завершена. Введите пароль для повторного входа.",
          "auth",
        );
      return result;
    });
  }
  /** One attempt only: never refresh-and-replay a calendar write. */
  createCalendarEvent(accountId: string, input: unknown): Promise<Response> {
    const version = this.version;
    const body = meetingCreateBody.safeParse(input);
    if (!body.success)
      return Promise.reject(new SmallAuthError("Некорректная встреча."));
    return this.run(async () => {
      const state = await this.current();
      if (
        version !== this.version ||
        state.status !== "signed-in" ||
        state.profile.id !== accountId
      )
        throw new SmallAuthError("Изменился аккаунт Small.", "auth");
      return this.write(meetingCreatePath, "POST", body.data);
    });
  }
  respondCalendarEvent(
    accountId: string,
    eventId: string,
    status: "accepted" | "declined",
  ): Promise<Response> {
    const version = this.version;
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(eventId) ||
      !["accepted", "declined"].includes(status)
    )
      return Promise.reject(
        new SmallAuthError("Некорректный ответ на приглашение."),
      );
    return this.run(async () => {
      const state = await this.current();
      if (
        version !== this.version ||
        state.status !== "signed-in" ||
        state.profile.id !== accountId
      )
        throw new SmallAuthError("Изменился аккаунт Small.", "auth");
      return this.write(
        `/gate/team/api/calendar/events/${eventId}/participant-status`,
        "PATCH",
        { status },
      );
    });
  }
  deleteCalendarEvent(accountId: string, eventId: string): Promise<Response> {
    const version = this.version;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(eventId))
      return Promise.reject(new SmallAuthError("Некорректная встреча."));
    return this.run(async () => {
      const state = await this.current();
      if (
        version !== this.version ||
        state.status !== "signed-in" ||
        state.profile.id !== accountId
      )
        throw new SmallAuthError("Изменился аккаунт Small.", "auth");
      return this.write(`/gate/team/api/calendar/events/${eventId}`, "DELETE");
    });
  }
  updateCalendarEvent(
    accountId: string,
    eventId: string,
    input: EventUpdateBody,
  ): Promise<Response> {
    const version = this.version;
    const body = eventUpdateBody.safeParse(input);
    if (!body.success || !/^[A-Za-z0-9_-]{1,128}$/.test(eventId))
      return Promise.reject(
        new SmallAuthError("Некорректное изменение встречи."),
      );
    return this.run(async () => {
      const state = await this.current();
      if (
        version !== this.version ||
        state.status !== "signed-in" ||
        state.profile.id !== accountId
      )
        throw new SmallAuthError("Изменился аккаунт Small.", "auth");
      return this.write(
        `/gate/team/api/calendar/events/${eventId}?force=false`,
        "PUT",
        body.data,
      );
    });
  }
  /**
   * Series writes. One attempt, never replayed. Materialization and single cancellation
   * are used by the deletion flow; new rename/move scopes retain their contract gate.
   */
  private seriesWrite(
    accountId: string,
    path: string,
    method: "POST" | "PUT",
    body: unknown,
  ): Promise<Response> {
    const version = this.version;
    return this.run(async () => {
      const state = await this.current();
      if (
        version !== this.version ||
        state.status !== "signed-in" ||
        state.profile.id !== accountId
      )
        throw new SmallAuthError("Изменился аккаунт Small.", "auth");
      return this.write(path, method, body);
    });
  }
  /** Field names of the from-template body come from the client bundle and are unconfirmed (A2). */
  materializeCalendarEvent(
    accountId: string,
    originalEventId: string,
    date: string,
  ): Promise<Response> {
    const parsed = z
      .strictObject({
        original_event_id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .safeParse({ original_event_id: originalEventId, date });
    if (!parsed.success)
      return Promise.reject(
        new SmallAuthError("Некорректное вхождение серии."),
      );
    return this.seriesWrite(
      accountId,
      "/gate/team/api/calendar/events/from-template",
      "POST",
      parsed.data,
    );
  }
  updateSeriesCalendarEvent(
    accountId: string,
    eventId: string,
    input: SeriesUpdateBody,
  ): Promise<Response> {
    const body = seriesUpdateBody.safeParse(input);
    if (!body.success || !/^[A-Za-z0-9_-]{1,128}$/.test(eventId))
      return Promise.reject(
        new SmallAuthError("Некорректное изменение встречи."),
      );
    return this.seriesWrite(
      accountId,
      `/gate/team/api/calendar/events/${eventId}?force=false`,
      "PUT",
      body.data,
    );
  }
  /** The `reason` body is taken from the client bundle and is unconfirmed (A7). */
  cancelCalendarEvent(
    accountId: string,
    eventId: string,
    reason: string,
  ): Promise<Response> {
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(eventId) ||
      !reason ||
      reason.length > 500
    )
      return Promise.reject(new SmallAuthError("Некорректная отмена встречи."));
    return this.seriesWrite(
      accountId,
      `/gate/team/api/calendar/events/${eventId}/cancel`,
      "POST",
      { reason },
    );
  }
  uploadAttachment(accountId: string, body: FormData): Promise<Response> {
    const version = this.version;
    if (!isAttachmentUpload(attachmentPath, body))
      return Promise.reject(new SmallAuthError("Некорректный файл."));
    return this.run(async () => {
      const state = await this.current();
      if (
        version !== this.version ||
        state.status !== "signed-in" ||
        state.profile.id !== accountId
      )
        throw new SmallAuthError("Изменился аккаунт Small.", "auth");
      return this.checkWrite(
        await this.transport.request(attachmentPath, {
          method: "POST",
          body,
          headers: { Authorization: `Bearer ${this.token}` },
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        }),
      );
    });
  }
  login(input: unknown) {
    this.version++;
    return this.run(async () => {
      const parsed = credentials.safeParse(input);
      if (!parsed.success)
        throw new SmallAuthError("Проверьте логин и пароль.");
      this.username = parsed.data.username.toLowerCase().replace(/\s+/g, "");
      await this.clear();
      try {
        const response = await this.request("/gate/auth/login", "POST", {
          username: parsed.data.username.toLowerCase().replace(/\s+/g, ""),
          password: parsed.data.password,
          remember_me: true,
        });
        if (response.status === 401 || response.status === 403)
          throw new SmallAuthError("Логин или пароль не подошли.", "auth");
        await this.accept(response);
        const state = await this.profile();
        if (state.status === "signed-in") {
          this.accountId = state.profile.id;
          await this.persist();
        }
        return state;
      } catch (error) {
        await this.clear();
        throw error;
      }
    });
  }
  logout(): Promise<SmallAuthState> {
    this.version++;
    return this.run(async () => {
      let warning: string | undefined;
      try {
        // Restore cookies solely to revoke the server session, even before read().
        if (!this.restored) {
          const session = await this.loadSaved();
          if (session !== null) await this.transport.restore(session);
        }
        const response = await this.request("/gate/auth/logout");
        if (!response.ok)
          warning =
            "Локальный выход выполнен. Сервер не подтвердил отзыв сессии.";
      } catch {
        warning =
          "Локальный выход выполнен. Сервер не подтвердил отзыв сессии.";
      }
      await this.clear();
      return { ...this.signedOut(), ...(warning ? { warning } : {}) };
    });
  }
}
