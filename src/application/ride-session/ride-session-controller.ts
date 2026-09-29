/**
 * The RideSession controller — the application-layer owner of the physical
 * activity (02-ARCHITECTURE-CONTRACT §2.3, §14–§15;
 * 08-RIDE-NAVIGATION-AND-FREE-RIDE §1, §11–§13, §26;
 * 17-IMPLEMENTATION-PLAN Task 8.1; OGV-RID-001/002/005/008).
 *
 * The controller owns exactly three things the pure domain must not:
 *
 * 1. **The durable sequence.** It assigns the monotonic journal `seq`, appends
 *    one row per applied event, and folds a *bounded batch* into a checkpoint
 *    when the batch fills (`SESSION_CHECKPOINT_EVENT_INTERVAL`) or the event is
 *    a state-machine boundary (start, pause, resume, completion, abandonment,
 *    mode change, ride revision). A checkpoint failure never loses the event:
 *    the append is the durable record and the next dispatch retries the fold.
 * 2. **The live session.** `snapshot()` is the current frozen state; the state
 *    only ever advances through `reduce`, and writes are serialized so a slow
 *    journal write can never reorder the history.
 * 3. **Recovery.** `resume(sessionId)` reconstructs the state from the durable
 *    checkpoint plus the readable journal tail, reports every dropped or partial
 *    event, and then applies §13: a session that was moving comes back
 *    **paused**, with the reason recorded as an ordinary `interruption` pause in
 *    the same journal. The rider's explicit `session.resumed` is what starts it
 *    moving again, and until then position events are refused — so a pre-reload
 *    fix can never move the ride, and it can never be presented as current
 *    either, because freshness is derived from its age.
 *
 * The controller is a coordinator, not an authority: it holds no state of its
 * own beyond the session, derives nothing the domain does not derive, and writes
 * nothing the session did not already state.
 */

import type { RideId, StopId } from "@/domain/ride/ids";
import type { SessionNavigationState } from "@/domain/ride-session/navigation";
import { deriveSessionNavigation } from "@/domain/ride-session/navigation";
import {
  modeChangedEvent,
  sessionAbandonedEvent,
  sessionCompletedEvent,
  sessionPausedEvent,
  recordingDiscardedEvent,
  sessionResumedEvent,
  sessionStartedEvent,
} from "@/domain/ride-session/create";
import { newRideSessionId, type RideSessionId } from "@/domain/ride-session/ids";
import type { RecordingId } from "@/domain/recording/ids";
import { reduce } from "@/domain/ride-session/reducer";
import type {
  RideSessionErrorCode,
  RideSessionEvent,
  RideSessionEventType,
  RideSessionMovingActivity,
  RideSessionState,
  SessionRouteBinding,
} from "@/domain/ride-session/types";
import type {
  DroppedSessionEvent,
  RideSessionJournalEntry,
  RideSessionRepositoryPort,
} from "@/application/persistence/ride-session-repository";
import type { RideSessionNavigationPort } from "./ports/ride-session-navigation";
import { reconstructRideSession } from "./ride-session-recovery";

/**
 * How many applied events may sit in the journal tail before the controller
 * folds a checkpoint. Sixteen keeps the tail tiny (a checkpoint row holds the
 * latest position, never a trace) while making a checkpoint rare enough that a
 * 1 Hz position stream costs one small write per event and one fold every ~16 s.
 */
export const SESSION_CHECKPOINT_EVENT_INTERVAL = 16;

/**
 * Events that fold a checkpoint immediately, whatever the tail length: each one
 * changes what a crash would restore (the activity, the objective fence, or the
 * route answer), so it is worth the second write.
 */
export const SESSION_BOUNDARY_EVENT_TYPES: readonly RideSessionEventType[] = [
  "session.started",
  "session.paused",
  "session.resumed",
  "session.completed",
  "session.abandoned",
  "recording.discarded",
  "suggestions.changed",
  "mode.changed",
  "ride.revised",
];

export interface StartRideSessionInput {
  readonly activity: RideSessionMovingActivity;
  /** Route-free suggestions policy; Record defaults off, future Just ride on. */
  readonly suggestions?: "on" | "off";
  readonly rideId: RideId;
  readonly rideRevision: number;
  /** Required for `guided`; a Free Ride or track start has no answer to follow. */
  readonly route?: SessionRouteBinding | null;
  readonly itinerary?: readonly StopId[];
  readonly recordingId?: RecordingId | null;
  readonly sessionId?: RideSessionId;
  /** Defaults to the injected clock; explicit for a deterministic caller. */
  readonly at?: string;
}

