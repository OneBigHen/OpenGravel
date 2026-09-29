/**
 * Session recovery: turning a durable trace back into a valid live state
 * (08-RIDE-NAVIGATION-AND-FREE-RIDE §13; 02-ARCHITECTURE-CONTRACT §14–§15;
 * 17-IMPLEMENTATION-PLAN Task 8.1; OGV-RID-008).
 *
 * Recovery is a pure function over what storage read: the checkpoint plus the
 * readable journal tail, folded through the same reducer that produced the live
 * state. Two properties follow from that, and both are tested:
 *
 * - **The reconstruction is byte-equivalent to the live state** the events
 *   produced, because the fold is deterministic and the state carries no
 *   read-time fields (freshness is derived, never stored).
 * - **The reconstruction is prefix-honest.** It applies the longest readable,
 *   contiguous run of rows and reports everything it did not apply: a truncated
 *   row, an unreadable row, a gap, or the reducer's own rejection of an event.
 *   It never infers the missing events, and it never continues past a rejected
 *   one, because later events may depend on the one that failed.
 *
 * §13's "restore paused, require fresh GPS and explicit Resume" is deliberately
 * *not* in this module: reconstruction returns the state the journal states, and
 * the controller performs the pause as a normal, journaled `session.paused`
 * transition — so the recovery is visible in the same history as everything
 * else instead of being a special case the state machine does not know about.
 */

import type {
  DroppedSessionEvent,
  LoadedRideSession,
} from "@/application/persistence/ride-session-repository";
import type { RideSessionId } from "@/domain/ride-session/ids";
import { replaySessionJournal } from "@/domain/ride-session/reducer";
import type {
  RideSessionEvent,
  RideSessionState,
} from "@/domain/ride-session/types";

export interface SessionReconstruction {
  /** `null` when the durable trace cannot produce a session at all. */
  readonly state: RideSessionState | null;
  /** The journal position the folded state is backed by; `0` when none. */
  readonly checkpointSeq: number;
  /** How many tail events were replayed onto the checkpoint. */
  readonly appliedEventCount: number;
  readonly droppedEvents: readonly DroppedSessionEvent[];
}

/**
 * Folds a durable trace into a session state (see the module comment).
 *
 * `loaded === null` means storage had nothing; the result is a `null` state with
 * no drops, which the controller reports as `absent`.
 */
export function reconstructRideSession(
  loaded: LoadedRideSession | null,
  sessionId: RideSessionId,
): SessionReconstruction {
  if (loaded === null) {
    return { state: null, checkpointSeq: 0, appliedEventCount: 0, droppedEvents: [] };
  }
  const checkpoint = loaded.checkpoint;
  const dropped: DroppedSessionEvent[] = [...loaded.dropped];

  // A trace that names a different session is not this session's evidence:
  // its folded state is discarded rather than adopted under the wrong identity.
  const checkpointState =
    checkpoint !== null && checkpoint.state.sessionId === sessionId
      ? checkpoint.state
      : null;
  if (checkpoint !== null && checkpointState === null) {
    dropped.unshift({
      seq: checkpoint.checkpointSeq,
      reason: "unreadable-record",
      message: `the checkpoint belongs to session "${checkpoint.state.sessionId}", not "${sessionId}"`,
    });
  }

  // Only a contiguous run starting right after the checkpoint can be folded.
  let expectedSeq = (checkpoint !== null && checkpointState !== null ? checkpoint.checkpointSeq : 0) + 1;
  const applicable: RideSessionEvent[] = [];
  const seqs: number[] = [];
  for (const entry of loaded.events) {
    if (entry.seq < expectedSeq) continue;
    if (entry.seq > expectedSeq) {
      dropped.push({
        seq: expectedSeq,
        reason: "sequence-gap",
        message: `the journal jumps to ${entry.seq}; ${expectedSeq} is missing`,
      });
      break;
    }
    applicable.push(entry.event);
    seqs.push(entry.seq);
    expectedSeq += 1;
  }

  const replay = replaySessionJournal(checkpointState, applicable);
  for (const drop of replay.dropped) {
    dropped.push({
      seq: seqs[drop.index] ?? null,
      reason: drop.reason,
      ...(drop.code === undefined ? {} : { code: drop.code }),
      message: drop.message,
    });
  }

  return {
    state: replay.state,
    checkpointSeq:
      checkpoint !== null && checkpointState !== null ? checkpoint.checkpointSeq : 0,
    appliedEventCount: replay.appliedCount,
    droppedEvents: dropped,
  };
}
