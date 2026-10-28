import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  activeProfileSchema,
  profileIdSchema,
  profileInputSchema,
  profileSchema,
} from "../shared/profile-schema.js";
import type { ModelConnection, ProfileState } from "../shared/profiles.js";

export class ProfileError extends Error {}

export interface SecretStore {
  get(account: string, signal?: AbortSignal): Promise<string | null>;
  set(account: string, value: string): Promise<void>;
  remove(account: string): Promise<void>;
}
const storedProfile = profileSchema.extend({ credentialId: z.uuid() });
const configSchema = z
  .strictObject({
    version: z.literal(1),
    active: activeProfileSchema,
    profiles: z.array(storedProfile).max(2),
    retired: z.array(storedProfile),
  })
  .refine(
    (config) =>
      new Set(config.profiles.map((profile) => profile.id)).size ===
        config.profiles.length &&
      (config.active === "synthetic" ||
        config.profiles.some((profile) => profile.id === config.active)) &&
      !config.retired.some((old) =>
        config.profiles.some(
          (profile) => profile.credentialId === old.credentialId,
        ),
      ),
    { message: "Некорректные настройки профилей" },
  );
type Config = z.infer<typeof configSchema>;
type StoredProfile = z.infer<typeof storedProfile>;
const accountFor = (profile: StoredProfile) =>
  `${profile.id}:${new URL(profile.baseURL).origin}:${profile.credentialId}`;

export class ProfileStore {
  private pending: Promise<unknown> = Promise.resolve();
  private changing = false;
  constructor(
    private directory: string,
    private secrets: SecretStore,
  ) {}
  private async read(): Promise<Config> {
    try {
      return configSchema.parse(
        JSON.parse(
          await readFile(join(this.directory, "llm-profiles.json"), "utf8"),
        ),
      );
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return { version: 1, active: "synthetic", profiles: [], retired: [] };
      throw new ProfileError("Не удалось прочитать настройки модели");
    }
  }
  private async write(config: Config) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = join(
      this.directory,
      `llm-profiles.${crypto.randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporary, JSON.stringify(config), { mode: 0o600 });
      await rename(temporary, join(this.directory, "llm-profiles.json"));
    } finally {
      await rm(temporary, { force: true });
    }
  }
  private view(config: Config): ProfileState {
    return {
      active: config.active,
      profiles: config.profiles.map(({ id, baseURL, modelId }) => ({
        id,
        baseURL,
        modelId,
      })),
      ...(config.retired.length
        ? {
            warning:
              "Предыдущий ключ пока не удалён из Keychain. Повторите сохранение или удаление профиля.",
          }
        : {}),
    };
  }
  private change(action: () => Promise<ProfileState>) {
    if (this.changing)
      return Promise.reject(new ProfileError("Дождитесь сохранения настроек"));
    this.changing = true;
    const result = Promise.resolve()
      .then(action)
      .finally(() => {
        this.changing = false;
      });
    this.pending = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  private async cleanRetired(config: Config) {
    const remaining: StoredProfile[] = [];
    for (const profile of config.retired) {
      try {
        await this.secrets.remove(accountFor(profile));
      } catch {
        remaining.push(profile);
      }
    }
    if (remaining.length !== config.retired.length) {
      config.retired = remaining;
      await this.write(config);
    }
  }
  async state() {
    await this.pending;
    return this.view(await this.read());
  }
  async resolveActive(signal?: AbortSignal): Promise<ModelConnection | null> {
    await this.pending;
    const config = await this.read();
    if (config.active === "synthetic") return null;
    const profile = config.profiles.find(
      (profile) => profile.id === config.active,
    );
    if (!profile) throw new ProfileError("Выбранный профиль не настроен");
    let apiKey: string | null;
    try {
      apiKey = await this.secrets.get(accountFor(profile), signal);
    } catch {
      throw new ProfileError("Не удалось прочитать ключ из Keychain");
    }
    if (!apiKey)
      throw new ProfileError(
        "Ключ профиля отсутствует в Keychain. Откройте настройки модели.",
      );
    return {
      id: profile.id,
      baseURL: profile.baseURL,
      modelId: profile.modelId,
      apiKey,
    };
  }
  save(input: unknown) {
    return this.change(async () => {
      const parsed = profileInputSchema.safeParse(input);
      if (!parsed.success)
        throw new ProfileError("Проверьте адрес сервиса, model ID и ключ");
      const { id, baseURL, modelId, apiKey } = parsed.data;
      const config = await this.read();
      const previous = config.profiles.find((profile) => profile.id === id);
      if (
        !apiKey &&
        (!previous ||
          new URL(previous.baseURL).origin !== new URL(baseURL).origin)
      )
        throw new ProfileError("Для нового адреса сервиса нужен новый ключ");
      const next = {
        id,
        baseURL,
        modelId,
        credentialId: apiKey ? crypto.randomUUID() : previous!.credentialId,
      };
      if (apiKey) {
        try {
          await this.secrets.set(accountFor(next), apiKey);
        } catch {
          throw new ProfileError("Не удалось сохранить ключ в Keychain");
        }
      } else if (!(await this.secrets.get(accountFor(next))))
        throw new ProfileError("Ключ отсутствует в Keychain");
      config.profiles = [
        ...config.profiles.filter((profile) => profile.id !== id),
        next,
      ];
      config.active = id;
      if (previous && previous.credentialId !== next.credentialId)
        config.retired.push(previous);
      try {
        await this.write(config);
      } catch {
        if (apiKey) await this.secrets.remove(accountFor(next));
        throw new ProfileError("Не удалось сохранить настройки модели");
      }
      await this.cleanRetired(config);
      return this.view(config);
    });
  }
  activate(input: unknown) {
    return this.change(async () => {
      const id = activeProfileSchema.parse(input);
      const config = await this.read();
      if (id !== "synthetic") {
        const profile = config.profiles.find((profile) => profile.id === id);
        if (!profile || !(await this.secrets.get(accountFor(profile))))
          throw new ProfileError("Сначала сохраните профиль и ключ");
      }
      config.active = id;
      await this.write(config);
      return this.view(config);
    });
  }
  remove(input: unknown) {
    return this.change(async () => {
      const id = profileIdSchema.parse(input);
      const config = await this.read();
      config.retired.push(
        ...config.profiles.filter((profile) => profile.id === id),
      );
      config.profiles = config.profiles.filter((profile) => profile.id !== id);
      if (config.active === id) config.active = "synthetic";
      await this.write(config);
      await this.cleanRetired(config);
      return this.view(config);
    });
  }
}
