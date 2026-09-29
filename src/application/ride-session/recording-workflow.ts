/** Recording lifecycle orchestration across RideSession, the trace store and My rides. */

import type { LibraryServicePort, SavedRecordedRide } from "@/application/library/library-service";
import type { RecordingRepositoryPort } from "@/application/persistence/recording-repository";
import type { RideFocusPointerPort } from "@/application/persistence/ride-focus-pointer";
import type { RecordingId } from "@/domain/recording/ids";
import { newRecordingId } from "@/domain/recording/ids";
import type { RecordingPosition, RecordingSummary } from "@/domain/recording/types";
import type { RideId } from "@/domain/ride/ids";
import type { Coordinate } from "@/domain/ride/types";
import {
  sessionAbandonedEvent,
  sessionCompletedEvent,
  sessionPausedEvent,
} from "@/domain/ride-session/create";
import type { RideSessionController } from "./ride-session-controller";
import {
  createRecordingController,
  type RecordingAppendResult,
  type RecordingController,
  type RecordingControllerSnapshot,
  type RecordingDiscardResult,
  type RecordingFinishResult,
  type RecordingRecoveryReport,
  type RecordingStartResult,
} from "./recording-controller";

export type RecordingRecoveryOutcome =
  | { readonly status: "recording"; readonly report: RecordingRecoveryReport }
  | { readonly status: "already-saved"; readonly ride: SavedRecordedRide }
  | { readonly status: "absent" }
  | { readonly status: "failed"; readonly message: string };

export type RecordingWorkflowFinishOutcome =
  | {
      readonly outcome: "finished";
      readonly ride: SavedRecordedRide;
      readonly summary: RecordingSummary;
    }
  | {
      readonly outcome: "saved-pending-cleanup" | "saved-pending-session";
      readonly ride: SavedRecordedRide;
      readonly summary: RecordingSummary;
      readonly message: string;
    }
  | { readonly outcome: "failed"; readonly message: string };

export interface RideRecordingWorkflowSnapshot extends RecordingControllerSnapshot {
  readonly libraryCommitted: boolean;
  readonly sourceDeleted: boolean;
}

export interface RideRecordingWorkflow {
  snapshot(): RideRecordingWorkflowSnapshot | null;
  start(rideId: RideId, rideRevision: number, at: string): Promise<RecordingStartResult>;
  recover(recordingId: RecordingId): Promise<RecordingRecoveryOutcome>;
  append(position: RecordingPosition): Promise<RecordingAppendResult>;
  retry(): Promise<RecordingAppendResult>;
  finish(at: string): Promise<RecordingWorkflowFinishOutcome>;
  discard(at: string): Promise<RecordingDiscardResult>;
}

export interface RideRecordingWorkflowOptions {
  readonly session: RideSessionController;
  readonly pointer: RideFocusPointerPort;
  readonly recordings: RecordingRepositoryPort;
  readonly library: Pick<LibraryServicePort, "saveRecorded" | "findRecorded">;
  readonly now?: () => string;
}

