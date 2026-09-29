/**
 * Bounded whole-ride undo/redo (03-DOMAIN-MODEL §27, 02-ARCHITECTURE-CONTRACT
 * §4–§5, 17-IMPLEMENTATION-PLAN Task 1.3).
 *
 * One user action is one history unit. The unit snapshots the *whole authored
 * intent* it produced, which stays cheap because every large geometry payload
 * lives behind a `GeometryRef` (02-ARCHITECTURE-CONTRACT §4): the index stores
 * references, never repeated 50k-point arrays.
 *
 * ## Cursor and base snapshot
 *
 * `cursor` is the index of the entry that produced the document's current
 * intent; `-1` means the current intent is `baseIntent`, the intent the ride
 * had before any history entry. Undo therefore always has a well-defined
 * destination: `entries[cursor - 1].intent`, or `baseIntent` at the origin.
 *
 * ## Bound
 *
 * The index keeps at most `HISTORY_LIMIT` entries. Appending beyond the limit
 * drops the oldest entries, shifts `cursor` by the same amount and moves
 * `baseIntent` forward to the intent of the newest dropped entry, so undo past
 * the pruned boundary lands on a real authored ride instead of an artificial
 * empty state.
 *
 * ## Moves are revisions, not commands
 *
 * Undo and redo are *document moves*: each produces a new deeply frozen
 * document with `revision + 1` and a fresh `updatedAt` (the planning
 * invalidation fence of 02-ARCHITECTURE-CONTRACT §5), restores a stored intent
 * snapshot by reference, and never appends a history entry, truncates the tail
 * it moves through, or mutates its input.
 *
 * ## What is not undoable
 *
 * Physical facts — GPS samples, recordings, traffic/closure evidence, provider
 * health, published contributions — never enter this index, so there is no
 * mechanism here for them (03-DOMAIN-MODEL §27).
 */

import { deepFreeze } from "../util/freeze";
import type {
  RideDocument,
  RideHistoryEntry,
  RideHistoryIndex,
  RideIntent,
} from "./types";

/** Maximum number of logical undo units the index keeps. */
export const HISTORY_LIMIT = 50;

/** How many recent proposal IDs stay replay-safe (FIFO). */
const PROPOSAL_HISTORY_LIMIT = 20;

/** Optional inputs for one undo/redo move. */
export interface HistoryMoveOptions {
  /** ISO-8601 instant stamped into `updatedAt`; defaults to the wall clock. */
  readonly now?: string;
}

/** One performed undo/redo: the next document plus the entry label for UI copy. */
export interface HistoryMove {
  readonly document: RideDocument;
  /** Label of the entry the move crossed (undone for undo, redone for redo). */
  readonly label: string;
}

/** `null` means the move was not possible: the cursor is already at that boundary. */
export type HistoryMoveResult = HistoryMove | null;

/** Whether the document can move back one history unit. */
export function canUndo(document: RideDocument): boolean {
  return document.history.cursor >= 0;
}

/** Whether the document can move forward one history unit. */
export function canRedo(document: RideDocument): boolean {
  return document.history.cursor < document.history.entries.length - 1;
}

/**
 * Moves one unit back: the prior authored intent (the previous entry's
 * snapshot, or `baseIntent` at the origin), a new revision, and the label of
 * the entry being undone. Returns `null` when there is nothing to undo. The
 * undone entry stays in place, so redo can replay it.
 */
export function undoRide(
  document: RideDocument,
  options: HistoryMoveOptions = {},
): HistoryMoveResult {
  const { entries, cursor, baseIntent } = document.history;
  const current = entries[cursor];
  if (current === undefined) return null;
  const target = cursor - 1;
  const prior = entries[target];
  return {
    document: moveTo(document, prior === undefined ? baseIntent : prior.intent, target, options.now),
    label: current.label,
  };
}

/**
 * Moves one unit forward: the target entry's intent snapshot, a new revision,
 * and that entry's label. Returns `null` when the cursor is at the newest
 * entry. The entry is reused in place, never re-applied.
 */
export function redoRide(
  document: RideDocument,
  options: HistoryMoveOptions = {},
): HistoryMoveResult {
  const target = document.history.cursor + 1;
  const entry = document.history.entries[target];
  if (entry === undefined) return null;
  return {
    document: moveTo(document, entry.intent, target, options.now),
    label: entry.label,
  };
}

/**
 * Appends one logical undo unit: slice the redo tail first (a new edit cuts
 * redo), then append, then move the cursor to the new last entry, then enforce
 * `HISTORY_LIMIT`. Existing entries and `appliedProposalIds` are preserved.
 */
export function appendHistoryEntry(
  index: RideHistoryIndex,
  entry: RideHistoryEntry,
): RideHistoryIndex {
  const entries = [...index.entries.slice(0, index.cursor + 1), entry];
  return pruneHistory({ ...index, entries, cursor: entries.length - 1 });
}

/**
 * Enforces `HISTORY_LIMIT` by dropping the oldest entries. `cursor` shifts by
 * the number dropped (floored at `-1`, the base position) and `baseIntent`
 * becomes the intent of the newest dropped entry, so the pruned boundary is a
 * real authored intent. A `no-op` returns the same index object.
 */
export function pruneHistory(index: RideHistoryIndex): RideHistoryIndex {
  const overflow = index.entries.length - HISTORY_LIMIT;
  if (overflow <= 0) return index;
  const dropped = index.entries.slice(0, overflow);
  const newestDropped = dropped[dropped.length - 1];
  return {
    ...index,
    entries: index.entries.slice(overflow),
    cursor: Math.max(-1, index.cursor - overflow),
    baseIntent: newestDropped === undefined ? index.baseIntent : newestDropped.intent,
  };
}

/**
 * Records an applied advisor proposal so re-applying it stays idempotent
 * (03-DOMAIN-MODEL §24). Keeps the last `PROPOSAL_HISTORY_LIMIT` ids FIFO and
 * leaves `entries`, `cursor` and `baseIntent` untouched — the redo-tail cut
 * never forgets a proposal that is still reachable by redo.
 */
export function recordProposalApplied(
  index: RideHistoryIndex,
  proposalId: string,
): RideHistoryIndex {
  return {
    ...index,
    appliedProposalIds: [...index.appliedProposalIds, proposalId].slice(
      -PROPOSAL_HISTORY_LIMIT,
    ),
  };
}

/** One new revision over a restored intent snapshot, deeply frozen. */
function moveTo(
  document: RideDocument,
  intent: RideIntent,
  cursor: number,
  now: string | undefined,
): RideDocument {
  return deepFreeze<RideDocument>({
    ...document,
    revision: document.revision + 1,
    updatedAt: now ?? new Date().toISOString(),
    intent,
    history: { ...document.history, cursor },
  });
}
