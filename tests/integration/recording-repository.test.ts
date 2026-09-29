/**
 * Recording durability and lifecycle (08 §11–§13; 11 §18–§19).
 *
 * These tests use the real Dexie schema through fake-indexeddb. The public
 * application controller is the behavioral seam; direct table reads only
 * prove the storage adapter's promised batch bound and orphan cleanup.
 */

import "fake-indexeddb/auto";

import { describe, expect, it, vi } from "vitest";

import {
  RECORDING_BATCH_POINT_LIMIT,
  RECORDING_BATCH_MAX_AGE_MS,
  createRecordingController,
} from "@/application/ride-session/recording-controller";
import { createRideRecordingWorkflow } from "@/application/ride-session/recording-workflow";
import type { RideFocusPointerPort, RideFocusPointer } from "@/application/persistence/ride-focus-pointer";
import { positionUpdatedEvent, sessionPausedEvent, sessionResumedEvent } from "@/domain/ride-session/create";
import {
  createRideSessionController,
  recordingDiscardedEvent,
} from "@/application/ride-session/ride-session-controller";
import { asRecordingId } from "@/domain/recording/ids";
import { newRideId } from "@/domain/ride/ids";
import { asRideSessionId } from "@/domain/ride-session/ids";
import { VNextDatabase } from "@/infrastructure/storage/db";
import {
  createRecordingRepository,
  recordingBatchId,
} from "@/infrastructure/storage/recording-repository";
import { createRideSessionRepository } from "@/infrastructure/storage/ride-session-repository";
import { createLibraryService } from "@/application/library/library-service";
import { createRideRepository } from "@/infrastructure/storage/ride-repository";
import { createIndexedDbGeometryStore } from "@/infrastructure/storage/indexeddb-geometry-store";

const NOW = "2026-09-21T12:00:00.000Z";

let sequence = 0;

function databaseName(): string {
  sequence += 1;
  return `opengravel-vnext-recording-${sequence}`;
}

function at(seconds: number): string {
  return new Date(Date.parse(NOW) + seconds * 1_000).toISOString();
}

function point(index: number, pausedDurationMs = 0) {
  return {
    coordinate: { lon: -76 + index * 0.0001, lat: 40 + index * 0.0001 },
    observedAt: at(index),
    accuracyMeters: 5,
    pausedDurationMs,
  } as const;
}

function pointer(): RideFocusPointerPort {
  let saved: Omit<RideFocusPointer, "version"> | null = null;
  return {
    read() {
      return saved === null
        ? { status: "absent" }
        : { status: "found", pointer: { version: 1, ...saved } };
    },
    write(value) {
      saved = value;
    },
    clear() {
      saved = null;
    },
  };
}

async function appendJournaledPoint(
  session: ReturnType<typeof createRideSessionController>,
  workflow: ReturnType<typeof createRideRecordingWorkflow>,
  seconds: number,
  pausedDurationMs: number,
): Promise<void> {
  const recorded = point(seconds, pausedDurationMs);
  const applied = await session.dispatch(positionUpdatedEvent({
    ...recorded,
    headingDegrees: 90,
    speedMps: 10,
  }, at(seconds)));
  if (applied.outcome !== "applied") throw new Error(applied.message);
  await workflow.append(recorded);
}