export interface RideSessionControllerOptions {
  /**
   * Durable storage. Absent means an in-memory-only session: every command
   * reports `persistence: "unsaved"`, which is honest rather than optimistic.
   */
  readonly repository?: RideSessionRepositoryPort;
  /** The tab/writer that owns the session (checkpoint fencing). */
  readonly writerToken?: string;
  readonly now?: () => string;
  readonly checkpointInterval?: number;
}

/**
 * How durable the last command is. `durable` means the event is in the journal
 * (so a crash replays it); `failed` means the live state is ahead of durable
 * state; `unsaved` means no repository is wired at all.
 */
export type SessionPersistenceStatus = "durable" | "failed" | "unsaved";

export interface RideSessionCommandResult {
  readonly outcome: "applied" | "rejected";
  readonly code?: RideSessionErrorCode;
  readonly message?: string;
  readonly state: RideSessionState | null;
  readonly persistence: SessionPersistenceStatus;
  readonly error?: unknown;
}

export type SessionRecoveryReport =
  | {
      readonly status: "restored";
      readonly state: RideSessionState;
      readonly checkpointSeq: number;
      readonly appliedEventCount: number;
      readonly droppedEvents: readonly DroppedSessionEvent[];
      /** `true` when this recovery applied §13's pause to a moving session. */
      readonly pausedByRecovery: boolean;
    }
  | { readonly status: "absent" }
  | {
      readonly status: "unrecoverable";
      readonly droppedEvents: readonly DroppedSessionEvent[];
    }
  | { readonly status: "unavailable"; readonly error: unknown };

export interface RideSessionController extends RideSessionNavigationPort {
  snapshot(): RideSessionState | null;
  /** Applies `session.started` through the reducer (one physical activity). */
  start(input: StartRideSessionInput): Promise<RideSessionCommandResult>;
  /** The only mutation entry after start. */
  dispatch(event: RideSessionEvent): Promise<RideSessionCommandResult>;
  /** Durable reconstruction + §13 restore-paused, reporting dropped events. */
  resume(sessionId: RideSessionId): Promise<SessionRecoveryReport>;
  /** The last recovery this controller performed, if any. */
  recovery(): SessionRecoveryReport | null;
  /** Waits for every queued durable write; it never forces a checkpoint. */
  flush(): Promise<void>;
  /** Detaches the controller: later commands are refused, not queued. */
  dispose(): void;
}

function isMoving(state: RideSessionState): boolean {
  return (
    state.activity === "guided" || state.activity === "free" || state.activity === "track"
  );
}

