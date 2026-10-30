import { eventUpdateBody, type EventUpdateBody } from "./event-reschedule.js";
import { seriesUpdateBody, type SeriesUpdateBody } from "./series-adapter.js";
import { attachmentPath, isAttachmentUpload } from "./attachment-request.js";
import { meetingCreateBody, meetingCreatePath } from "./meeting-request.js";
import { z } from "zod";
import { CalendarError } from "./calendar.js";
import { isAvailabilityRequest } from "./availability-request.js";
import type { SecretStore } from "./profiles.js";
import type { SmallAuthState } from "../shared/small-auth.js";

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
const signedOut: SmallAuthState = { status: "signed-out" };

/** Serializes transitions so logout/account switching cannot race a refresh. */
export class SmallAuth {
  private pending: Promise<unknown> = Promise.resolve();
  private token: string | null = null;
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
    return signedOut;
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
      );
    }
  }
  private async clear() {
    this.token = null;
    this.restored = true;
    // Invalidate persistence first, including when Chromium cleanup fails.
    // A tombstone also works if the local store has no entry yet.
    try {
      await this.storedSecret(() => this.secrets.set(account, ""));
      try {
        await this.secrets.remove(account);
      } catch {
        /* Tombstone prevents restoration. */
      }
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
      throw new SmallAuthError("Small временно недоступен. Повторите позже.");
    const parsed = tokenResponse.safeParse(await response.json());
    if (!parsed.success)
      throw new SmallAuthError("Small вернул неизвестный формат сессии.");
    // Only session cookies are persisted; passwords and access tokens are not.
    const snapshot = await this.transport.snapshot();
    await this.storedSecret(() => this.secrets.set(account, snapshot));
    this.token = parsed.data.data.access_token;
  }
  /** Writes are never replayed, even after a 401. */
  private async write(path: string, method: string, body?: unknown) {
    return this.checkWrite(await this.request(path, method, body));
  }
  private async checkWrite(response: Response) {
    if (response.status === 401) {
      try {
        await this.clear();
      } finally {
        this.requireSignIn();
      }
    }
    return response;
  }
  private async authorized(path: string, body?: unknown): Promise<Response> {
    const method = body === undefined ? "GET" : "POST";
    let response = await this.request(path, method, body);
    if (response.status === 401) {
      const refreshed = await this.request("/gate/auth/refresh");
      if (refreshed.status === 401 || refreshed.status === 403) {
        try {
          await this.clear();
        } finally {
          this.requireSignIn();
        }
        return new Response(null, { status: 401 });
      }
      await this.accept(refreshed);
      response = await this.request(path, method, body);
      if (response.status === 401) {
        try {
          await this.clear();
        } finally {
          this.requireSignIn();
        }
      }
    }
    return response;
  }
  private async profile(): Promise<SmallAuthState> {
    const response = await this.authorized("/gate/team/api/user/info");
    if (response.status === 401) return this.requireSignIn();
    if (response.status === 403)
      throw new SmallAuthError("Нет доступа к профилю Small.");
    if (!response.ok)
      throw new SmallAuthError("Не удалось прочитать профиль Small.");
    const info = z
      .object({ data: z.record(z.string(), z.unknown()) })
      .safeParse(await response.json());
    if (!info.success)
      throw new SmallAuthError("Small вернул неизвестный формат профиля.");
    // Same display claims used by the official client. They never grant permissions.
    let claims: z.infer<typeof identity>;
    try {
      claims = identity.parse(
        JSON.parse(
          Buffer.from(this.token!.split(".")[1]!, "base64url").toString("utf8"),
        ),
      );
    } catch {
      throw new SmallAuthError("Small вернул неизвестный формат пользователя.");
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
      const saved = await this.storedSecret(() => this.secrets.get(account));
      if (!saved) {
        this.restored = true;
        return this.requireSignIn();
      }
      await this.transport.restore(saved);
      const response = await this.request("/gate/auth/refresh");
      if (response.status === 401 || response.status === 403) {
        try {
          await this.clear();
        } finally {
          this.requireSignIn();
        }
        return signedOut;
      }
      await this.accept(response);
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
            "Сессия Small завершена. Войдите заново.",
            "auth",
          );
        const response = await this.authorized(path, body);
        assertCurrent();
        if (response.status === 401)
          throw new SmallAuthError(
            "Сессия Small завершена. Войдите заново.",
            "auth",
          );
        return response;
      }, state.profile.participantId);
      assertCurrent();
      if (!this.token)
        throw new SmallAuthError(
          "Сессия Small завершена. Войдите заново.",
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
        return await this.profile();
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
          const saved = await this.storedSecret(() =>
            this.secrets.get(account),
          );
          if (saved) await this.transport.restore(saved);
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
      return warning ? { status: "signed-out" as const, warning } : signedOut;
    });
  }
}
