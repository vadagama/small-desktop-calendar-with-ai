import {
  isEventUpdateRequest,
  isParticipantStatusRequest,
} from "./event-reschedule.js";
import { isAttachmentUpload } from "./attachment-request.js";
import { isMeetingCreateRequest } from "./meeting-request.js";
import { session } from "electron";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SmallAuthError, type AuthTransport } from "./small-auth.js";

import { isAvailabilityRequest } from "./availability-request.js";
import { isCalendarReadPath } from "./calendar.js";

const origin = "https://team.small.kz";
const paths = new Set([
  "/gate/auth/login",
  "/gate/auth/refresh",
  "/gate/auth/logout",
  "/gate/team/api/user/info",
]);
const cookieSchema = z.object({
  name: z.string().min(1).max(256),
  value: z.string().max(32000),
  domain: z.string().refine((domain) => {
    const host = domain.replace(/^\./, "");
    return host === "team.small.kz" || host === "small.kz";
  }),
  path: z.string().startsWith("/"),
  secure: z.literal(true),
  httpOnly: z.boolean(),
  expirationDate: z.number().optional(),
  sameSite: z.enum(["unspecified", "no_restriction", "lax", "strict"]),
});
const savedSchema = z.object({
  csrf: z.uuid(),
  cookies: z.array(cookieSchema).max(50),
});

/** In-memory Chromium cookie jar, never shared with any renderer or web content. */
export function createSmallSession(): AuthTransport {
  const isolated = session.fromPartition("small-auth", { cache: false });
  let csrf: string = randomUUID();
  isolated.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  isolated.setPermissionCheckHandler(() => false);
  return {
    async request(path, init) {
      if (
        !paths.has(path) &&
        !(
          init.method === "DELETE" &&
          init.body == null &&
          /^\/gate\/team\/api\/calendar\/events\/[A-Za-z0-9_-]{1,128}$/.test(
            path,
          )
        ) &&
        !(
          init.method === "PATCH" &&
          typeof init.body === "string" &&
          isParticipantStatusRequest(path, JSON.parse(init.body))
        ) &&
        !(
          init.method === "PUT" &&
          typeof init.body === "string" &&
          isEventUpdateRequest(path, JSON.parse(init.body))
        ) &&
        !(init.method === "POST" && isAttachmentUpload(path, init.body)) &&
        !(init.method === "GET" && isCalendarReadPath(path)) &&
        !(
          init.method === "POST" &&
          typeof init.body === "string" &&
          (isAvailabilityRequest(path, JSON.parse(init.body)) ||
            isMeetingCreateRequest(path, JSON.parse(init.body)))
        )
      )
        throw new SmallAuthError("Операция Small недоступна.");
      return isolated.fetch(origin + path, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init.headers)),
          "X-K-Csrf": csrf,
          Origin: origin,
        },
        credentials: "include",
        redirect: "error",
      });
    },
    async snapshot() {
      const cookies = (await isolated.cookies.get({})).map((cookie) =>
        cookieSchema.parse(cookie),
      );
      if (!cookies.length)
        throw new SmallAuthError(
          "Small не вернул cookie сессии. Вход не сохранён.",
        );
      return JSON.stringify({ csrf, cookies });
    },
    async restore(value) {
      const parsed = savedSchema.safeParse(JSON.parse(value));
      if (!parsed.success)
        throw new SmallAuthError(
          "Сохранённая сессия Small повреждена. Выполните вход заново.",
        );
      await isolated.clearStorageData();
      csrf = parsed.data.csrf;
      for (const cookie of parsed.data.cookies) {
        if (cookie.expirationDate && cookie.expirationDate <= Date.now() / 1000)
          continue;
        const { expirationDate, ...details } = cookie;
        await isolated.cookies.set({
          ...details,
          url: origin + cookie.path,
          ...(expirationDate === undefined ? {} : { expirationDate }),
        });
      }
    },
    async clear() {
      await isolated.clearStorageData();
      await isolated.closeAllConnections();
      csrf = randomUUID();
    },
  };
}
