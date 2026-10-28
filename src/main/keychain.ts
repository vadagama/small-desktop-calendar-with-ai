import { AsyncEntry } from "@napi-rs/keyring";
import { createHash } from "node:crypto";
import type { SecretStore } from "./profiles.js";

/** A distinct namespace for each app data directory keeps test and real profiles apart. */
export class KeychainSecrets implements SecretStore {
  private service: string;
  constructor(directory: string) {
    this.service = `kz.small.desktop-calendar.llm.${createHash("sha256").update(directory).digest("hex").slice(0, 24)}`;
  }
  get(account: string, signal?: AbortSignal) {
    return new AsyncEntry(this.service, account).getPassword(signal);
  }
  set(account: string, value: string) {
    return new AsyncEntry(this.service, account).setPassword(value);
  }
  async remove(account: string) {
    await new AsyncEntry(this.service, account).deleteCredential();
  }
}
