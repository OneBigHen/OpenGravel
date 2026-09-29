import {
  RECORDING_BATCH_MAX_AGE_MS,
  RECORDING_BATCH_POINT_LIMIT,
  type RecordingRepositoryPort,
  type RecordingTailIssue,
} from "@/application/persistence/recording-repository";
import type { RecordingId } from "@/domain/recording/ids";
import { recordingDiscardedEvent } from "@/domain/ride-session/create";
import type { RideSessionController } from "./ride-session-controller";
import {
  isRecordingPosition,
  type RecordingPosition,
  type RecordingSummary,
} from "@/domain/recording/types";
import {
  createRecordingTelemetry,
  type RecordingTelemetry,
  type RecordingTelemetryAccumulator,
} from "@/domain/recording/telemetry";

export { RECORDING_BATCH_MAX_AGE_MS, RECORDING_BATCH_POINT_LIMIT };

export interface RecordingControllerOptions {
  readonly recordingId: RecordingId;
  readonly repository: RecordingRepositoryPort;
  readonly schedule?: (work: () => void, delayMs: number) => unknown;
  readonly cancelScheduled?: (handle: unknown) => void;
  readonly session?: Pick<RideSessionController, "snapshot" | "dispatch">;
  readonly now?: () => string;
}

export type RecordingAppendResult =
  | { readonly outcome: "accepted" }
  | {
      readonly outcome: "rejected";
      readonly reason: "invalid" | "not-open" | "storage-full";
    }
  | {
      readonly outcome: "failed";
      readonly reason: "quota" | "corrupt" | "write-failed";
      readonly unsavedPointCount?: number;
    };

export interface RecordingControllerSnapshot {
  readonly status:
    | "idle"
    | "open"
    | "storage-full"
    | "storage-failed"
    | "corrupt"
    | "sealed"
    | "discarded";
  readonly bufferedPointCount: number;
  readonly summary: RecordingSummary;
  /**
   * The filtered live telemetry over the same points (RIDE-INSTRUMENT-STRIP
   * §6): moving time, moving average, max speed, elevation. Derived, never
   * persisted, so the sealed summary and its trace comparison are unchanged.
   */
  readonly telemetry: RecordingTelemetry;
}

export interface RecordingController {
  start(): Promise<RecordingStartResult>;
  append(position: RecordingPosition): Promise<RecordingAppendResult>;
  snapshot(): RecordingControllerSnapshot;
  /** Streams the readable prefix in bounded batches for the future 8.5 projection. */
  recover(visit?: (points: readonly RecordingPosition[]) => void): Promise<RecordingRecoveryReport>;
  finish(): Promise<RecordingFinishResult>;
  discard(at?: string): Promise<RecordingDiscardResult>;
  /** Retries only the retained bounded tail after storage becomes writable. */
  retry(): Promise<RecordingAppendResult>;
  flush(): Promise<void>;
}

export type RecordingStartResult =
  | { readonly outcome: "started" }
  | {
      readonly outcome: "failed";
      readonly reason: "quota" | "corrupt" | "write-failed";
    };

export type RecordingRecoveryReport =
  | { readonly status: "absent" }
  | { readonly status: "corrupt"; readonly message: string }
  | {
      readonly status: "open" | "sealed" | "partial";
      readonly summary: RecordingSummary;
      readonly tail: RecordingTailIssue | null;
    };

export type RecordingFinishResult =
  | { readonly outcome: "finished"; readonly summary: RecordingSummary }
  | {
      readonly outcome: "failed";
      readonly reason: "quota" | "corrupt" | "write-failed" | "not-open";
      readonly tail?: RecordingTailIssue | null;
    };

export type RecordingDiscardResult =
  | { readonly outcome: "discarded" }
  | {
      readonly outcome: "failed";
      readonly reason: "session-mismatch" | "session-write-failed" | "trace-delete-failed";
    };

const EARTH_RADIUS_METERS = 6_371_000;

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

function segmentMeters(from: RecordingPosition, to: RecordingPosition): number {
  const latitudeDelta = radians(to.coordinate.lat - from.coordinate.lat);
  const longitudeDelta = radians(to.coordinate.lon - from.coordinate.lon);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(from.coordinate.lat)) *
      Math.cos(radians(to.coordinate.lat)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
}