describe("recording bounded writes", () => {
  it("seals elapsed and moving time from session-journal pause totals at fixes", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRecordingRepository({ database });
    const controller = createRecordingController({
      recordingId: asRecordingId("rec_pause-summary"),
      repository,
    });
    await controller.start();
    await controller.append(point(0, 0));
    await controller.append(point(40, 30_000));
    await controller.append(point(60, 30_000));

    await expect(controller.finish()).resolves.toMatchObject({
      outcome: "finished",
      summary: { elapsedSeconds: 60, movingSeconds: 30, pointCount: 3 },
    });
  });

  it("writes one bounded batch when the point limit is reached", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRecordingRepository({ database });
    const recordingId = asRecordingId("rec_batch-bound");
    const controller = createRecordingController({ recordingId, repository });

    expect(RECORDING_BATCH_POINT_LIMIT).toBe(16);
    expect(await controller.start()).toEqual({ outcome: "started" });

    for (let index = 0; index < RECORDING_BATCH_POINT_LIMIT; index += 1) {
      expect((await controller.append(point(index))).outcome).toBe("accepted");
    }

    const rows = await database.recordingBatches.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.pointCount).toBe(RECORDING_BATCH_POINT_LIMIT);
    expect(rows[0]?.points).toHaveLength(RECORDING_BATCH_POINT_LIMIT);
    expect(controller.snapshot().bufferedPointCount).toBe(0);
  });

  it("flushes a sparse partial batch at the time bound", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRecordingRepository({ database });
    let deadline: (() => void) | null = null;
    const controller = createRecordingController({
      recordingId: asRecordingId("rec_time-bound"),
      repository,
      schedule: (work, delayMs) => {
        expect(delayMs).toBe(RECORDING_BATCH_MAX_AGE_MS);
        deadline = work;
        return 1;
      },
      cancelScheduled: () => undefined,
    });
    await controller.start();

    await controller.append(point(0));
    expect(controller.snapshot().bufferedPointCount).toBe(1);

    expect(deadline).not.toBeNull();
    (deadline as unknown as () => void)();
    await controller.flush();

    expect(await database.recordingBatches.count()).toBe(1);
    expect(controller.snapshot().bufferedPointCount).toBe(0);
  });

  it("keeps a long synthetic recording within the batch and memory bounds", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRecordingRepository({ database });
    const controller = createRecordingController({
      recordingId: asRecordingId("rec_long"),
      repository,
    });
    await controller.start();

    const pointCount = RECORDING_BATCH_POINT_LIMIT * 257 + 3;
    for (let index = 0; index < pointCount; index += 1) {
      await controller.append(point(index));
      expect(controller.snapshot().bufferedPointCount).toBeLessThan(RECORDING_BATCH_POINT_LIMIT);
    }
    const finished = await controller.finish();
    const rows = await database.recordingBatches.toArray();

    expect(finished).toMatchObject({ outcome: "finished", summary: { pointCount } });
    expect(rows.length).toBeGreaterThan(250);
    expect(Math.max(...rows.map((row) => row.pointCount))).toBe(RECORDING_BATCH_POINT_LIMIT);
    expect(rows.reduce((sum, row) => sum + row.pointCount, 0)).toBe(pointCount);
  }, 15_000);
});

