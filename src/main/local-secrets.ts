import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import type { CacheCipher } from "./event-cache.js";
import type { SecretStore } from "./profiles.js";

const HEADER = Buffer.from("SCV1");
const LIMIT = 4 * 1024 * 1024;
const missing = (error: unknown) =>
  (error as NodeJS.ErrnoException)?.code === "ENOENT";

async function privateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || (process.getuid && info.uid !== process.getuid()))
    throw new Error("Локальное хранилище недоступно.");
  await chmod(path, 0o700);
}
async function privateRead(path: string, limit: number) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.size > limit ||
      (process.getuid && info.uid !== process.getuid())
    )
      throw new Error("Некорректный файл локального хранилища.");
    await file.chmod(0o600);
    return await file.readFile();
  } finally {
    await file.close();
  }
}
async function syncDirectory(path: string) {
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function temporaryFile(directory: string, data: Buffer) {
  const path = join(directory, `.tmp-${randomUUID()}`);
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(data);
    await file.sync();
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  } finally {
    await file.close();
  }
  return path;
}

/** Local AES-256-GCM key, separate from ciphertext. Protects files at rest, not against the same OS user. */
export class LocalCipher implements CacheCipher {
  private key: Promise<Buffer> | undefined;
  constructor(private directory: string) {}
  private loadKey() {
    return (this.key ??= (async () => {
      await privateDirectory(this.directory);
      const secrets = join(this.directory, "secrets");
      await privateDirectory(secrets);
      const path = join(this.directory, "master.key");
      let key: Buffer;
      try {
        key = await privateRead(path, 32);
      } catch (error) {
        if (!missing(error)) throw error;
        // Never replace a lost key while durable credentials still depend on it.
        if ((await readdir(secrets)).some((name) => name.endsWith(".enc")))
          throw new Error(
            "Ключ локального хранилища отсутствует. Сохранённые данные не изменены.",
          );
        const temporary = await temporaryFile(this.directory, randomBytes(32));
        try {
          try {
            await link(temporary, path);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          }
          await syncDirectory(this.directory);
          key = await privateRead(path, 32);
        } finally {
          await rm(temporary, { force: true });
        }
      }
      if (key.length !== 32)
        throw new Error("Ключ локального хранилища повреждён.");
      return key;
    })());
  }
  async isAvailable() {
    try {
      await this.loadKey();
      return true;
    } catch {
      return false;
    }
  }
  async seal(text: string, context: string) {
    if (Buffer.byteLength(text) > LIMIT)
      throw new Error("Слишком большой секрет.");
    const key = await this.loadKey();
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(`small-calendar:1:${context}`));
    const encrypted = Buffer.concat([
      cipher.update(text, "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([HEADER, nonce, cipher.getAuthTag(), encrypted]);
  }
  async open(data: Buffer, context: string) {
    if (
      data.length < 32 ||
      data.length > LIMIT + 32 ||
      !data.subarray(0, 4).equals(HEADER)
    )
      throw new Error("Неизвестный формат зашифрованных данных.");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      await this.loadKey(),
      data.subarray(4, 16),
    );
    decipher.setAAD(Buffer.from(`small-calendar:1:${context}`));
    decipher.setAuthTag(data.subarray(16, 32));
    try {
      return Buffer.concat([
        decipher.update(data.subarray(32)),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new Error("Не удалось проверить зашифрованные данные.");
    }
  }
  encrypt(text: string) {
    return this.seal(text, "calendar-cache");
  }
  async decrypt(data: Buffer) {
    return {
      result: await this.open(data, "calendar-cache"),
      shouldReEncrypt: false,
    };
  }
}

/** One main-process instance; mutation order and atomic replacement preserve concurrent callers. */
export class LocalSecrets implements SecretStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private directory: string,
    private cipher: LocalCipher,
  ) {}
  private path(account: string) {
    if (!account || account.length > 3000)
      throw new Error("Некорректная запись хранилища.");
    return join(
      this.directory,
      "secrets",
      createHash("sha256").update(account).digest("hex") + ".enc",
    );
  }
  private run<T>(action: () => Promise<T>) {
    const result = this.pending.then(action);
    this.pending = result.catch(() => {});
    return result;
  }
  get(account: string, signal?: AbortSignal) {
    return this.run(async () => {
      signal?.throwIfAborted();
      let bytes: Buffer;
      try {
        bytes = await privateRead(this.path(account), LIMIT + 32);
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
      const value = await this.cipher.open(bytes, `secret:${account}`);
      signal?.throwIfAborted();
      return value;
    });
  }
  set(account: string, value: string) {
    return this.run(async () => {
      const path = this.path(account);
      const encrypted = await this.cipher.seal(value, `secret:${account}`);
      const directory = join(this.directory, "secrets");
      await privateDirectory(directory);
      const temporary = await temporaryFile(directory, encrypted);
      try {
        await rename(temporary, path);
        await syncDirectory(directory);
      } finally {
        await rm(temporary, { force: true });
      }
    });
  }
  remove(account: string) {
    return this.run(async () => {
      await rm(this.path(account), { force: true });
      try {
        await syncDirectory(join(this.directory, "secrets"));
      } catch (error) {
        if (!missing(error)) throw error;
      }
    });
  }
}