function summaryCollector(): {
  readonly visit: (points: readonly RecordingPosition[]) => void;
  readonly summary: () => RecordingSummary;
} {
  let first: RecordingPosition | null = null;
  let previous: RecordingPosition | null = null;
  let pointCount = 0;
  let distanceMeters = 0;
  let pausedDurationMs = 0;
  return {
    visit(points) {
      for (const point of points) {
        first ??= point;
        if (previous !== null) distanceMeters += segmentMeters(previous, point);
        if (previous !== null) {
          pausedDurationMs += Math.max(
            0,
            (point.pausedDurationMs ?? 0) - (previous.pausedDurationMs ?? 0),
          );
        }
        previous = point;
        pointCount += 1;
      }
    },
    summary() {
      return {
        distanceMeters: Math.round(distanceMeters),
        elapsedSeconds:
          first === null || previous === null
            ? 0
            : Math.floor(
                Math.max(0, Date.parse(previous.observedAt) - Date.parse(first.observedAt)) / 1_000,
              ),
        movingSeconds:
          first === null || previous === null
            ? 0
            : Math.max(
                0,
                Math.floor(
                  Math.max(0, Date.parse(previous.observedAt) - Date.parse(first.observedAt)) /
                    1_000,
                ) - Math.floor(pausedDurationMs / 1_000),
              ),
        pointCount,
      };
    },
  };
}

function summariesEqual(left: RecordingSummary | null, right: RecordingSummary): boolean {
  return (
    left !== null &&
    left.distanceMeters === right.distanceMeters &&
    left.elapsedSeconds === right.elapsedSeconds &&
    left.movingSeconds === right.movingSeconds &&
    left.pointCount === right.pointCount
  );
}

