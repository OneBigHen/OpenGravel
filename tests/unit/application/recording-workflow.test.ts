import { describe, expect, it, vi } from "vitest";

import type { RideSessionController } from "@/application/ride-session/ride-session-controller";
import type { RecordingRepositoryPort } from "@/application/persistence/recording-repository";
import type { RideFocusPointerPort } from "@/application/persistence/ride-focus-pointer";
import type { LibraryServicePort } from "@/application/library/library-service";
import { createRideRecordingWorkflow } from "@/application/ride-session/recording-workflow";
import { positionUpdatedEvent, sessionStartedEvent } from "@/domain/ride-session/create";
import { reduce } from "@/domain/ride-session/reducer";
import type { RideSessionEvent, RideSessionState } from "@/domain/ride-session/types";
import type { RecordingId } from "@/domain/recording/ids";
import type { RecordingPosition, RecordingSummary } from "@/domain/recording/types";
import { newRideId } from "@/domain/ride/ids";

const INITIAL = "2026-09-21T14:00:00.000Z";
const DISCARD_AT = "2026-09-21T14:00:00.050Z";
const INTERNAL_CLOCK = "2026-09-21T14:00:00.150Z";

describe("ride recording workflow", () => {
  it("uses the caller's discard instant for both session journal events", async () => {
    let state: RideSessionState | null = null;
    const session = {
      snapshot: () => state,
      async start(input: Parameters<RideSessionController["start"]>[0]) {
        const started = reduce(
          null,
          sessionStartedEvent({
            at: input.at ?? INITIAL,
            activity: input.activity,
            plan: {
              rideId: input.rideId,
              rideRevision: input.rideRevision,
              route: input.route ?? null,
            },
            recordingId: input.recordingId ?? null,
            suggestions: input.suggestions ?? "off",
            itinerary: input.itinerary ?? [],
          }),
        );
        if (started.outcome !== "applied") throw new Error(started.message);
        state = started.state;
        return { outcome: "applied" as const, state, persistence: "durable" as const };
      },
      async dispatch(event: RideSessionEvent) {
        const result = reduce(state, event);
        if (result.outcome !== "applied") {
          return {
            outcome: "rejected" as const,
            code: result.code,
            message: result.message,
            state,
            persistence: "durable" as const,
          };
        }
        state = result.state;
        return { outcome: "applied" as const, state, persistence: "durable" as const };
      },
    } as unknown as RideSessionController;
    const recordings: RecordingRepositoryPort = {
      create: async () => ({ ok: true }),
      appendBatch: async () => ({ ok: true }),
      load: async (recordingId: RecordingId) => ({
        recordingId,
        status: "open",
        lastBatchSeq: 0,
        pointCount: 0,
        summary: null,
      }),
      scan: async (recordingId) => ({
        status: "complete",
        trace: {
          recordingId,
          status: "open",
          lastBatchSeq: 0,
          pointCount: 0,
          summary: null,
        },
        readablePointCount: 0,
        tail: null,
      }),
      seal: async (_recordingId, summary) => ({ ok: true, summary }),
      delete: async () => ({ ok: true }),
    };
    const pointer: RideFocusPointerPort = {
      read: () => ({ status: "absent" }),
      write: vi.fn(),
      clear: vi.fn(),
    };
    const library = {
      saveRecorded: vi.fn(),
      findRecorded: vi.fn(),
    } as unknown as Pick<LibraryServicePort, "saveRecorded" | "findRecorded">;
    const workflow = createRideRecordingWorkflow({
      session,
      pointer,
      recordings,
      library,
      now: () => INTERNAL_CLOCK,
    });

    const started = await workflow.start(newRideId(), 1, INITIAL);
    expect(started.outcome).toBe("started");

    const discarded = await workflow.discard(DISCARD_AT);

    expect(discarded.outcome).toBe("discarded");
    const finalState = state as RideSessionState | null;
    expect(finalState?.activity).toBe("completed");
    expect(finalState?.endedAt).toBe(DISCARD_AT);
  });

  it("finishes when GPS advances the session while the trace is being saved", async () => {
    const finishAt = "2026-09-21T14:00:01.000Z";
    const gpsDuringSaveAt = "2026-09-21T14:00:02.000Z";
    const closeClock = "2026-09-21T14:00:03.000Z";
    let state: RideSessionState | null = null;

    const session = {
      snapshot: () => state,
      async start(input: Parameters<RideSessionController["start"]>[0]) {
        const started = reduce(
          null,
          sessionStartedEvent({
            at: input.at ?? INITIAL,
            activity: input.activity,
            plan: {
              rideId: input.rideId,
              rideRevision: input.rideRevision,
              route: input.route ?? null,
            },
            recordingId: input.recordingId ?? null,
            suggestions: input.suggestions ?? "off",
            itinerary: input.itinerary ?? [],
          }),
        );
        if (started.outcome !== "applied") throw new Error(started.message);
        state = started.state;
        return { outcome: "applied" as const, state, persistence: "durable" as const };
      },
      async dispatch(event: RideSessionEvent) {
        const result = reduce(state, event);
        if (result.outcome !== "applied") {
          return {
            outcome: "rejected" as const,
            code: result.code,
            message: result.message,
            state,
            persistence: "durable" as const,
          };
        }
        state = result.state;
        return { outcome: "applied" as const, state, persistence: "durable" as const };
      },
    } as unknown as RideSessionController;

    const points: RecordingPosition[] = [];
    let sealedSummary: RecordingSummary | null = null;
    const recordings: RecordingRepositoryPort = {
      create: async () => ({ ok: true }),
      appendBatch: async (_recordingId, batch) => {
        points.push(...batch);
        return { ok: true };
      },
      load: async (recordingId: RecordingId) => ({
        recordingId,
        status: "open",
        lastBatchSeq: 0,
        pointCount: points.length,
        summary: null,
      }),
      scan: async (recordingId, visit) => {
        visit(points);
        return {
          status: "complete",
          trace: {
            recordingId,
            status: sealedSummary === null ? "open" : "sealed",
            lastBatchSeq: points.length === 0 ? 0 : 1,
            pointCount: points.length,
            summary: sealedSummary,
          },
          readablePointCount: points.length,
          tail: null,
        };
      },
      seal: async (_recordingId, summary) => {
        sealedSummary = summary;
        return { ok: true, summary };
      },
      delete: async () => ({ ok: true }),
    };
    const pointer: RideFocusPointerPort = {
      read: () => ({ status: "absent" }),
      write: vi.fn(),
      clear: vi.fn(),
    };
    const library = {
      saveRecorded: vi.fn(async () => {
        await session.dispatch(positionUpdatedEvent({
          coordinate: { lon: -75.437, lat: 40.14 },
          observedAt: gpsDuringSaveAt,
          accuracyMeters: 5,
          headingDegrees: 90,
          speedMps: 8,
        }, gpsDuringSaveAt));
        return {};
      }),
      findRecorded: vi.fn(),
    } as unknown as Pick<LibraryServicePort, "saveRecorded" | "findRecorded">;

    const workflow = createRideRecordingWorkflow({
      session,
      pointer,
      recordings,
      library,
      now: () => closeClock,
    });
    expect((await workflow.start(newRideId(), 1, INITIAL)).outcome).toBe("started");
    expect((await workflow.append({
      coordinate: { lon: -75.44, lat: 40.14 },
      observedAt: "2026-09-21T14:00:00.200Z",
      accuracyMeters: 5,
    })).outcome).toBe("accepted");
    expect((await workflow.append({
      coordinate: { lon: -75.438, lat: 40.14 },
      observedAt: "2026-09-21T14:00:00.800Z",
      accuracyMeters: 5,
    })).outcome).toBe("accepted");

    const finished = await workflow.finish(finishAt);

    expect(finished.outcome).toBe("finished");
    const finalState = state as RideSessionState | null;
    expect(finalState?.activity).toBe("completed");
    expect(finalState?.endedAt).toBe(closeClock);
    expect(pointer.clear).toHaveBeenCalled();
  });
});
