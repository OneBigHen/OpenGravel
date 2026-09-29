/**
 * The application-facing RideSession persistence port
 * (02-ARCHITECTURE-CONTRACT §14–§15; 08-RIDE-NAVIGATION-AND-FREE-RIDE §11–§13;
 * 17-IMPLEMENTATION-PLAN Task 8.1).
 *
 * The durable shape is a **journal/checkpoint pair**, not a single row:
 *
 * - `appendEvents` writes one journal row per applied event. The journal is the
 *   authoritative record of what happened, so an event that is journaled can
 *   always be replayed even if no checkpoint has folded it yet.
 * - `checkpoint` folds a *bounded batch* of already-journaled events into one
 *   checkpoint row **and compacts the rows it folded** in a single atomic
 *   transaction. That is the 5.1 discipline (02 §15) applied to the session:
 *   the row and the compaction are one write, so a crash cannot leave a
 *   checkpoint claiming rows that are still there — or remove rows a checkpoint
 *   has not folded.
 * - Because the two writes are separate, a crash can leave the journal *ahead*
 *   of the checkpoint. That is the normal, recoverable case: resume replays the
 *   readable tail, and the last un-parseable row is reported as dropped rather
 *   than trusted (8 §13).
 *
 * Infrastructure supplies the IndexedDB implementation; the controller and any
 * recovery surface depend on this contract rather than on Dexie or a concrete
 * database connection.
 */

import type { RideSessionId } from "@/domain/ride-session/ids";
import type {
  RideSessionActivity,
  RideSessionErrorCode,
  RideSessionEvent,
  RideSessionState,
} from "@/domain/ride-session/types";

/** The folded state and the journal position it has consumed. */
export interface RideSessionCheckpoint {
  readonly state: RideSessionState;
  /** The `seq` of the last journal row folded into `state`; `0` when none. */
  readonly checkpointSeq: number;
  /** Monotonic per-session checkpoint revision (writer fencing, §15). */
  readonly revision: number;
}

/** One journaled event; `seq` is 1-based, contiguous and monotonic. */
export interface RideSessionJournalEntry {
  readonly seq: number;
  readonly event: RideSessionEvent;
}

/** A journal row as stored: the entry plus its addressable identity. */
export interface RideSessionJournalRecord extends RideSessionJournalEntry {
  readonly id: string;
  readonly sessionId: RideSessionId;
}

/**
 * Why a journal position could not be applied. The first two are storage-level
 * (a row that could not be read at all, and a row whose event never finished
 * being written); `sequence-gap` is a missing position between readable rows;
 * the last two come from the reducer refusing the event during replay.
 */
export type DroppedSessionEventReason =
  | "unreadable-record"
  | "missing-event"
  | "sequence-gap"
  | "rejected-by-reducer"
  | "after-dropped-event";

/** One honest report of something the journal stated that did not apply. */
export interface DroppedSessionEvent {
  /** The journal position, when the row carried a usable one. */
  readonly seq: number | null;
  readonly reason: DroppedSessionEventReason;
  readonly code?: RideSessionErrorCode;
  readonly message: string;
}

/** Everything a recovery read found, already validated row by row. */
export interface LoadedRideSession {
  /** The folded state, or `null` when no readable checkpoint exists. */
  readonly checkpoint: RideSessionCheckpoint | null;
  /** Readable, event-bearing rows in ascending `seq` order. */
  readonly events: readonly RideSessionJournalEntry[];
  readonly dropped: readonly DroppedSessionEvent[];
}

/** A cheap row for a recovery surface: identity, activity, position, timing. */
export interface RideSessionSummary {
  readonly sessionId: RideSessionId;
  readonly activity: RideSessionActivity;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly endedAt: string | null;
  readonly checkpointSeq: number;
}

export type SessionWriteResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "invalid" | "stale-sequence" | "write-failed";
      readonly message?: string;
      readonly error?: unknown;
    };

export type SessionCheckpointWriteResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "invalid" | "stale-checkpoint" | "write-failed";
      readonly message?: string;
      /** The durable checkpoint this write would have rewound. */
      readonly storedCheckpointSeq?: number;
      readonly error?: unknown;
    };

export interface WriteCheckpointInput {
  readonly state: RideSessionState;
  readonly checkpointSeq: number;
  /** The tab/writer that owns this session; fencing for late writes. */
  readonly writerToken: string;
}

export interface RideSessionRepositoryPort {
  /**
   * Appends journal rows in one transaction. Rows that a checkpoint already
   * folded are refused (`stale-sequence`) instead of rewriting history, and an
   * empty batch is a no-op success.
   */
  appendEvents(
    sessionId: RideSessionId,
    entries: readonly RideSessionJournalEntry[],
  ): Promise<SessionWriteResult>;
  /**
   * Folds `state` (which must already include every row up to
   * `checkpointSeq`) and compacts those rows atomically. A checkpoint older
   * than the durable one is refused: durable state never rewinds.
   */
  checkpoint(input: WriteCheckpointInput): Promise<SessionCheckpointWriteResult>;
  /** `null` only when this session has no durable trace at all. */
  loadSession(sessionId: RideSessionId): Promise<LoadedRideSession | null>;
  listSessions(): Promise<readonly RideSessionSummary[]>;
  deleteSession(sessionId: RideSessionId): Promise<void>;
}

/** Re-exports so a consumer can name the port's vocabulary from one module. */
export type { RideSessionEvent, RideSessionState };