export function createRideSessionController(
  options: RideSessionControllerOptions = {},
): RideSessionController {
  const repository = options.repository ?? null;
  const writerToken = options.writerToken ?? "ride-session";
  const now = options.now ?? ((): string => new Date().toISOString());
  const checkpointInterval = options.checkpointInterval ?? SESSION_CHECKPOINT_EVENT_INTERVAL;

  let state: RideSessionState | null = null;
  let lastSeq = 0;
  let uncheckpointed = 0;
  let lastRecovery: SessionRecoveryReport | null = null;
  let disposed = false;
  let chain: Promise<unknown> = Promise.resolve();

  /**
   * Serializes durable writes. `dispatch` awaits its own write, and a write that
   * fails still resolves the chain, so one storage error cannot block the queue.
   */
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = chain.then(work, work);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Journals one applied event and folds a checkpoint when the batch is full or
   * the event is a boundary. A checkpoint failure leaves the event journaled:
   * the caller is told the event is durable, and the fold is retried by the next
   * command because `uncheckpointed` is left standing.
   */
  async function persist(
    sessionId: RideSessionId,
    event: RideSessionEvent,
    appliedState: RideSessionState,
  ): Promise<SessionPersistenceStatus> {
    if (repository === null) return "unsaved";
    const seq = lastSeq + 1;
    const entry: RideSessionJournalEntry = { seq, event };
    try {
      const appended = await repository.appendEvents(sessionId, [entry]);
      if (!appended.ok) return "failed";
      lastSeq = seq;
      uncheckpointed += 1;
      if (
        SESSION_BOUNDARY_EVENT_TYPES.includes(event.type) ||
        uncheckpointed >= checkpointInterval
      ) {
        const folded = await repository.checkpoint({
          state: appliedState,
          checkpointSeq: seq,
          writerToken,
        });
        if (folded.ok) uncheckpointed = 0;
      }
      return "durable";
    } catch (error: unknown) {
      void error;
      return "failed";
    }
  }

  async function applyEvent(event: RideSessionEvent): Promise<RideSessionCommandResult> {
    const outcome = reduce(state, event);
    if (outcome.outcome === "rejected") {
      return {
        outcome: "rejected",
        code: outcome.code,
        message: outcome.message,
        state,
        persistence: repository === null ? "unsaved" : "durable",
      };
    }
    const applied = outcome.state;
    state = applied;
    const persistence = await enqueue(() => persist(applied.sessionId, event, applied));
    return { outcome: "applied", state: applied, persistence };
  }

  return {
    snapshot(): RideSessionState | null {
      return state;
    },

    navigationState(): SessionNavigationState | null {
      return state === null ? null : deriveSessionNavigation(state, { now: now() });
    },

    async start(input: StartRideSessionInput): Promise<RideSessionCommandResult> {
      const event = sessionStartedEvent({
        at: input.at ?? now(),
        activity: input.activity,
        plan: {
          rideId: input.rideId,
          rideRevision: input.rideRevision,
          route: input.route ?? null,
        },
        sessionId: input.sessionId ?? newRideSessionId(),
        itinerary: input.itinerary ?? [],
        recordingId: input.recordingId ?? null,
        suggestions: input.suggestions ?? "off",
      });
      return applyEvent(event);
    },

    dispatch(event: RideSessionEvent): Promise<RideSessionCommandResult> {
      if (disposed) {
        return Promise.resolve({
          outcome: "rejected",
          code: "no-session",
          message: "the ride-session controller is disposed",
          state,
          persistence: "unsaved",
        });
      }
      return applyEvent(event);
    },

    async resume(sessionId: RideSessionId): Promise<SessionRecoveryReport> {
      if (repository === null) {
        const report: SessionRecoveryReport = {
          status: "unavailable",
          error: new Error("no ride-session repository is wired"),
        };
        lastRecovery = report;
        return report;
      }
      let loaded;
      try {
        loaded = await repository.loadSession(sessionId);
      } catch (error: unknown) {
        const report: SessionRecoveryReport = { status: "unavailable", error };
        lastRecovery = report;
        return report;
      }
      if (loaded === null) {
        const report: SessionRecoveryReport = { status: "absent" };
        lastRecovery = report;
        return report;
      }
      const reconstruction = reconstructRideSession(loaded, sessionId);
      if (reconstruction.state === null) {
        const report: SessionRecoveryReport = {
          status: "unrecoverable",
          droppedEvents: reconstruction.droppedEvents,
        };
        lastRecovery = report;
        return report;
      }

      const reconstructed = reconstruction.state;
      state = reconstructed;
      lastSeq = reconstruction.checkpointSeq + reconstruction.appliedEventCount;
      uncheckpointed = reconstruction.appliedEventCount;

      // §13: a session that was moving comes back paused, with the reason in the
      // journal. A session that was already paused is left exactly as it was.
      let pausedByRecovery = false;
      if (isMoving(reconstructed)) {
        const pause = await applyEvent(sessionPausedEvent(now(), "interruption"));
        pausedByRecovery = pause.outcome === "applied";
      }

      const current = state ?? reconstructed;
      const report: SessionRecoveryReport = {
        status: "restored",
        state: current,
        checkpointSeq: reconstruction.checkpointSeq,
        appliedEventCount: reconstruction.appliedEventCount,
        droppedEvents: reconstruction.droppedEvents,
        pausedByRecovery,
      };
      lastRecovery = report;
      return report;
    },

    recovery(): SessionRecoveryReport | null {
      return lastRecovery;
    },

    async flush(): Promise<void> {
      await chain;
    },

    dispose(): void {
      disposed = true;
    },
  };
}

/** Re-exported for a caller that builds a mode change from the same module. */
export {
  modeChangedEvent,
  sessionAbandonedEvent,
  sessionCompletedEvent,
  sessionPausedEvent,
  sessionResumedEvent,
  recordingDiscardedEvent,
};
