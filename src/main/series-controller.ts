import { z } from "zod";
import type { SeriesDeletionService } from "./series-deletion.js";
import { validCalendarDate } from "../shared/calendar-time.js";
import {
  describeScope,
  seriesOperations,
  seriesScopes,
  type SeriesApplyResult,
  type SeriesGateState,
} from "../shared/series-scope.js";
import { CalendarError } from "./calendar.js";
import { SmallAuthError, type SmallAuth } from "./small-auth.js";
import {
  gateSeriesOperation,
  seriesContractEvidence,
} from "./series-contract.js";
import type { SeriesMutationService } from "./series-adapter.js";

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const stamp = z.iso.datetime({ offset: true });
const request = z
  .strictObject({
    accountId: z.string().min(1).max(200),
    operation: z.enum(seriesOperations),
    scope: z.enum(seriesScopes),
    seriesId: identifier,
    originalDate: z.string().refine(validCalendarDate),
    eventId: identifier.optional(),
    beforeStart: stamp,
    beforeEnd: stamp,
    title: z.string().trim().min(1).max(200).optional(),
    newStartsAt: stamp.optional(),
    newEndsAt: stamp.optional(),
  })
  .superRefine((r, ctx) => {
    const wantsTitle = r.operation === "rename";
    const wantsTimes = r.operation === "move";
    if (
      wantsTitle !== (r.title !== undefined) ||
      wantsTimes !== (r.newStartsAt !== undefined) ||
      wantsTimes !== (r.newEndsAt !== undefined)
    )
      ctx.addIssue({
        code: "custom",
        message: "Параметры не подходят к действию",
      });
  });

/** Turns a renderer request into a gated, journaled series write. */
export class SeriesController {
  constructor(
    private auth: Pick<SmallAuth, "read">,
    private service: Pick<SeriesMutationService, "apply">,
    private now: () => string = () => new Date().toISOString(),
    private evidence: Parameters<
      typeof gateSeriesOperation
    >[1] = seriesContractEvidence,
    private deletions?: Pick<SeriesDeletionService, "preview" | "apply">,
  ) {}
  private gateFor(input: unknown) {
    const r = request.parse(input);
    const gate = gateSeriesOperation(
      {
        operation: r.operation,
        scope: r.scope,
        occurrence: {
          seriesId: r.seriesId,
          originalDate: r.originalDate,
          ...(r.eventId ? { eventId: r.eventId } : {}),
          startsAt: r.beforeStart,
          endsAt: r.beforeEnd,
        },
        ...(r.newStartsAt ? { newStartsAt: r.newStartsAt } : {}),
        ...(r.newEndsAt ? { newEndsAt: r.newEndsAt } : {}),
        now: this.now(),
      },
      this.evidence,
    );
    return { r, gate };
  }
  private async participant(accountId: string) {
    const state = await this.auth.read();
    if (state.status !== "signed-in" || state.profile.id !== accountId)
      throw new SmallAuthError("Войдите в нужный аккаунт Small.", "auth");
    if (!state.profile.participantId)
      throw new CalendarError(
        "denied",
        "Не удалось определить ваш профиль участника Small.",
      );
    return state.profile.participantId;
  }
  /** State for the dialog; it never carries the approval itself. */
  async gate(input: unknown): Promise<SeriesGateState> {
    const { r, gate } = this.gateFor(input);
    await this.participant(r.accountId);
    if (r.operation === "delete" && this.deletions)
      return this.deletions.preview(r);
    const summary = describeScope(r.scope, r.originalDate);
    return gate.open
      ? { open: true, message: "Действие можно выполнить.", summary }
      : { open: false, reason: gate.reason, message: gate.message, summary };
  }
  async apply(input: unknown): Promise<SeriesApplyResult> {
    const { r, gate } = this.gateFor(input);
    const participantId = await this.participant(r.accountId);
    if (r.operation === "delete" && this.deletions)
      return this.deletions.apply(r);
    if (!gate.open)
      throw new CalendarError(
        gate.reason === "contract-unverified" ? "denied" : "invalid",
        gate.message,
      );
    const result = await this.service.apply({
      accountId: r.accountId,
      participantId,
      approval: gate.approval,
      change:
        r.operation === "rename"
          ? { kind: "rename", title: r.title }
          : { kind: r.operation },
    });
    return { status: result.status, materialized: result.materialized };
  }
}
