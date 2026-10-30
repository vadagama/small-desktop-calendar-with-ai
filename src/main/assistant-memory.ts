import { randomUUID, createHash } from "node:crypto";
import { lstat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { SecretStore } from "./profiles.js";
import {
  ParticipantMemory,
  type RememberedParticipant,
} from "./participant-memory.js";
import {
  assistantMemoryState,
  memoryWrite,
  type AssistantMemoryState,
  type MemoryChange,
  type MemorySource,
} from "../shared/assistant-memory.js";

const envelope = z.strictObject({
  state: assistantMemoryState,
  requests: z.array(z.string().max(100)).max(100),
});
const empty = (): AssistantMemoryState => ({
  version: 1,
  revision: 0,
  preferences: {},
  preferenceSources: {},
  entries: [],
  groups: [],
  presets: [],
  participants: [],
});
const normalize = (name: string) =>
  name.normalize("NFKC").trim().toLocaleLowerCase();
export class MemoryError extends Error {
  constructor(
    message: string,
    public kind: "conflict" | "invalid" | "unavailable" = "invalid",
  ) {
    super(message);
  }
}

/** One serialized writer, encrypted using the existing vault and its lost-key protection. */
export class AssistantMemoryStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private directory: string,
    private secrets: SecretStore,
  ) {}
  private key(account: string) {
    if (!account || account.length > 200)
      throw new MemoryError("Аккаунт недоступен.");
    return `assistant-memory:v1:${account}`;
  }
  private run<T>(action: () => Promise<T>) {
    const result = this.pending.then(action);
    this.pending = result.catch(() => {});
    return result;
  }
  private async load(account: string): Promise<z.infer<typeof envelope>> {
    const text = await this.secrets.get(this.key(account));
    if (text !== null) {
      try {
        return envelope.parse(JSON.parse(text));
      } catch {
        throw new MemoryError(
          "Не удалось прочитать память: повреждён файл или неизвестна его версия.",
          "unavailable",
        );
      }
    }
    const state = empty();
    state.participants = await new ParticipantMemory(this.directory).read(
      account,
    );
    const now = new Date().toISOString();
    for (const person of state.participants) {
      if (!person.aliases.length) continue;
      const source: MemorySource = { kind: "legacy-import", at: now };
      state.entries.push({
        id: randomUUID(),
        revision: 0,
        text: `${person.aliases.slice(0, 12).join(", ")} — ${person.name}.${person.aliases.length > 12 ? ` Ещё прозвищ: ${person.aliases.length - 12}.` : ""}`,
        participantId: person.participantId,
        alias: person.aliases[0],
        source,
        lastSource: source,
        createdAt: now,
        updatedAt: now,
      });
    }
    const saved = envelope.parse({ state, requests: [] });
    await this.secrets.set(this.key(account), JSON.stringify(saved));
    const verified = await this.secrets.get(this.key(account));
    if (verified !== JSON.stringify(saved))
      throw new MemoryError(
        "Не удалось проверить миграцию памяти.",
        "unavailable",
      );
    await this.removeLegacy(account);
    return saved;
  }
  private async removeLegacy(account: string) {
    const legacy = join(
      this.directory,
      "participant-memory",
      createHash("sha256").update(account).digest("hex") + ".json",
    );
    try {
      const info = await lstat(legacy);
      if (info.isFile() && (!process.getuid || info.uid === process.getuid()))
        await unlink(legacy);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        console.warn("memory: legacy cleanup deferred");
    }
  }
  read(account: string) {
    return this.run(async () =>
      structuredClone((await this.load(account)).state),
    );
  }
  write(
    account: string,
    input: unknown,
    source: MemorySource = { kind: "settings", at: new Date().toISOString() },
    assertCurrent: () => void = () => {},
    binding?: { participantId: string; alias: string },
  ) {
    return this.run(async () => {
      const request = memoryWrite.parse(input);
      assertCurrent();
      const saved = await this.load(account);
      assertCurrent();
      if (saved.requests.includes(request.requestId))
        return structuredClone(saved.state);
      if (saved.state.revision !== request.revision)
        throw new MemoryError(
          "Версия памяти изменилась. Обновите данные перед сохранением.",
          "conflict",
        );
      const state = structuredClone(saved.state);
      this.apply(state, request.change, source);
      if (binding && request.change.action === "entry") {
        const person = state.participants.find(
          (p) => p.participantId === binding.participantId,
        );
        const entryId = request.change.id;
        const entry = entryId
          ? state.entries.find((e) => e.id === entryId)
          : state.entries.at(-1);
        if (!person || !entry)
          throw new MemoryError("Выбранный участник больше недоступен.");
        for (const p of state.participants)
          p.aliases = p.aliases.filter(
            (a) => a.toLocaleLowerCase() !== binding.alias.toLocaleLowerCase(),
          );
        person.aliases = [...person.aliases, binding.alias].slice(-20);
        entry.participantId = person.participantId;
        entry.alias = binding.alias;
      }
      state.revision++;
      assistantMemoryState.parse(state);
      assertCurrent();
      await this.secrets.set(
        this.key(account),
        JSON.stringify({
          state,
          requests: [...saved.requests, request.requestId].slice(-100),
        }),
      );
      assertCurrent();
      return state;
    });
  }
  private apply(
    s: AssistantMemoryState,
    c: MemoryChange,
    source: MemorySource,
  ) {
    const at = source.at;
    const meta = (id?: string) => ({
      id: id ?? randomUUID(),
      revision: s.revision + 1,
      createdAt: at,
      updatedAt: at,
      source,
      lastSource: source,
    });
    if (c.action === "preferences") {
      for (const key of Object.keys(c.value)) {
        const k = key as keyof typeof s.preferences;
        if (c.value[k] === null) {
          delete s.preferences[k];
          delete s.preferenceSources[key];
        } else if (c.value[k] !== undefined) {
          (s.preferences as Record<string, unknown>)[key] = c.value[k];
          s.preferenceSources[key] = source;
        }
      }
    } else if (c.action === "entry") {
      const old = c.id ? s.entries.find((e) => e.id === c.id) : undefined;
      if (c.id && !old) throw new MemoryError("Запись уже удалена.");
      if (old?.text === c.text) return;
      // Editing prose invalidates old identity evidence; text alone cannot transfer an alias.
      if (old?.participantId) {
        const person = s.participants.find(
          (p) => p.participantId === old.participantId,
        );
        if (person) person.aliases = [];
      }
      const entry = {
        ...meta(c.id),
        text: c.text,
        ...(old ? { createdAt: old.createdAt, source: old.source } : {}),
      };
      if (old) s.entries[s.entries.indexOf(old)] = entry;
      else s.entries.push(entry);
    } else if (c.action === "group" || c.action === "preset") {
      const items = c.action === "group" ? s.groups : s.presets;
      if (
        items.some(
          (e) => e.id !== c.id && normalize(e.name) === normalize(c.value.name),
        )
      )
        throw new MemoryError("Такое название уже существует.");
      const old = c.id ? items.find((e) => e.id === c.id) : undefined;
      if (c.id && !old) throw new MemoryError("Запись уже удалена.");
      if (
        c.action === "preset" &&
        c.value.groupId &&
        !s.groups.some((g) => g.id === c.value.groupId)
      )
        throw new MemoryError("Выбранная группа недоступна.");
      const value = {
        ...meta(c.id),
        ...c.value,
        ...(old ? { createdAt: old.createdAt, source: old.source } : {}),
      };
      if (c.action === "group") {
        const parsed = assistantMemoryState.shape.groups.element.parse(value);
        s.groups = [...s.groups.filter((e) => e.id !== c.id), parsed];
      } else {
        const parsed = assistantMemoryState.shape.presets.element.parse(value);
        s.presets = [...s.presets.filter((e) => e.id !== c.id), parsed];
      }
    } else if (c.action === "delete") {
      if (c.category === "entries") {
        const entry = s.entries.find((e) => e.id === c.id);
        if (entry?.participantId) {
          const p = s.participants.find(
            (p) => p.participantId === entry.participantId,
          );
          if (p) p.aliases = [];
        }
      }
      s[c.category] = s[c.category].filter((e) => e.id !== c.id) as never;
    } else {
      if (c.category === "all" || c.category === "preferences") {
        s.preferences = {};
        s.preferenceSources = {};
      }
      if (c.category === "all" || c.category === "entries") {
        s.entries = [];
        s.participants = [];
      }
      if (c.category === "all" || c.category === "groups") s.groups = [];
      if (c.category === "all" || c.category === "presets") s.presets = [];
    }
  }
  updateParticipants(
    account: string,
    change: (people: RememberedParticipant[]) => RememberedParticipant[],
  ) {
    return this.run(async () => {
      const saved = await this.load(account);
      saved.state.participants = change(
        structuredClone(saved.state.participants),
      );
      assistantMemoryState.parse(saved.state);
      await this.secrets.set(this.key(account), JSON.stringify(saved));
      return structuredClone(saved.state.participants);
    });
  }
  reset(account: string, assertCurrent: () => void = () => {}) {
    return this.run(async () => {
      assertCurrent();
      const state = empty();
      state.revision = Date.now();
      await this.secrets.set(
        this.key(account),
        JSON.stringify({ state, requests: [] }),
      );
      assertCurrent();
      await this.removeLegacy(account);
      return state;
    });
  }
}