describe("recording recovery", () => {
  it("restores the readable prefix and reports a crash-truncated batch tail", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRecordingRepository({ database });
    const recordingId = asRecordingId("rec_partial-tail");
    const controller = createRecordingController({ recordingId, repository });
    await controller.start();
    for (let index = 0; index < RECORDING_BATCH_POINT_LIMIT; index += 1) {
      await controller.append(point(index));
    }

    // The row envelope says four samples, but only two made it into the stored
    // payload. Recovery may use those two; it must name the two it cannot read.
    await database.recordingBatches.put({
      id: recordingBatchId(recordingId, 2),
      recordingId,
      batchSeq: 2,
      pointCount: 4,
      points: [point(16), point(17)],
    });
    await database.recordings.update(recordingId, {
      lastBatchSeq: 2,
      pointCount: RECORDING_BATCH_POINT_LIMIT + 4,
    });

    let readablePrefixPoints = 0;
    const recovered = await controller.recover((points) => {
      readablePrefixPoints += points.length;
    });

    expect(recovered).toMatchObject({
      status: "partial",
      summary: { pointCount: RECORDING_BATCH_POINT_LIMIT + 2 },
      tail: {
        batchSeq: 2,
        reason: "partial-batch",
        droppedPointCount: 2,
      },
    });
    expect(readablePrefixPoints).toBe(RECORDING_BATCH_POINT_LIMIT + 2);
  });

  it("finishes idempotently and recovery reproduces the live summary", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRecordingRepository({ database });
    const recordingId = asRecordingId("rec_finish-once");
    const controller = createRecordingController({ recordingId, repository });
    await controller.start();
    for (let index = 0; index < 20; index += 1) await controller.append(point(index));

    const first = await controller.finish();
    const second = await controller.finish();
    const reloaded = createRecordingController({ recordingId, repository });
    const recovered = await reloaded.recover();

    expect(first).toMatchObject({
      outcome: "finished",
      summary: { pointCount: 20, elapsedSeconds: 19, movingSeconds: 19 },
    });
    expect(second).toEqual(first);
    expect(first.outcome === "finished" ? first.summary.distanceMeters : 0).toBeGreaterThan(0);
    expect(recovered).toEqual({
      status: "sealed",
      summary: first.outcome === "finished" ? first.summary : null,
      tail: null,
    });
    expect(await database.recordings.get(recordingId)).toMatchObject({
      status: "sealed",
      summary: first.outcome === "finished" ? first.summary : null,
    });
  });

  it("stores device speed and altitude on points, and recovery rebuilds the live telemetry", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRecordingRepository({ database });
    const recordingId = asRecordingId("rec_telemetry-recovery");
    const controller = createRecordingController({ recordingId, repository });
    await controller.start();
    // ~15.6 m per second along the diagonal, with a steady 20 m climb.
    for (let index = 0; index < 40; index += 1) {
      await controller.append({ ...point(index), speedMps: 15.6, altitudeMeters: 100 + index * 0.5, altitudeAccuracyMeters: 4 });
    }
    await controller.append(point(40)); // an older-shaped point with neither
    const live = controller.snapshot().telemetry;
    await controller.flush();

    expect(live.movement).toBe("moving");
    expect(live.movingMs).toBeGreaterThan(35_000);
    expect(live.maxSpeedMps).toBeCloseTo(15.6, 1);
    expect(live.elevation.gainMeters).toBeGreaterThan(10);

    const rows = await database.recordingBatches.toArray();
    const stored = rows.flatMap((row) => row.points ?? []);
    expect(stored[0]).toMatchObject({ speedMps: 15.6, altitudeMeters: 100, altitudeAccuracyMeters: 4 });
    expect(stored.at(-1)).not.toHaveProperty("speedMps");
    expect(stored.at(-1)).not.toHaveProperty("altitudeMeters");

    const reloaded = createRecordingController({ recordingId, repository });
    await reloaded.recover();
    expect(reloaded.snapshot().telemetry).toEqual(live);
  });

  it("reports a corrupt lifecycle row instead of treating it as absent", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRecordingRepository({ database });
    const recordingId = asRecordingId("rec_corrupt-header");
    await database.recordings.put({
      recordingId,
      status: "sealed",
      lastBatchSeq: 0,
      pointCount: 0,
      summary: null,
    } as never);
    const controller = createRecordingController({ recordingId, repository });

    await expect(controller.recover()).resolves.toEqual({
      status: "corrupt",
      message: "the recording lifecycle row is malformed",
    });
  });

  it("does not expose a batch beyond the lifecycle commit boundary", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRecordingRepository({ database });
    const recordingId = asRecordingId("rec_uncommitted-batch");
    const controller = createRecordingController({ recordingId, repository });
    await controller.start();
    for (let index = 0; index < RECORDING_BATCH_POINT_LIMIT; index += 1) {
      await controller.append(point(index));
    }

    // A batch row beyond the lifecycle header is not part of the committed
    // trace. Treat it as corrupt tail data instead of leaking it to a reader.
    await database.recordingBatches.put({
      id: recordingBatchId(recordingId, 2),
      recordingId,
      batchSeq: 2,
      pointCount: 1,
      points: [point(16)],
    });

    let visitedPointCount = 0;
    await expect(
      controller.recover((points) => {
        visitedPointCount += points.length;
      }),
    ).resolves.toMatchObject({
      status: "partial",
      summary: { pointCount: RECORDING_BATCH_POINT_LIMIT },
      tail: { batchSeq: 2, reason: "corrupt-batch", droppedPointCount: 1 },
    });
    expect(visitedPointCount).toBe(RECORDING_BATCH_POINT_LIMIT);
  });

  it("refuses to finish when a sealed summary disagrees with its trace", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRecordingRepository({ database });
    const recordingId = asRecordingId("rec_corrupt-summary");
    const controller = createRecordingController({ recordingId, repository });
    await controller.start();
    await controller.append(point(0));
    await controller.append(point(1));
    expect((await controller.finish()).outcome).toBe("finished");

    await database.recordings.update(recordingId, {
      summary: { distanceMeters: 0, elapsedSeconds: 0, movingSeconds: 0, pointCount: 2 },
    });
    const restarted = createRecordingController({ recordingId, repository });
    await restarted.start();

    await expect(restarted.finish()).resolves.toEqual({
      outcome: "failed",
      reason: "corrupt",
    });
    expect(restarted.snapshot().status).toBe("corrupt");
  });
});

