/** IndexedDB adapter for local-only, append-only recording batches. */

import {
  RECORDING_BATCH_POINT_LIMIT,
  type RecordingRepositoryPort,
  type RecordingScanResult,
  type RecordingSealResult,
  type RecordingTailIssue,
  type RecordingTrace,
  type RecordingWriteResult,
} from "@/application/persistence/recording-repository";
import type { RecordingId } from "@/domain/recording/ids";
import {
  isRecordingPosition,
  isRecordingSummary,
  type RecordingPosition,
  type RecordingSummary,
} from "@/domain/recording/types";
import {
  type RecordingTraceRow,
  type StoredRecordingBatchRow,
  VNextDatabase,
  vnextDatabase,
} from "./db";

export interface RecordingRepositoryOptions {
  readonly database?: VNextDatabase;
  readonly databaseName?: string;
}

export function recordingBatchId(recordingId: RecordingId, batchSeq: number): string {
  return `${recordingId}#${String(batchSeq).padStart(8, "0")}`;
}

function isRecordingId(value: unknown): value is RecordingId {
  return typeof value === "string" && value.startsWith("rec_") && value.length > 4;
}

function isQuotaError(error: unknown): boolean {
  if (error instanceof Error && error.name === "QuotaExceededError") return true;
  if (typeof error !== "object" || error === null) return false;
  return (
    ("name" in error && error.name === "QuotaExceededError") ||
    ("code" in error && error.code === 22)
  );
}

function failed(error: unknown): Exclude<RecordingWriteResult, { readonly ok: true }> {
  return { ok: false, reason: isQuotaError(error) ? "quota" : "write-failed", error };
}

function readableTrace(value: RecordingTraceRow | undefined): RecordingTrace | null {
  if (
    value === undefined ||
    !isRecordingId(value.recordingId) ||
    (value.status !== "open" && value.status !== "sealed") ||
    !Number.isInteger(value.lastBatchSeq) ||
    value.lastBatchSeq < 0 ||
    !Number.isInteger(value.pointCount) ||
    value.pointCount < 0 ||
    (value.status === "open" && value.summary !== null) ||
    (value.status === "sealed" && !isRecordingSummary(value.summary))
  ) {
    return null;
  }
  return value;
}

class RecordingRepository implements RecordingRepositoryPort {
  constructor(readonly database: VNextDatabase) {}

  async create(recordingId: RecordingId): Promise<RecordingWriteResult> {
    if (!isRecordingId(recordingId)) {
      return { ok: false, reason: "invalid", message: "recording id must use rec_" };
    }
    try {
      await this.database.recordings.add({
        recordingId,
        status: "open",
        lastBatchSeq: 0,
        pointCount: 0,
        summary: null,
      });
      return { ok: true };
    } catch (error: unknown) {
      // Starting the same controller twice is idempotent while the trace exists.
      const existing = await this.database.recordings.get(recordingId);
      if (existing !== undefined) {
        return readableTrace(existing) === null
          ? { ok: false, reason: "corrupt", message: "recording lifecycle row is malformed" }
          : { ok: true };
      }
      return failed(error);
    }
  }

  async appendBatch(
    recordingId: RecordingId,
    points: readonly RecordingPosition[],
  ): Promise<RecordingWriteResult> {
    if (
      !isRecordingId(recordingId) ||
      points.length < 1 ||
      points.length > RECORDING_BATCH_POINT_LIMIT ||
      points.some((point) => !isRecordingPosition(point))
    ) {
      return { ok: false, reason: "invalid", message: "recording batch is malformed or unbounded" };
    }

    let refusal: RecordingWriteResult | null = null;
    try {
      await this.database.transaction(
        "rw",
        this.database.recordings,
        this.database.recordingBatches,
        async () => {
          const rawTrace = await this.database.recordings.get(recordingId);
          if (rawTrace === undefined) {
            refusal = { ok: false, reason: "not-found" };
            return;
          }
          const trace = readableTrace(rawTrace);
          if (trace === null) {
            refusal = { ok: false, reason: "corrupt" };
            return;
          }
          if (trace.status === "sealed") {
            refusal = { ok: false, reason: "sealed" };
            return;
          }
          const batchSeq = trace.lastBatchSeq + 1;
          const row: StoredRecordingBatchRow = {
            id: recordingBatchId(recordingId, batchSeq),
            recordingId,
            batchSeq,
            pointCount: points.length,
            points: [...points],
          };
          await this.database.recordingBatches.add(row);
          await this.database.recordings.put({
            ...trace,
            lastBatchSeq: batchSeq,
            pointCount: trace.pointCount + points.length,
          });
        },
      );
    } catch (error: unknown) {
      return failed(error);
    }
    return refusal ?? { ok: true };
  }

  async load(recordingId: RecordingId): Promise<RecordingTrace | null> {
    return readableTrace(await this.database.recordings.get(recordingId));
  }