export function createRideRecordingWorkflow(
  options: RideRecordingWorkflowOptions,
): RideRecordingWorkflow {
  const now = options.now ?? (() => new Date().toISOString());
  let recording: RecordingController | null = null;
  let recordingId: RecordingId | null = null;
  let libraryCommitted = false;
  let sourceDeleted = false;
  let savedRide: SavedRecordedRide | null = null;
  let savedSummary: RecordingSummary | null = null;

  function controllerFor(id: RecordingId): RecordingController {
    return createRecordingController({
      recordingId: id,
      repository: options.recordings,
      session: options.session,
      now,
    });
  }

  /**
   * A terminal/recovery write can happen after asynchronous trace I/O. GPS may
   * advance the RideSession while that I/O is in flight, so the timestamp the
   * rider supplied when they tapped Finish can be older than state.updatedAt by
   * the time we close the session. Keep the reducer's monotonic-time invariant:
   * prefer the current clock when it is newest, otherwise clamp to the latest
   * durable session instant.
   */
  function sessionInstantAtOrAfter(stateUpdatedAt: string, requestedAt: string): string {
    const current = now();
    const stateMs = Date.parse(stateUpdatedAt);
    const requestedMs = Date.parse(requestedAt);
    const currentMs = Date.parse(current);
    if (
      Number.isFinite(currentMs) &&
      currentMs >= stateMs &&
      (!Number.isFinite(requestedMs) || currentMs >= requestedMs)
    ) {
      return current;
    }
    if (Number.isFinite(requestedMs) && requestedMs >= stateMs) return requestedAt;
    return stateUpdatedAt;
  }

  async function closeSession(at: string): Promise<boolean> {
    const state = options.session.snapshot();
    if (state === null) return false;
    if (state.activity === "completed") {
      options.pointer.clear();
      return true;
    }
    const completed = await options.session.dispatch(
      sessionCompletedEvent(sessionInstantAtOrAfter(state.updatedAt, at)),
    );
    if (completed.outcome !== "applied" || completed.persistence !== "durable") return false;
    options.pointer.clear();
    return true;
  }

  async function pauseForRecovery(at: string): Promise<void> {
    const state = options.session.snapshot();
    if (state === null || state.activity === "paused" || state.activity === "completed") return;
    await options.session.dispatch(
      sessionPausedEvent(sessionInstantAtOrAfter(state.updatedAt, at), "interruption"),
    );
  }

  return {
    snapshot(): RideRecordingWorkflowSnapshot | null {
      const snapshot = recording?.snapshot();
      return snapshot === undefined
        ? null
        : { ...snapshot, libraryCommitted, sourceDeleted };
    },

    async start(rideId, rideRevision, at): Promise<RecordingStartResult> {
      const pointed = options.pointer.read();
      if (pointed.status !== "absent") {
        return { outcome: "failed", reason: "write-failed" };
      }
      const id = newRecordingId();
      const nextRecording = controllerFor(id);
      const created = await nextRecording.start();
      if (created.outcome !== "started") return created;
      const started = await options.session.start({
        activity: "free",
        suggestions: "off",
        rideId,
        rideRevision,
        itinerary: [],
        recordingId: id,
        at,
      });
      if (
        started.outcome !== "applied" ||
        started.state === null ||
        started.persistence !== "durable"
      ) {
        await options.recordings.delete(id);
        return { outcome: "failed", reason: "write-failed" };
      }
      recording = nextRecording;
      recordingId = id;
      libraryCommitted = false;
      sourceDeleted = false;
      savedRide = null;
      savedSummary = null;
      options.pointer.write({
        sessionId: started.state.sessionId,
        rideId,
        routeGeometryRef: null,
        updatedAt: at,
      });
      return { outcome: "started" };
    },

    async recover(id): Promise<RecordingRecoveryOutcome> {
      recordingId = id;
      recording = controllerFor(id);
      const report = await recording.recover();
      let saved: SavedRecordedRide | null = null;
      if (report.status === "absent" || report.status === "sealed") {
        try {
          saved = await options.library.findRecorded(id);
        } catch {
          return { status: "failed", message: "The library could not be checked while recovering this recording." };
        }
      }
      libraryCommitted = saved !== null;
      savedRide = saved;
      savedSummary = saved?.summary ?? (report.status === "sealed" ? report.summary : null);
      sourceDeleted = report.status === "absent" && saved !== null;
      if (report.status !== "absent") return { status: "recording", report };
      if (saved === null) {
        recording = null;
        recordingId = null;
        libraryCommitted = false;
        sourceDeleted = false;
        return { status: "absent" };
      }
      const completed = await closeSession(now());
      return completed
        ? { status: "already-saved", ride: saved }
        : { status: "failed", message: "The saved ride was found, but the active session could not be closed." };
    },

    async append(position): Promise<RecordingAppendResult> {
      if (recording === null || recordingId === null) {
        return { outcome: "rejected", reason: "not-open" };
      }
      return recording.append(position);
    },

    async retry(): Promise<RecordingAppendResult> {
      if (recording === null) return { outcome: "rejected", reason: "not-open" };
      return recording.retry();
    },

    async finish(at): Promise<RecordingWorkflowFinishOutcome> {
      if (recording === null || recordingId === null) {
        return { outcome: "failed", message: "The recording is not available to finish." };
      }
      if (libraryCommitted && sourceDeleted && savedRide !== null && savedSummary !== null) {
        if (await closeSession(at)) {
          return { outcome: "finished", ride: savedRide, summary: savedSummary };
        }
        return {
          outcome: "saved-pending-session",
          ride: savedRide,
          summary: savedSummary,
          message: "Saved to My rides. Reopen Ride Focus to finish session recovery.",
        };
      }
      if (!libraryCommitted && recording.snapshot().summary.pointCount < 2) {
        return {
          outcome: "failed",
          message: "A recorded track needs at least two GPS fixes. Resume and wait for another fix, or discard this recording.",
        };
      }
      const sealed = await recording.finish();
      if (sealed.outcome !== "finished") {
        return { outcome: "failed", message: finishFailure(sealed) };
      }
      const coordinates: Coordinate[] = [];
      const timestamps: string[] = [];
      const scanned = await options.recordings.scan(recordingId, (batch) => {
        for (const point of batch) {
          coordinates.push(point.coordinate);
          timestamps.push(point.observedAt);
        }
      });
      if (scanned.status !== "complete" || scanned.trace.status !== "sealed") {
        return { outcome: "failed", message: "The recorded trace has an unreadable section and remains available for recovery." };
      }
      let ride: SavedRecordedRide;
      try {
        ride = await options.library.saveRecorded({
          recordingId,
          coordinates,
          timestamps,
          summary: sealed.summary,
        });
      } catch {
        await pauseForRecovery(at);
        return { outcome: "failed", message: "The trace is sealed, but it could not be saved to My rides. Retry to keep the trace." };
      }
      libraryCommitted = true;
      savedRide = ride;
      savedSummary = sealed.summary;

      const removed = await options.recordings.delete(recordingId);
      if (!removed.ok) {
        await pauseForRecovery(at);
        return {
          outcome: "saved-pending-cleanup",
          ride,
          summary: sealed.summary,
          message: "Saved to My rides. The source trace is still stored; finish again to retry cleanup.",
        };
      }
      sourceDeleted = true;
      if (!(await closeSession(at))) {
        return {
          outcome: "saved-pending-session",
          ride,
          summary: sealed.summary,
          message: "Saved to My rides. Ride Focus will finish recovery when you reopen it.",
        };
      }
      return { outcome: "finished", ride, summary: sealed.summary };
    },

    async discard(at): Promise<RecordingDiscardResult> {
      if (recording === null || recordingId === null) {
        return { outcome: "failed", reason: "session-mismatch" };
      }
      if (libraryCommitted) return { outcome: "failed", reason: "session-mismatch" };
      const discarded = await recording.discard(at);
      if (discarded.outcome !== "discarded") return discarded;
      const state = options.session.snapshot();
      if (state === null || state.activity === "completed") {
        return { outcome: "failed", reason: "session-mismatch" };
      }
      const abandoned = await options.session.dispatch(sessionAbandonedEvent(at));
      if (abandoned.outcome !== "applied" || abandoned.persistence !== "durable") {
        return { outcome: "failed", reason: "session-write-failed" };
      }
      options.pointer.clear();
      return { outcome: "discarded" };
    },
  };
}

function finishFailure(result: RecordingFinishResult): string {
  if (result.outcome === "finished") return "";
  return result.reason === "not-open"
    ? "The recording is not open. Reopen Ride Focus to recover it."
    : result.reason === "corrupt"
      ? "The trace is incomplete or corrupt, so it remains available for recovery."
      : "The trace could not be sealed. Check device storage and retry.";
}