describe("recording failures", () => {
  it("returns a typed quota failure and stops accepting an unbounded tail", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRecordingRepository({ database });
    const controller = createRecordingController({
      recordingId: asRecordingId("rec_quota"),
      repository,
    });
    await controller.start();
    const quota = new Error("storage full");
    Object.defineProperty(quota, "name", { value: "QuotaExceededError" });
    vi.spyOn(database.recordingBatches, "add").mockRejectedValueOnce(quota);

    let result = await controller.append(point(0));
    for (let index = 1; index < RECORDING_BATCH_POINT_LIMIT; index += 1) {
      result = await controller.append(point(index));
    }

    expect(result).toEqual({ outcome: "failed", reason: "quota", unsavedPointCount: 16 });
    expect(controller.snapshot()).toMatchObject({ status: "storage-full", bufferedPointCount: 16 });
    expect(await controller.append(point(17))).toEqual({
      outcome: "rejected",
      reason: "storage-full",
    });
    expect(controller.snapshot().bufferedPointCount).toBe(RECORDING_BATCH_POINT_LIMIT);

    expect(await controller.retry()).toEqual({ outcome: "accepted" });
    expect(controller.snapshot()).toMatchObject({ status: "open", bufferedPointCount: 0 });
    expect(await database.recordingBatches.count()).toBe(1);
  });

  it("returns a typed corrupt failure when the lifecycle row becomes unreadable", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRecordingRepository({ database });
    const recordingId = asRecordingId("rec_corrupt-write");
    const controller = createRecordingController({ recordingId, repository });
    await controller.start();
    await database.recordings.update(recordingId, { lastBatchSeq: -1 });

    let result = await controller.append(point(0));
    for (let index = 1; index < RECORDING_BATCH_POINT_LIMIT; index += 1) {
      result = await controller.append(point(index));
    }

    expect(result).toEqual({
      outcome: "failed",
      reason: "corrupt",
      unsavedPointCount: RECORDING_BATCH_POINT_LIMIT,
    });
    expect(controller.snapshot()).toMatchObject({
      status: "corrupt",
      bufferedPointCount: RECORDING_BATCH_POINT_LIMIT,
    });
  });
});