  async scan(
    recordingId: RecordingId,
    visit: (points: readonly RecordingPosition[]) => void,
  ): Promise<RecordingScanResult> {
    let result: RecordingScanResult = { status: "absent" };
    await this.database.transaction(
      "r",
      this.database.recordings,
      this.database.recordingBatches,
      async () => {
        const rawTrace = await this.database.recordings.get(recordingId);
        if (rawTrace === undefined) return;
        const trace = readableTrace(rawTrace);
        if (trace === null) {
          result = { status: "corrupt", message: "the recording lifecycle row is malformed" };
          return;
        }

        let expectedSeq = 1;
        let readablePointCount = 0;
        let lastObservedMs: number | null = null;
        let tail: RecordingTailIssue | null = null;

        await this.database.recordingBatches
          .where("recordingId")
          .equals(recordingId)
          .each((row) => {
            if (tail !== null) {
              return;
            }
            if (row.batchSeq > trace.lastBatchSeq) {
              tail = {
                batchSeq: row.batchSeq,
                reason: "corrupt-batch",
                droppedPointCount:
                  Number.isInteger(row.pointCount) && row.pointCount >= 0 ? row.pointCount : null,
                message: `batch ${row.batchSeq} is beyond the committed trace boundary`,
              };
              return;
            }
            if (row.batchSeq !== expectedSeq) {
              tail = {
                batchSeq: expectedSeq,
                reason: "missing-batch",
                droppedPointCount: null,
                message: `expected batch ${expectedSeq}, found ${String(row.batchSeq)}`,
              };
              return;
            }
            expectedSeq += 1;

            if (
              !Array.isArray(row.points) ||
              !Number.isInteger(row.pointCount) ||
              row.pointCount < 1 ||
              row.pointCount > RECORDING_BATCH_POINT_LIMIT ||
              row.points.length > RECORDING_BATCH_POINT_LIMIT
            ) {
              tail = {
                batchSeq: row.batchSeq,
                reason: "corrupt-batch",
                droppedPointCount:
                  Number.isInteger(row.pointCount) && row.pointCount >= 0 ? row.pointCount : null,
                message: `batch ${row.batchSeq} has no readable point payload`,
              };
              return;
            }

            const prefix: RecordingPosition[] = [];
            for (const candidate of row.points) {
              if (!isRecordingPosition(candidate)) {
                tail = {
                  batchSeq: row.batchSeq,
                  reason: "corrupt-batch",
                  droppedPointCount: Math.max(0, row.pointCount - prefix.length),
                  message: `batch ${row.batchSeq} contains a malformed point`,
                };
                break;
              }
              const observedMs = Date.parse(candidate.observedAt);
              if (lastObservedMs !== null && observedMs < lastObservedMs) {
                tail = {
                  batchSeq: row.batchSeq,
                  reason: "timestamp-regression",
                  droppedPointCount: Math.max(0, row.pointCount - prefix.length),
                  message: `batch ${row.batchSeq} moves recording time backwards`,
                };
                break;
              }
              prefix.push(candidate);
              lastObservedMs = observedMs;
            }
            if (prefix.length > 0) {
              visit(prefix);
              readablePointCount += prefix.length;
            }
            if (tail === null && prefix.length !== row.pointCount) {
              tail = {
                batchSeq: row.batchSeq,
                reason: "partial-batch",
                droppedPointCount: Math.max(0, row.pointCount - prefix.length),
                message: `batch ${row.batchSeq} contains ${prefix.length} of ${row.pointCount} points`,
              };
            }
          });

        if (tail === null && expectedSeq <= trace.lastBatchSeq) {
          tail = {
            batchSeq: expectedSeq,
            reason: "missing-batch",
            droppedPointCount: Math.max(0, trace.pointCount - readablePointCount),
            message: `batch ${expectedSeq} is missing from the durable trace`,
          };
        }
        if (tail === null && readablePointCount !== trace.pointCount) {
          tail = {
            batchSeq: Math.max(1, trace.lastBatchSeq),
            reason: "corrupt-batch",
            droppedPointCount: Math.max(0, trace.pointCount - readablePointCount),
            message: "the recording point count does not match its durable batches",
          };
        }
        if (tail !== null && trace.pointCount > readablePointCount) {
          tail = {
            ...tail,
            droppedPointCount: trace.pointCount - readablePointCount,
          };
        }
        result = {
          status: tail === null ? "complete" : "partial",
          trace,
          readablePointCount,
          tail,
        };
      },
    );
    return result;
  }

  async seal(
    recordingId: RecordingId,
    summary: RecordingSummary,
  ): Promise<RecordingSealResult> {
    if (!isRecordingSummary(summary)) {
      return { ok: false, reason: "invalid", message: "recording summary is malformed" };
    }
    let result: RecordingSealResult | null = null;
    try {
      await this.database.transaction("rw", this.database.recordings, async () => {
        const rawTrace = await this.database.recordings.get(recordingId);
        if (rawTrace === undefined) {
          result = { ok: false, reason: "not-found" };
          return;
        }
        const trace = readableTrace(rawTrace);
        if (trace === null) {
          result = { ok: false, reason: "corrupt" };
          return;
        }
        if (trace.status === "sealed") {
          result = { ok: true, summary: trace.summary as RecordingSummary };
          return;
        }
        if (trace.pointCount !== summary.pointCount) {
          result = {
            ok: false,
            reason: "invalid",
            message: "summary point count does not match the durable trace",
          };
          return;
        }
        await this.database.recordings.put({ ...trace, status: "sealed", summary });
        result = { ok: true, summary };
      });
    } catch (error: unknown) {
      return failed(error);
    }
    return result ?? { ok: false, reason: "write-failed" };
  }

  async delete(recordingId: RecordingId): Promise<RecordingWriteResult> {
    try {
      await this.database.transaction(
        "rw",
        this.database.recordings,
        this.database.recordingBatches,
        async () => {
          await this.database.recordingBatches
            .where("recordingId")
            .equals(recordingId)
            .delete();
          await this.database.recordings.delete(recordingId);
        },
      );
      return { ok: true };
    } catch (error: unknown) {
      return failed(error);
    }
  }
}

export function createRecordingRepository(
  options: RecordingRepositoryOptions = {},
): RecordingRepositoryPort & { readonly database: VNextDatabase } {
  const database =
    options.database ??
    (options.databaseName === undefined ? vnextDatabase() : new VNextDatabase(options.databaseName));
  return new RecordingRepository(database);
}
