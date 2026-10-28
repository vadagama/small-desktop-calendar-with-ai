import { z } from "zod";
import type { SecretStore } from "./profiles.js";
import type { SmallAuthState } from "../shared/small-auth.js";

export interface AuthTransport {
  request(path: string, init: RequestInit): Promise<Response>;
  snapshot(): Promise<string>;
  restore(value: string): Promise<void>;
  clear(): Promise<void>;
}
export class SmallAuthError extends Error {}
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
  preferred_username: z.string().min(1).max(200),
  name: z.string().min(1).max(500),
});
const signedOut: SmallAuthState = { status: "signed-out" };

/** Serializes transitions so logout/account switching cannot race a refresh. */
export class SmallAuth {
  private pending: Promise<unknown> = Promise.resolve();
  private token: string | null = null;
  private restored = false;
  constructor(
    private transport: AuthTransport,
    private secrets: SecretStore,
  ) {}

  private run(action: () => Promise<SmallAuthState>) {
    const result = this.pending.then(action).catch((error: unknown) => {
      throw error instanceof SmallAuthError
        ? error
        : new SmallAuthError(
            "Не удалось связаться с Small. Проверьте сеть и повторите.",
          );
    });
    this.pending = result.catch(() => {});
    return result;
  }
  private async keychain<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch {
      throw new SmallAuthError(
        "Не удалось получить доступ к Keychain. Повторите операцию.",
      );
    }
  }
  private async clear() {
    this.token = null;
    this.restored = true;
    // Invalidate persistence first, including when Chromium cleanup fails.
    // A tombstone also works if Keychain has no entry yet.
    try {
      await this.keychain(() => this.secrets.set(account, ""));
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
      ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
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
    await this.keychain(() => this.secrets.set(account, snapshot));
    this.token = parsed.data.data.access_token;
  }
  private async profile(): Promise<SmallAuthState> {
    let response = await this.request("/gate/team/api/user/info", "GET");
    if (response.status === 401) {
      const refreshed = await this.request("/gate/auth/refresh");
      if (refreshed.status === 401 || refreshed.status === 403) {
        await this.clear();
        return signedOut;
      }
      await this.accept(refreshed);
      response = await this.request("/gate/team/api/user/info", "GET");
    }
    if (response.status === 401) {
      await this.clear();
      return signedOut;
    }
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
      },
    };
  }
  read() {
    return this.run(async () => {
      if (!this.restored) {
        const saved = await this.keychain(() => this.secrets.get(account));
        if (!saved) {
          this.restored = true;
          return signedOut;
        }
        await this.transport.restore(saved);
        const response = await this.request("/gate/auth/refresh");
        if (response.status === 401 || response.status === 403) {
          await this.clear();
          return signedOut;
        }
        await this.accept(response);
        this.restored = true;
      }
      return this.token ? this.profile() : signedOut;
    });
  }
  login(input: unknown) {
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
          throw new SmallAuthError("Логин или пароль не подошли.");
        await this.accept(response);
        return await this.profile();
      } catch (error) {
        await this.clear();
        throw error;
      }
    });
  }
  logout() {
    return this.run(async () => {
      let warning: string | undefined;
      try {
        // Restore cookies solely to revoke the server session, even before read().
        if (!this.restored) {
          const saved = await this.keychain(() => this.secrets.get(account));
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
      return warning ? { status: "signed-out", warning } : signedOut;
    });
  }
}