describe("recording to library crash windows", () => {
  async function setup(suffix: string, includePoints = true) {
    const name = `${databaseName()}-${suffix}`;
    const database = new VNextDatabase(name);
    const recordings = createRecordingRepository({ database });
    const session = createRideSessionController({ repository: createRideSessionRepository({ database }) });
    const focusPointer = pointer();
    const rides = createRideRepository({ database });
    const geometry = createIndexedDbGeometryStore({ databaseName: name });
    const library = createLibraryService(rides, { now: () => at(61), geometryStore: geometry });
    const workflow = createRideRecordingWorkflow({
      session,
      pointer: focusPointer,
      recordings,
      library,
      now: () => at(61),
    });
    const started = await workflow.start(newRideId(), 0, NOW);
    if (started.outcome !== "started") throw new Error("recording did not start");
    if (includePoints) {
      await appendJournaledPoint(session, workflow, 0, 0);
      await appendJournaledPoint(session, workflow, 10, 0);
      await session.dispatch(sessionPausedEvent(at(10), "rider"));
      await session.dispatch(sessionResumedEvent(at(40)));
      await appendJournaledPoint(session, workflow, 40, 30_000);
      await appendJournaledPoint(session, workflow, 60, 30_000);
    }
    return { database, recordings, session, focusPointer, library, workflow };
  }

  it("leaves a short trace open so the rider can collect a second fix", async () => {
    const state = await setup("minimum-points", false);

    await expect(state.workflow.finish(at(61))).resolves.toMatchObject({
      outcome: "failed",
      message: "A recorded track needs at least two GPS fixes. Resume and wait for another fix, or discard this recording.",
    });
    expect(state.workflow.snapshot()).toMatchObject({ status: "open", summary: { pointCount: 0 } });

    const recordingId = state.session.snapshot()?.recordingId;
    if (recordingId === undefined || recordingId === null) {
      throw new Error("recording id was not attached to RideSession");
    }
    expect(await state.recordings.load(recordingId)).toMatchObject({ status: "open" });
    await appendJournaledPoint(state.session, state.workflow, 0, 0);
    await appendJournaledPoint(state.session, state.workflow, 10, 0);
    await expect(state.workflow.finish(at(11))).resolves.toMatchObject({ outcome: "finished" });
  });

  it("finishes while paused with moving time bounded by the last fix", async () => {
    const state = await setup("finish-while-paused");
    await state.session.dispatch(sessionPausedEvent(at(60), "rider"));

    const finished = await state.workflow.finish(at(120));

    expect(finished).toMatchObject({
      outcome: "finished",
      summary: { elapsedSeconds: 60, movingSeconds: 30, pointCount: 4 },
    });
    // The active final pause is journaled through completion, but starts after
    // the last fix and therefore is outside the trace's first-to-last-fix span.
    expect(state.session.snapshot()).toMatchObject({
      activity: "completed",
      pausedDurationMs: 90_000,
      pausedAt: null,
    });
  });

  it("retains the sealed source when the library write fails, then retries without loss", async () => {
    const state = await setup("library-failure");
    expect(state.workflow.snapshot()?.summary.pointCount).toBe(4);
    const recordingId = state.session.snapshot()?.recordingId;
    const sessionId = state.session.snapshot()?.sessionId;
    if (recordingId === undefined || recordingId === null || sessionId === undefined) {
      throw new Error("recording identity was not attached to RideSession");
    }
    vi.spyOn(state.library, "saveRecorded")
      .mockRejectedValueOnce(new Error("simulated interrupted library write"));
    await expect(state.workflow.finish(at(61))).resolves.toMatchObject({ outcome: "failed" });
    expect(state.session.snapshot()?.activity).toBe("paused");
    expect(state.workflow.snapshot()).toMatchObject({ libraryCommitted: false, sourceDeleted: false });
    expect(await state.recordings.load(recordingId)).toMatchObject({
      status: "sealed",
      pointCount: 4,
      summary: { pointCount: 4 },
    });
    expect(await state.library.findRecorded(recordingId)).toBeNull();

    const recoveredSession = createRideSessionController({
      repository: createRideSessionRepository({ database: state.database }),
      now: () => at(62),
    });
    await recoveredSession.resume(sessionId);
    const retry = createRideRecordingWorkflow({
      session: recoveredSession,
      pointer: state.focusPointer,
      recordings: state.recordings,
      library: state.library,
      now: () => at(63),
    });
    expect((await retry.recover(recordingId)).status).toBe("recording");
    const retried = await retry.finish(at(63));
    if (retried.outcome === "failed") throw new Error(retried.message);
    expect(retried).toMatchObject({
      outcome: "finished",
      summary: { elapsedSeconds: 60, movingSeconds: 30, pointCount: 4 },
    });
    expect(await state.recordings.load(recordingId)).toBeNull();
    expect(await state.library.listRides({ type: "recorded" })).toHaveLength(1);
  });

  it("retries trace cleanup idempotently after the library commit", async () => {
    const state = await setup("trace-delete-failure");
    const recordingId = state.session.snapshot()?.recordingId;
    const sessionId = state.session.snapshot()?.sessionId;
    if (recordingId === undefined || recordingId === null || sessionId === undefined) {
      throw new Error("recording identity was not attached to RideSession");
    }
    const deleteTrace = vi.spyOn(state.recordings, "delete").mockResolvedValueOnce({
      ok: false,
      reason: "write-failed",
    });

    await expect(state.workflow.finish(at(61))).resolves.toMatchObject({
      outcome: "saved-pending-cleanup",
      summary: { elapsedSeconds: 60, movingSeconds: 30, pointCount: 4 },
    });
    expect(await state.library.listRides({ type: "recorded" })).toHaveLength(1);
    expect(state.session.snapshot()?.activity).toBe("paused");
    expect(state.workflow.snapshot()).toMatchObject({ libraryCommitted: true, sourceDeleted: false });

    const recoveredSession = createRideSessionController({ repository: createRideSessionRepository({ database: state.database }) });
    await recoveredSession.resume(sessionId);
    const retry = createRideRecordingWorkflow({
      session: recoveredSession,
      pointer: state.focusPointer,
      recordings: state.recordings,
      library: state.library,
      now: () => at(62),
    });
    expect((await retry.recover(recordingId)).status).toBe("recording");
    await expect(retry.finish(at(62))).resolves.toMatchObject({ outcome: "finished" });
    expect(deleteTrace).toHaveBeenCalledTimes(2);
    expect(await state.library.listRides({ type: "recorded" })).toHaveLength(1);
    expect(await state.recordings.load(recordingId)).toBeNull();
    expect(recoveredSession.snapshot()?.activity).toBe("completed");
  });
});

