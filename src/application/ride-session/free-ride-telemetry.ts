/**
 * Free Ride live telemetry (RIDE-INSTRUMENT-STRIP §6, §11).
 *
 * A Free Ride that is not recording has no stored track, so the recording's
 * telemetry cannot back moving time or max speed. This folds every accepted
 * session fix into the *same* accumulator the recording uses
 * (`domain/recording/telemetry`: one filter, one state machine, one set of
 * thresholds) and keeps only its small state, not the points.
 *
 * ## Durability
 *
 * The state is written through a port keyed to the session, at most every
 * `writeIntervalMs` while fixes arrive, and at once on `flush()` (pause, the
 * surface stopping, the page hiding). On a reload it is read back and
 * *suspended*: a reload is a pause, so the next fix starts a new chain and the
 * time the page was gone never counts as moving. `end()` drops it when the
 * ride ends.
 *
 * A storage failure is never thrown: the fold carries on for this page, and
 * persistence is simply off until the page reloads.
 *
 * ## Which fixes it folds
 *
 * Only a session that is not recording (a recording is the authority then).
 * It starts on the first Free Ride fix; a session that has ridden Free Ride
 * keeps folding through its guided legs (an opportunity excursion, a return
 * home), so their riding still counts when the rider is back in Free Ride. A
 * ride that was only ever guided never gets a state and never writes one.
 */

import {
  createRecordingTelemetry,
  suspendRecordingTelemetry,
  type RecordingTelemetry,
  type RecordingTelemetryAccumulator,
  type RecordingTelemetryState,
} from "@/domain/recording/telemetry";
import type { RecordingPosition } from "@/domain/recording/types";
import type { PositionFix, RideSessionState } from "@/domain/ride-session/types";

/** Where the state lives between page loads. Implementations never throw. */
export interface FreeRideTelemetryStoragePort {
  /** The stored state for this session; `null` when absent, for another session, corrupt or unreadable. */
  read(sessionId: string): RecordingTelemetryState | null;
  /** `false` when the store refused the write (unavailable, full). */
  write(sessionId: string, state: RecordingTelemetryState): boolean;
  clear(): void;
}

/** At most one throttled write this often while fixes arrive. */
export const FREE_RIDE_TELEMETRY_WRITE_INTERVAL_MS = 5_000;

/**
 * A session fix as the telemetry fold reads it: the raw device values only. A
 * speed the pipeline derived is recomputed by the fold's own filter, never
 * taken as if the device said it. The recording stores exactly this shape.
 */
export function recordingPositionFromFix(fix: PositionFix, pausedDurationMs: number): RecordingPosition {
  return {
    coordinate: fix.coordinate,
    observedAt: fix.observedAt,
    accuracyMeters: fix.accuracyMeters,
    pausedDurationMs,
    ...(fix.speedMps === null || fix.speedDerived === true ? {} : { speedMps: fix.speedMps }),
    ...(fix.altitudeMeters === undefined || fix.altitudeMeters === null ? {} : { altitudeMeters: fix.altitudeMeters }),
    ...(fix.altitudeAccuracyMeters === undefined || fix.altitudeAccuracyMeters === null
      ? {}
      : { altitudeAccuracyMeters: fix.altitudeAccuracyMeters }),
  };
}

export interface FreeRideTelemetry {
  /** Folds one applied session fix, when this session is one it follows. */
  accept(fix: PositionFix, state: RideSessionState): void;
  /**
   * The live telemetry for this session, restored from storage on first ask;
   * `null` when the session records (the recording is the source) or never rode Free Ride.
   */
  snapshot(state: Pick<RideSessionState, "sessionId" | "activity" | "resumeActivity" | "recordingId">): RecordingTelemetry | null;
  /** Writes any unsaved state now (pause, stop, the page hiding). */
  flush(): void;
  /** The ride ended: forget the state here and in storage. */
  end(): void;
}

export interface FreeRideTelemetryOptions {
  readonly storage?: FreeRideTelemetryStoragePort | null;
  readonly nowMs?: () => number;
  readonly writeIntervalMs?: number;
}

interface Loaded {
  readonly sessionId: string;
  accumulator: RecordingTelemetryAccumulator | null;
  dirty: boolean;
  lastWriteAtMs: number;
}

export function createFreeRideTelemetry(options: FreeRideTelemetryOptions = {}): FreeRideTelemetry {
  const storage = options.storage ?? null;
  const nowMs = options.nowMs ?? Date.now;
  const writeIntervalMs = options.writeIntervalMs ?? FREE_RIDE_TELEMETRY_WRITE_INTERVAL_MS;
  let persistent = storage !== null;
  let loaded: Loaded | null = null;

  function read(sessionId: string): RecordingTelemetryState | null {
    if (!persistent || storage === null) return null;
    try {
      return storage.read(sessionId);
    } catch {
      persistent = false;
      return null;
    }
  }

  function write(): void {
    if (loaded === null || loaded.accumulator === null || !loaded.dirty) return;
    loaded.dirty = false;
    loaded.lastWriteAtMs = nowMs();
    if (!persistent || storage === null) return;
    let ok: boolean;
    try {
      ok = storage.write(loaded.sessionId, loaded.accumulator.state());
    } catch {
      ok = false;
    }
    // Live-only from here on for this page: a failing store is not retried per fix.
    if (!ok) persistent = false;
  }

  /** The session's fold, loading (and suspending) a stored one the first time this page sees the session. */
  function load(sessionId: string): Loaded {
    if (loaded?.sessionId === sessionId) return loaded;
    const stored = read(sessionId);
    loaded = {
      sessionId,
      accumulator: stored === null ? null : createRecordingTelemetry(suspendRecordingTelemetry(stored)),
      dirty: false,
      lastWriteAtMs: Number.NEGATIVE_INFINITY,
    };
    return loaded;
  }

  function freeRide(state: Pick<RideSessionState, "activity" | "resumeActivity">): boolean {
    return state.activity === "free" || (state.activity === "paused" && state.resumeActivity === "free");
  }

  return {
    accept(fix, state) {
      if (state.recordingId !== null || state.activity === "completed") return;
      const entry = load(state.sessionId);
      if (entry.accumulator === null) {
        if (!freeRide(state)) return;
        entry.accumulator = createRecordingTelemetry();
      }
      entry.accumulator.add(recordingPositionFromFix(fix, state.pausedDurationMs));
      entry.dirty = true;
      if (nowMs() - entry.lastWriteAtMs >= writeIntervalMs) write();
    },

    snapshot(state) {
      if (state.recordingId !== null) return null;
      const entry = load(state.sessionId);
      if (entry.accumulator === null) {
        // A Free Ride before its first fix: an empty fold, so the strip waits rather than hides.
        if (!freeRide(state)) return null;
        entry.accumulator = createRecordingTelemetry();
      }
      return entry.accumulator.snapshot();
    },

    flush() {
      write();
    },

    end() {
      loaded = null;
      if (storage === null) return;
      try {
        storage.clear();
      } catch {
        // Nothing to do: the next ride's session id never matches a leftover state.
      }
    },
  };
}
