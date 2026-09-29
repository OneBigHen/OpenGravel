import type { RecordingId } from "@/domain/recording/ids";
import type { RecordingPosition, RecordingSummary } from "@/domain/recording/types";

/** Sixteen samples keep each IndexedDB value small while amortizing 1 Hz GPS writes. */
export const RECORDING_BATCH_POINT_LIMIT = 16;

/** A sparse stream still becomes durable within ten seconds while the page runs. */
export const RECORDING_BATCH_MAX_AGE_MS = 10_000;

export type RecordingWriteResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason:
        | "invalid"
        | "not-found"
        | "sealed"
        | "quota"
        | "corrupt"
        | "write-failed";
      readonly error?: unknown;
      readonly message?: string;
    };

export type RecordingSealResult =
  | { readonly ok: true; readonly summary: RecordingSummary }
  | Exclude<RecordingWriteResult, { readonly ok: true }>;

export interface RecordingTrace {
  readonly recordingId: RecordingId;
  readonly status: "open" | "sealed";
  readonly lastBatchSeq: number;
  readonly pointCount: number;
  readonly summary: RecordingSummary | null;
}

export type RecordingTailIssueReason =
  | "missing-batch"
  | "partial-batch"
  | "corrupt-batch"
  | "timestamp-regression";

export interface RecordingTailIssue {
  readonly batchSeq: number;
  readonly reason: RecordingTailIssueReason;
  readonly droppedPointCount: number | null;
  readonly message: string;
}

export type RecordingScanResult =
  | { readonly status: "absent" }
  | { readonly status: "corrupt"; readonly message: string }
  | {
      readonly status: "complete" | "partial";
      readonly trace: RecordingTrace;
      readonly readablePointCount: number;
      readonly tail: RecordingTailIssue | null;
    };

export interface RecordingRepositoryPort {
  create(recordingId: RecordingId): Promise<RecordingWriteResult>;
  appendBatch(
    recordingId: RecordingId,
    points: readonly RecordingPosition[],
  ): Promise<RecordingWriteResult>;
  load(recordingId: RecordingId): Promise<RecordingTrace | null>;
  /** Streams at most one bounded batch to the visitor at a time. */
  scan(
    recordingId: RecordingId,
    visit: (points: readonly RecordingPosition[]) => void,
  ): Promise<RecordingScanResult>;
  /** Seals once; subsequent calls return the already durable summary. */
  seal(recordingId: RecordingId, summary: RecordingSummary): Promise<RecordingSealResult>;
  /** Deletes lifecycle and every batch atomically; absence is idempotent success. */
  delete(recordingId: RecordingId): Promise<RecordingWriteResult>;
}
