import { z } from "zod";

export function normalizeBaseURL(value: string) {
  const url = new URL(value.trim());
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Нужен HTTPS URL без логина, пароля и параметров; HTTP допускается только для localhost",
    );
  }
  return url.href.replace(/\/+$/, "");
}
export const profileIdSchema = z.enum(["small", "personal"]);
export const activeProfileSchema = z.enum(["synthetic", "small", "personal"]);
export const profileSchema = z.strictObject({
  id: profileIdSchema,
  baseURL: z
    .string()
    .max(2000)
    .transform((value, context) => {
      try {
        return normalizeBaseURL(value);
      } catch {
        context.addIssue({
          code: "custom",
          message: "Недопустимый адрес сервиса",
        });
        return z.NEVER;
      }
    }),
  modelId: z.string().trim().min(1).max(200),
});
export const profileInputSchema = profileSchema.extend({
  apiKey: z
    .string()
    .trim()
    .min(1)
    .max(8192)
    .regex(/^[^\r\n]+$/)
    .optional(),
});