describe("recording discard", () => {
  it("removes every trace row and journals removal of the session reference", async () => {
    const database = new VNextDatabase(databaseName());
    const recordingRepository = createRecordingRepository({ database });
    const sessionRepository = createRideSessionRepository({ database });
    const recordingId = asRecordingId("rec_discard");
    const session = createRideSessionController({
      repository: sessionRepository,
      writerToken: "tab-a",
      now: () => at(30),
    });
    await session.start({
      activity: "free",
      rideId: newRideId(),
      rideRevision: 0,
      recordingId,
      sessionId: asRideSessionId("sess_recording-discard"),
      at: at(0),
    });
    const recording = createRecordingController({
      recordingId,
      repository: recordingRepository,
      session,
      now: () => at(30),
    });
    await recording.start();
    await recording.append(point(1));
    await recording.flush();

    expect(await recording.discard()).toEqual({ outcome: "discarded" });

    expect(session.snapshot()?.recordingId).toBeNull();
    expect(await database.recordings.get(recordingId)).toBeUndefined();
    expect(await database.recordingBatches.where("recordingId").equals(recordingId).count()).toBe(0);
    const loaded = await sessionRepository.loadSession(asRideSessionId("sess_recording-discard"));
    expect(loaded?.checkpoint?.state.recordingId).toBeNull();
  });

  it("finishes orphan cleanup after interruption follows durable reference removal", async () => {
    const database = new VNextDatabase(databaseName());
    const recordingRepository = createRecordingRepository({ database });
    const sessionRepository = createRideSessionRepository({ database });
    const recordingId = asRecordingId("rec_interrupted-discard");
    const session = createRideSessionController({
      repository: sessionRepository,
      writerToken: "tab-a",
      now: () => at(30),
    });
    await session.start({
      activity: "free",
      rideId: newRideId(),
      rideRevision: 0,
      recordingId,
      sessionId: asRideSessionId("sess_interrupted-discard"),
      at: at(0),
    });
    const recording = createRecordingController({
      recordingId,
      repository: recordingRepository,
      session,
      now: () => at(30),
    });
    await recording.start();
    await recording.append(point(1));
    await recording.flush();

    // Simulate a process death after the durable session event commits but
    // before the separate trace transaction can delete its rows.
    expect(await session.dispatch(recordingDiscardedEvent(at(30)))).toMatchObject({
      outcome: "applied",
      persistence: "durable",
    });
    expect(await database.recordings.get(recordingId)).toBeDefined();

    const restarted = createRecordingController({
      recordingId,
      repository: recordingRepository,
      session,
      now: () => at(31),
    });
    await restarted.start();

    expect(await restarted.discard()).toEqual({ outcome: "discarded" });
    expect(await database.recordings.get(recordingId)).toBeUndefined();
    expect(await database.recordingBatches.where("recordingId").equals(recordingId).count()).toBe(0);
  });
});
