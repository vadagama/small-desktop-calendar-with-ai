import { MeetingCreateRejected } from "./meeting-create-error.js";
import { CalendarWriteNotStarted } from "./calendar-write-error.js";
import { CalendarError } from "./calendar.js";
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
  /** Read-only proof that a previously verified event has been deleted. */
  wasDeleted?(draft: MeetingDraft, eventId: string): Promise<boolean>;
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
  private operationKeys = new Map<string, string>();
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
  private operationKey(entry: MeetingView) {
    const key = this.operationKeys.get(entry.draft.id);
    if (!key)
      throw new MeetingOperationError("Журнал черновика ещё не проверен.");
    return key;
  }
  private async receipt(entry: MeetingView) {
    const pinned = this.operationKeys.get(entry.draft.id);
    if (pinned) return this.journal.read(pinned);
    let key = keyFor(entry.draft);
    for (let generation = 0; generation < 100; generation++) {
      const stored = await this.journal.read(key);
      if (
        stored?.phase === "succeeded" &&
        stored.eventId &&
        (await this.writer.wasDeleted?.(entry.draft, stored.eventId))
      ) {
        // Preserve old receipts and give fresh drafts a shared successor claim.
        // Old cards stay pinned to their original operation and cannot replay it.
        key = hash([key, stored.eventId]);
        continue;
      }
      this.operationKeys.set(entry.draft.id, key);
      return stored;
    }
    throw new MeetingOperationError(
      "Слишком много прежних операций на это время.",
    );
  }
  private async restore(entry: MeetingView) {
    const stored = await this.receipt(entry);
    if (stored) {
      entry.phase =
        stored.payloadHash === digestFor(entry.draft)
          ? stored.phase
          : "blocked";
      entry.message =
        entry.phase === "succeeded"
          ? "Встреча создана и проверена."
          : entry.phase === "blocked"
            ? "На это время уже отправлялся другой черновик с теми же участниками. Создание заблокировано, чтобы не продублировать встречу. Проверьте прежнюю карточку или выберите другое время."
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
        this.operationKey(entry),
        digestFor(entry.draft),
      );
      if (!claimed) return await this.restore(entry);
      assertCurrent();
      const eventId = await this.writer.create(entry.draft);
      entry.eventId = eventId;
      await this.journal.finish(this.operationKey(entry), {
        phase: "unknown",
        eventId,
      });
      if (!(await this.writer.verify(entry.draft, eventId)))
        throw new Error("Не удалось сверить созданное событие.");
      await this.journal.finish(this.operationKey(entry), {
        phase: "succeeded",
        eventId,
      });
      entry.phase = "succeeded";
      entry.message = "Встреча создана и проверена.";
    } catch (error) {
      if (
        claimed &&
        !entry.eventId &&
        (error instanceof MeetingCreateRejected ||
          error instanceof CalendarWriteNotStarted)
      ) {
        try {
          await this.journal.releaseRejected(this.operationKey(entry));
          entry.phase = "preview";
          entry.message = error.message;
          return structuredClone(entry);
        } catch {
          // Keep the retry blocked if durable cleanup could not be confirmed.
        }
      }
      // Even a failed durable claim can have left a file. Never proceed without certainty.
      if (claimed || journalAccess) {
        entry.phase = "unknown";
        entry.message = uncertain;
        try {
          if (
            (await this.writer.verify(entry.draft, entry.eventId)) &&
            entry.eventId
          ) {
            await this.journal.finish(this.operationKey(entry), {
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
          error instanceof CalendarError
            ? error.message
            : "Отправка не выполнена. Проверьте доступ, конфликты и журнал перед новой попыткой.";
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
        await this.journal.finish(this.operationKey(entry), {
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
