import type { CalendarEvent } from "./calendar.js";

export interface MoveTimes {
  startsAt: string;
  endsAt: string;
}
/**
 * saving: the write is in flight. awaiting: Small confirmed it, the refreshed list
 * has not arrived yet. unknown: the outcome could not be established; only data read
 * from Small afterwards may decide.
 */
export type MovePhase = "saving" | "awaiting" | "unknown";
export interface PendingMove {
  before: MoveTimes;
  after: MoveTimes;
  phase: MovePhase;
  /** When the phase began; data confirmed before this cannot settle the move. */
  since: number;
}
/** Optimistic moves by event key. */
export type PendingMoves = Record<string, PendingMove>;
export type MoveReply = "applied" | "refused" | "unknown";

/** After this long a confirmed move that the list still shows at the old time is dropped. */
export const AWAITING_EXPIRES_MS = 10_000;

const instant = (value: string) => Date.parse(value);
const sameTimes = (a: MoveTimes, b: MoveTimes) =>
  instant(a.startsAt) === instant(b.startsAt) &&
  instant(a.endsAt) === instant(b.endsAt);

/** A refusal frees the event at once; only an unestablished outcome keeps it locked. */
export function classifyMoveReply(reply: {
  ok: boolean;
  unknownOutcome?: boolean;
}): MoveReply {
  return reply.ok ? "applied" : reply.unknownOutcome ? "unknown" : "refused";
}

export function beginMove(
  moves: PendingMoves,
  key: string,
  before: MoveTimes,
  after: MoveTimes,
  now: number,
): PendingMoves {
  // Only a move that Small has confirmed may be followed by another one: its time is
  // then known to be the one on screen.
  const existing = moves[key];
  if (existing && existing.phase !== "awaiting") return moves;
  return { ...moves, [key]: { before, after, phase: "saving", since: now } };
}

export function resolveMove(
  moves: PendingMoves,
  key: string,
  reply: MoveReply,
  now: number,
): PendingMoves {
  const move = moves[key];
  if (!move) return moves;
  if (reply === "refused") {
    const { [key]: _removed, ...rest } = moves;
    return rest;
  }
  return {
    ...moves,
    [key]: {
      ...move,
      phase: reply === "applied" ? "awaiting" : "unknown",
      since: now,
    },
  };
}

/** The list as the user should see it: moved events already at their new time. */
export function overlayMoves(
  events: CalendarEvent[],
  moves: PendingMoves,
): CalendarEvent[] {
  if (!events.some((event) => moves[event.key])) return events;
  return events.map((event) => {
    const move = moves[event.key];
    return move ? { ...event, ...move.after } : event;
  });
}

/** While a write is in flight or its outcome is unknown the event must not be moved again. */
export const isMoveLocked = (moves: PendingMoves, key: string) => {
  const phase = moves[key]?.phase;
  return phase === "saving" || phase === "unknown";
};

/** What a card shows. A move Small already confirmed looks final: it only awaits the list. */
export const moveBadge = (move: PendingMove): "saving" | "unknown" | null =>
  move.phase === "saving"
    ? "saving"
    : move.phase === "unknown"
      ? "unknown"
      : null;

export type SettledOutcome =
  "confirmed" | "reverted" | "diverged" | "gone" | "expired";
export interface SettledMove {
  key: string;
  phase: MovePhase;
  outcome: SettledOutcome;
}

/**
 * Lets data read from Small decide moves that no longer wait for a reply. Only a
 * list confirmed after the phase began counts: an older cached copy shows the old
 * time and would wrongly revert the move.
 */
export function settleMoves(
  moves: PendingMoves,
  events: CalendarEvent[],
  fetchedAt: number | null,
  now: number,
): { moves: PendingMoves; settled: SettledMove[] } {
  const remaining: PendingMoves = {};
  const settled: SettledMove[] = [];
  for (const [key, move] of Object.entries(moves)) {
    const finish = (outcome: SettledOutcome) =>
      settled.push({ key, phase: move.phase, outcome });
    if (move.phase === "saving") {
      remaining[key] = move;
      continue;
    }
    const fresh = fetchedAt !== null && fetchedAt >= move.since;
    const event = events.find((item) => item.key === key);
    if (fresh && !event) finish("gone");
    else if (fresh && event && sameTimes(event, move.after))
      finish("confirmed");
    else if (fresh && event && sameTimes(event, move.before)) {
      // Still the old time: a confirmed move may just be waiting for the list,
      // an unknown one is now known not to have happened.
      if (move.phase === "unknown") finish("reverted");
      else if (now - move.since > AWAITING_EXPIRES_MS) finish("expired");
      else remaining[key] = move;
    } else if (fresh) finish("diverged");
    else if (
      move.phase === "awaiting" &&
      now - move.since > AWAITING_EXPIRES_MS
    )
      finish("expired");
    else remaining[key] = move;
  }
  return { moves: settled.length ? remaining : moves, settled };
}
