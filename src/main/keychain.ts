import { AsyncEntry } from "@napi-rs/keyring";
import { createHash } from "node:crypto";
import type { SecretStore } from "./profiles.js";

type CredentialEntry = Pick<
  AsyncEntry,
  "getPassword" | "setPassword" | "deleteCredential"
>;
type EntryFactory = (service: string, account: string) => CredentialEntry;

/** Secrets stay in main-process memory for this app session, never on disk or in renderer state. */
export class KeychainSecrets implements SecretStore {
  private service: string;
  private values = new Map<string, Promise<string | null>>();
  constructor(
    directory: string,
    private entry: EntryFactory = (service, account) =>
      new AsyncEntry(service, account),
  ) {
    this.service = `kz.small.desktop-calendar.llm.${createHash("sha256").update(directory).digest("hex").slice(0, 24)}`;
  }
  private remember(account: string, operation: Promise<string | null>) {
    this.values.set(account, operation);
    void operation.catch(() => {
      if (this.values.get(account) === operation) this.values.delete(account);
    });
    return operation;
  }
  async get(account: string, signal?: AbortSignal): Promise<string | null> {
    signal?.throwIfAborted();
    const operation =
      this.values.get(account) ??
      this.remember(account, this.entry(this.service, account).getPassword());
    if (!signal) return operation;
    // Cancelling one request must not dismiss another request's Keychain prompt.
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      operation.then(
        (value) => {
          signal.removeEventListener("abort", abort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
    });
  }
  async set(account: string, value: string) {
    const previous = this.values.get(account);
    await this.remember(
      account,
      (async () => {
        await previous?.catch(() => undefined);
        await this.entry(this.service, account).setPassword(value);
        return value;
      })(),
    );
  }
  async remove(account: string) {
    const previous = this.values.get(account);
    await this.remember(
      account,
      (async () => {
        await previous?.catch(() => {});
        await this.entry(this.service, account).deleteCredential();
        return null;
      })(),
    );
  }
}
