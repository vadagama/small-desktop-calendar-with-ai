import { createHash } from "node:crypto";
import {
  meetingDraftSchema,
  type MeetingDraft,
} from "../shared/meeting-draft.js";
import type { MeetingView } from "../shared/meeting-operations.js";
import { meetingEdit } from "../shared/meeting-validation.js";
import { MeetingJournal } from "./meeting-journal.js";
import { meetingPayload } from "./meeting-request.js";

export class MeetingOperationError extends Error {}
export interface MeetingWriter {
  preflight(draft: MeetingDraft): Promise<void>;
  create(draft: MeetingDraft): Promise<string>;
  verify(draft: MeetingDraft, eventId?: string): Promise<boolean>;
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
// A newly generated conference URL must not evade a previous unknown attempt.
const keyFor = (d: MeetingDraft) =>
  hash([d.organizer.id, [...d.participantIds].sort(), d.startsAt, d.endsAt]);
const digestFor = (d: MeetingDraft) =>
  hash([
    d.organizer.id,
    { ...meetingPayload(d), participant_ids: [...d.participantIds].sort() },
  ]);
const uncertain =
  "Результат отправки неизвестен. Повторное создание заблокировано; проверьте состояние встречи.";

export class MeetingOperations {
  private entries = new Map<string, MeetingView>();
  constructor(
    private journal: MeetingJournal,
    private writer: MeetingWriter,
  ) {}
  register(draft: MeetingDraft): MeetingDraft {
    const d = meetingDraftSchema.parse(draft);
    if (this.entries.has(d.id) || this.entries.size >= 100)
      throw new MeetingOperationError(
        "Слишком много черновиков. Перезапустите приложение.",
      );
    this.entries.set(d.id, {
      draft: structuredClone(d),
      phase: "preview",
      message: "",
    });
    return structuredClone(d);
  }
  private entry(accountId: string, id: string, revision?: number) {
    const entry = this.entries.get(id);
    if (!entry || entry.draft.organizer.id !== accountId)
      throw new MeetingOperationError(
        "Черновик недоступен для текущего аккаунта.",
      );
    if (revision !== undefined && entry.draft.revision !== revision)
      throw new MeetingOperationError(
        "Версия черновика изменилась. Обновите карточку перед подтверждением.",
      );
    return entry;
  }
  private async restore(entry: MeetingView) {
    const stored = await this.journal.read(keyFor(entry.draft));
    if (stored) {
      entry.phase =
        stored.payloadHash === digestFor(entry.draft)
          ? stored.phase
          : "blocked";
      entry.message =
        entry.phase === "succeeded"
          ? "Встреча создана и проверена."
          : uncertain;
      if (stored.eventId) entry.eventId = stored.eventId;
    }
    return structuredClone(entry);
  }
  async read(accountId: string, id: string, _revision: number) {
    const entry = this.entry(accountId, id);
    return entry.phase === "submitting"
      ? structuredClone(entry)
      : this.restore(entry);
  }
  async edit(accountId: string, input: unknown) {
    const q = meetingEdit.parse(input);
    const entry = this.entry(accountId, q.id, q.revision);
    await this.read(accountId, q.id, q.revision);
    if (entry.phase !== "preview")
      throw new MeetingOperationError(
        "После начала отправки черновик нельзя менять.",
      );
    // Check again after I/O: another edit may have advanced the version.
    this.entry(accountId, q.id, q.revision);
    entry.draft = {
      ...entry.draft,
      title: q.title,
      agenda: q.agenda,
      revision: q.revision + 1,
    };
    entry.message =
      "Изменения сохранены. Проверьте новую версию перед созданием.";
    return structuredClone(entry);
  }
  async confirm(
    accountId: string,
    id: string,
    revision: number,
    assertCurrent: () => void = () => {},
  ) {
    const entry = this.entry(accountId, id, revision);
    if (entry.phase !== "preview") return structuredClone(entry);
    entry.phase = "submitting";
    entry.message = "Проверяю и отправляю…";
    let claimed = false,
      journalAccess = false;
    try {
      assertCurrent();
      journalAccess = true;
      await this.restore(entry);
      if (entry.phase !== "submitting") return structuredClone(entry);
      journalAccess = false;
      await this.writer.preflight(entry.draft);
      assertCurrent();
      journalAccess = true;
      claimed = await this.journal.claim(
        keyFor(entry.draft),
        digestFor(entry.draft),
      );
      if (!claimed) return await this.restore(entry);
      assertCurrent();
      const eventId = await this.writer.create(entry.draft);
      entry.eventId = eventId;
      await this.journal.finish(keyFor(entry.draft), {
        phase: "unknown",
        eventId,
      });
      if (!(await this.writer.verify(entry.draft, eventId)))
        throw new Error("Не удалось сверить созданное событие.");
      await this.journal.finish(keyFor(entry.draft), {
        phase: "succeeded",
        eventId,
      });
      entry.phase = "succeeded";
      entry.message = "Встреча создана и проверена.";
    } catch {
      // Even a failed durable claim can have left a file. Never proceed without certainty.
      if (claimed || journalAccess) {
        entry.phase = "unknown";
        entry.message = uncertain;
        try {
          if (
            (await this.writer.verify(entry.draft, entry.eventId)) &&
            entry.eventId
          ) {
            await this.journal.finish(keyFor(entry.draft), {
              phase: "succeeded",
              eventId: entry.eventId,
            });
            entry.phase = "succeeded";
            entry.message = "Встреча создана и проверена.";
          }
        } catch {
          /* Unknown stays blocked. */
        }
      } else {
        entry.phase = "preview";
        entry.message =
          "Отправка не выполнена. Проверьте доступ, конфликты и журнал перед новой попыткой.";
      }
    }
    return structuredClone(entry);
  }
  async reconcile(accountId: string, id: string, revision: number) {
    const entry = this.entry(accountId, id, revision);
    if (entry.phase === "submitting") return structuredClone(entry);
    await this.restore(entry);
    if (entry.phase !== "unknown") return structuredClone(entry);
    try {
      if (
        (await this.writer.verify(entry.draft, entry.eventId)) &&
        entry.eventId
      ) {
        await this.journal.finish(keyFor(entry.draft), {
          phase: "succeeded",
          eventId: entry.eventId,
        });
        entry.phase = "succeeded";
        entry.message = "Встреча создана и проверена.";
      }
    } catch {
      /* No write retry, including when reconciliation is unavailable. */
    }
    return structuredClone(entry);
  }
}