export function createRecordingController(
  options: RecordingControllerOptions,
): RecordingController {
  const { recordingId, repository } = options;
  const schedule =
    options.schedule ??
    ((work: () => void, delayMs: number): ReturnType<typeof setTimeout> =>
      setTimeout(work, delayMs));
  const cancelScheduled =
    options.cancelScheduled ??
    ((handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const session = options.session ?? null;
  const now = options.now ?? ((): string => new Date().toISOString());
  let status: RecordingControllerSnapshot["status"] = "idle";
  let buffer: RecordingPosition[] = [];
  let deadline: unknown | null = null;
  let referenceRemoved = false;
  let chain: Promise<unknown> = Promise.resolve();
  let collector = summaryCollector();
  let telemetry: RecordingTelemetryAccumulator = createRecordingTelemetry();

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = chain.then(work, work);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function drain(): Promise<RecordingAppendResult> {
    if (buffer.length === 0) return { outcome: "accepted" };
    const batch = buffer;
    const written = await repository.appendBatch(recordingId, batch);
    if (written.ok) {
      buffer = [];
      if (status === "storage-full" || status === "storage-failed") status = "open";
      if (deadline !== null) cancelScheduled(deadline);
      deadline = null;
      return { outcome: "accepted" };
    }
    if (written.reason === "quota") {
      status = "storage-full";
      if (deadline !== null) cancelScheduled(deadline);
      deadline = null;
      return { outcome: "failed", reason: "quota", unsavedPointCount: buffer.length };
    }
    status = written.reason === "corrupt" ? "corrupt" : "storage-failed";
    if (deadline !== null) cancelScheduled(deadline);
    deadline = null;
    return {
      outcome: "failed",
      reason: written.reason === "corrupt" ? "corrupt" : "write-failed",
      unsavedPointCount: buffer.length,
    };
  }

  return {
    async start() {
      const result = await enqueue(() => repository.create(recordingId));
      if (!result.ok) {
        status =
          result.reason === "quota"
            ? "storage-full"
            : result.reason === "corrupt"
              ? "corrupt"
              : "storage-failed";
        return {
          outcome: "failed" as const,
          reason:
            result.reason === "quota"
              ? "quota"
              : result.reason === "corrupt"
                ? "corrupt"
                : "write-failed",
        };
      }
      const trace = await repository.load(recordingId);
      if (trace === null) {
        status = "corrupt";
        return { outcome: "failed" as const, reason: "corrupt" as const };
      }
      status = trace.status;
      return { outcome: "started" as const };
    },

    append(position: RecordingPosition): Promise<RecordingAppendResult> {
      return enqueue(async () => {
        if (status === "storage-full") {
          return { outcome: "rejected", reason: "storage-full" };
        }
        if (status === "storage-failed" || status === "corrupt") {
          return { outcome: "rejected", reason: "not-open" };
        }
        if (status !== "open") return { outcome: "rejected", reason: "not-open" };
        if (!isRecordingPosition(position)) return { outcome: "rejected", reason: "invalid" };
        // Own the buffered value: a caller cannot mutate an accepted point
        // before its bounded batch reaches IndexedDB.
        const accepted: RecordingPosition = {
          coordinate: { ...position.coordinate },
          observedAt: position.observedAt,
          accuracyMeters: position.accuracyMeters,
          pausedDurationMs: position.pausedDurationMs ?? 0,
          ...(position.speedMps === undefined ? {} : { speedMps: position.speedMps }),
          ...(position.altitudeMeters === undefined ? {} : { altitudeMeters: position.altitudeMeters }),
          ...(position.altitudeAccuracyMeters === undefined
            ? {}
            : { altitudeAccuracyMeters: position.altitudeAccuracyMeters }),
        };
        buffer.push(accepted);
        collector.visit([accepted]);
        telemetry.add(accepted);
        if (buffer.length === 1) {
          deadline = schedule(() => {
            deadline = null;
            void enqueue(drain);
          }, RECORDING_BATCH_MAX_AGE_MS);
        }
        return buffer.length >= RECORDING_BATCH_POINT_LIMIT
          ? drain()
          : { outcome: "accepted" };
      });
    },

    snapshot() {
      return {
        status,
        bufferedPointCount: buffer.length,
        summary: collector.summary(),
        telemetry: telemetry.snapshot(),
      };
    },

    async recover(visit = () => undefined) {
      const recoveredCollector = summaryCollector();
      const recoveredTelemetry = createRecordingTelemetry();
      const scan = await repository.scan(recordingId, (points) => {
        recoveredCollector.visit(points);
        for (const point of points) recoveredTelemetry.add(point);
        visit(points);
      });
      if (scan.status === "absent") return scan;
      if (scan.status === "corrupt") {
        status = "corrupt";
        return scan;
      }
      collector = recoveredCollector;
      telemetry = recoveredTelemetry;
      const summary = collector.summary();
      if (scan.status === "partial") status = "corrupt";
      if (scan.trace.status === "sealed" && !summariesEqual(scan.trace.summary, summary)) {
        status = "corrupt";
        return { status: "corrupt" as const, message: "sealed summary does not match its trace" };
      }
      if (scan.status === "complete") status = scan.trace.status;
      return {
        status:
          scan.status === "partial"
            ? "partial"
            : scan.trace.status === "sealed"
              ? "sealed"
              : "open",
        summary,
        tail: scan.tail,
      };
    },

    finish(): Promise<RecordingFinishResult> {
      return enqueue(async () => {
        if (status === "idle") return { outcome: "failed", reason: "not-open" };
        if (status === "storage-full") return { outcome: "failed", reason: "quota" };
        if (status === "corrupt") return { outcome: "failed", reason: "corrupt" };
        const drained = await drain();
        if (drained.outcome === "failed") return drained;

        const completionCollector = summaryCollector();
        const scan = await repository.scan(recordingId, completionCollector.visit);
        if (scan.status === "absent") return { outcome: "failed", reason: "not-open" };
        if (scan.status === "corrupt" || scan.status === "partial") {
          status = "corrupt";
          return {
            outcome: "failed",
            reason: "corrupt",
            ...(scan.status === "partial" ? { tail: scan.tail } : {}),
          };
        }
        const summary = completionCollector.summary();
        if (scan.trace.status === "sealed" && !summariesEqual(scan.trace.summary, summary)) {
          status = "corrupt";
          return { outcome: "failed", reason: "corrupt" };
        }
        const sealed = await repository.seal(recordingId, summary);
        if (!sealed.ok) {
          return {
            outcome: "failed",
            reason: sealed.reason === "quota" ? "quota" : "write-failed",
          };
        }
        status = "sealed";
        collector = completionCollector;
        return { outcome: "finished", summary: sealed.summary };
      });
    },

    discard(at?: string): Promise<RecordingDiscardResult> {
      return enqueue(async () => {
        if (status === "discarded") return { outcome: "discarded" };
        if (!referenceRemoved) {
          if (session === null) {
            return { outcome: "failed", reason: "session-mismatch" };
          }
          const sessionState = session.snapshot();
          if (
            sessionState === null ||
            (sessionState.recordingId !== recordingId && sessionState.recordingId !== null)
          ) {
            return { outcome: "failed", reason: "session-mismatch" };
          }
          if (sessionState.recordingId === recordingId) {
            const removal = await session.dispatch(recordingDiscardedEvent(at ?? now()));
            if (removal.outcome !== "applied" || removal.persistence !== "durable") {
              return { outcome: "failed", reason: "session-write-failed" };
            }
          }
          referenceRemoved = true;
        }
        const deleted = await repository.delete(recordingId);
        if (!deleted.ok) return { outcome: "failed", reason: "trace-delete-failed" };
        if (deadline !== null) cancelScheduled(deadline);
        deadline = null;
        buffer = [];
        status = "discarded";
        return { outcome: "discarded" };
      });
    },

    retry(): Promise<RecordingAppendResult> {
      return enqueue(drain);
    },

    async flush() {
      await enqueue(async () => {
        await drain();
      });
    },
  };
}
