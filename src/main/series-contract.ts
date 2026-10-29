import {
  decideSeriesOperation,
  occurrenceKey,
  scopeLabels,
  type ContractAssumption,
  type OccurrenceInput,
  type SeriesDecision,
  type SeriesOperation,
  type SeriesRefusal,
  type SeriesScope,
} from "../shared/series-scope.js";

/**
 * Server behaviour confirmed by a recorded run of docs/research/series-contract-probe.md.
 * Empty until then: series writes stay closed. Add an entry only together with a line
 * "A<n>: подтверждено" in docs/research/series-contract-results.md.
 *
 * This gate covers new series operations only. Moving an occurrence that has its own id
 * with `recurring_edit_type: single` (T10, event-reschedule.ts) is earlier, separately
 * agreed behaviour and is not routed through here.
 */
export const seriesContractEvidence: Partial<
  Record<ContractAssumption, { verifiedOn: string }>
> = {};

const operationLabels: Record<SeriesOperation, string> = {
  rename: "Переименование",
  move: "Перенос",
  delete: "Удаление",
};

export interface SeriesApproval {
  readonly operation: SeriesOperation;
  readonly scope: SeriesScope;
  readonly occurrence: Readonly<OccurrenceInput>;
  readonly key: string;
  readonly decision: Extract<SeriesDecision, { allowed: true }>;
  readonly newStartsAt?: string;
  readonly newEndsAt?: string;
}
export type SeriesGate =
  | { open: true; approval: SeriesApproval }
  | {
      open: false;
      reason: SeriesRefusal | "contract-unverified";
      /** User-facing explanation. */
      message: string;
      /** Unconfirmed server assumptions; empty for policy refusals. */
      missing: ContractAssumption[];
    };

/** Only approvals issued by `gateSeriesOperation` pass; a copied object does not. */
const issued = new WeakSet<object>();
export const isSeriesApproval = (value: unknown): value is SeriesApproval =>
  typeof value === "object" && value !== null && issued.has(value);

export function gateSeriesOperation(
  input: {
    operation: SeriesOperation;
    scope: SeriesScope;
    occurrence: OccurrenceInput;
    newStartsAt?: string;
    newEndsAt?: string;
    now?: string;
  },
  evidence: Partial<
    Record<ContractAssumption, unknown>
  > = seriesContractEvidence,
): SeriesGate {
  const decision = decideSeriesOperation(input);
  if (!decision.allowed)
    return {
      open: false,
      reason: decision.reason,
      message: decision.message,
      missing: [],
    };
  const missing = decision.requires.filter((a) => !evidence[a]);
  if (missing.length)
    return {
      open: false,
      reason: "contract-unverified",
      message: `${operationLabels[input.operation]} (${scopeLabels[input.scope].toLowerCase()}) пока недоступно: поведение повторяющихся встреч в Small ещё не подтверждено проверкой на тестовой среде. Обычные встречи работают как раньше.`,
      missing,
    };
  const approval: SeriesApproval = Object.freeze({
    operation: input.operation,
    scope: input.scope,
    occurrence: Object.freeze({ ...input.occurrence }),
    key: occurrenceKey(input.occurrence),
    decision,
    ...(input.newStartsAt !== undefined
      ? { newStartsAt: input.newStartsAt }
      : {}),
    ...(input.newEndsAt !== undefined ? { newEndsAt: input.newEndsAt } : {}),
  });
  issued.add(approval);
  return { open: true, approval };
}

/** A write must use exactly the approval it was issued for. */
export function assertApproval(
  approval: unknown,
  expected: { operation: SeriesOperation; scope: SeriesScope },
): asserts approval is SeriesApproval {
  if (
    !isSeriesApproval(approval) ||
    approval.operation !== expected.operation ||
    approval.scope !== expected.scope
  )
    throw new Error("Операция серии не одобрена гейтом контракта");
}
