/**
 * The Active Ride handoff (04-PLANNER-AND-WORKSPACE-UX §28;
 * 08-RIDE-NAVIGATION-AND-FREE-RIDE §1, §13; 17-IMPLEMENTATION-PLAN Task 8.5).
 *
 * Two halves, both asserted here:
 *
 * - the **pure decision** (`buildRideHandoff`): a ride starts only with a chosen
 *   route whose line resolved, and every refusal is a code plus the instruction
 *   that fixes it;
 * - the **handoff itself** (`startRideFromHandoff`): the session event is
 *   journaled before the bootstrap pointer is written, a session for the same
 *   ride is *resumed* rather than duplicated (8 §1), and a rejected start writes
 *   no pointer at all.
 */

import { describe, expect, it, vi } from "vitest";

import {
  buildRideHandoff,
  prepareRecordingFromPlanner,
  startFreeRideFromPlanner,
  startRideFromHandoff,
} from "@/application/ride-session/ride-focus-handoff";
import type { RideFocusPointerPort } from "@/application/persistence/ride-focus-pointer";
import type { RideSessionRepositoryPort } from "@/application/persistence/ride-session-repository";
import { createRideSessionController } from "@/application/ride-session/ride-session-controller";
import { createRideDocument } from "@/domain/ride/create";
import { newPointId, newStopId, newRideId, type GeometryRef, type RideId } from "@/domain/ride/ids";
import type { RideDocument } from "@/domain/ride/types";
import type { RouteBundle, RouteCandidate } from "@/domain/route/types";
import { asRouteCandidateId } from "@/domain/route/ids";
import { newRideSessionId } from "@/domain/ride-session/ids";

const NOW = "2026-09-21T14:00:00.000Z";
const RIDE_ID: RideId = newRideId();
const ROUTE_ID = asRouteCandidateId("route_best");
const GEOMETRY_REF = "geo_ride_line" as GeometryRef;

/** A ride with a start, a destination and one pending stop. */
function document(overrides: Partial<RideDocument> = {}): RideDocument {
  const base = createRideDocument({ rideId: RIDE_ID, now: NOW });
  return {
    ...base,
    revision: 7,
    intent: {
      ...base.intent,
      start: {
        id: newPointId(),
        kind: "start",
        coordinate: { lon: -75.44, lat: 40.13 },
        provenance: { type: "map", selectedAt: NOW },
      },
      finish: {
        id: newPointId(),
        kind: "finish",
        coordinate: { lon: -75.4, lat: 40.1 },
        provenance: { type: "map", selectedAt: NOW },
      },
      stops: [
        {
          id: newStopId(),
          kind: "stop",
          coordinate: { lon: -75.42, lat: 40.12 },
          provenance: { type: "map", selectedAt: NOW },
        },
      ],
    },
    ...overrides,
  };
}

function candidate(id = ROUTE_ID): RouteCandidate {
  return {
    id,
    provider: { providerId: "fixture", profile: "motorcycle" },
    geometryRef: GEOMETRY_REF,
    distanceMeters: 4_800,
    durationSeconds: 600,
    eligibility: { eligible: true, reasons: [] },
    evidence: {},
    score: { total: 0.5, components: {} },
    warnings: [],
    fingerprint: "fixture",
  } as unknown as RouteCandidate;
}

function bundle(overrides: Partial<RouteBundle> = {}): RouteBundle {
  return {
    rideId: RIDE_ID,
    rideRevision: 7,
    planningGeneration: 3,
    policyVersion: "VNEXT_STUB_0",
    graphVersion: "unknown",
    evidenceVersion: "unknown",
    candidates: [candidate()],
    selectedRouteId: ROUTE_ID,
    selectionSource: "rider",
    roles: {} as RouteBundle["roles"],
    createdAt: NOW,
    ...overrides,
  };
}

function pointer(): RideFocusPointerPort & {
  readonly writes: readonly unknown[];
  readonly cleared: number;
} {
  const writes: unknown[] = [];
  let cleared = 0;
  return {
    get writes() {
      return writes;
    },
    get cleared() {
      return cleared;
    },
    read: () => ({ status: "absent" }),
    write: (value) => {
      writes.push(value);
    },
    clear: () => {
      cleared += 1;
    },
  };
}

describe("buildRideHandoff", () => {
  it("binds the ride's own revision, generation and selected route", () => {
    const guidance = [
      {
        text: "Turn left onto Ridge Pike",
        distanceMeters: 420,
        durationSeconds: 62,
        type: "turn",
        maneuver: "left" as const,
        roadName: "Ridge Pike",
        geometryIndex: 2,
      },
    ];
    const outcome = buildRideHandoff({
      document: document(),
      bundle: bundle(),
      selectedCandidate: { ...candidate(), instructions: guidance },
      hasRouteLine: true,
    });

    expect(outcome.outcome).toBe("ready");
    if (outcome.outcome !== "ready") return;
    expect(outcome.request.rideId).toBe(RIDE_ID);
    expect(outcome.request.rideRevision).toBe(7);
    expect(outcome.request.route).toEqual({ planningGeneration: 3, routeId: ROUTE_ID });
    expect(outcome.request.routeGeometryRef).toBe(GEOMETRY_REF);
    expect(outcome.request.itinerary).toHaveLength(1);
    expect(outcome.request.instructions).toEqual(guidance);
  });

  it("refuses without a plan, a start, a destination, a selection or a line", () => {
    const base = {
      document: document(),
      bundle: bundle(),
      selectedCandidate: candidate(),
      hasRouteLine: true,
    };

    expect(buildRideHandoff({ ...base, bundle: null }).outcome).toBe("refused");
    expect(buildRideHandoff({ ...base, bundle: null })).toMatchObject({ code: "no-plan" });
    expect(
      buildRideHandoff({
        ...base,
        document: { ...document(), intent: { ...document().intent, start: null } },
      }),
    ).toMatchObject({ code: "no-start" });
    expect(
      buildRideHandoff({ ...base, selectedCandidate: null }),
    ).toMatchObject({ code: "no-selection" });
    expect(buildRideHandoff({ ...base, hasRouteLine: false })).toMatchObject({
      code: "no-line",
    });
  });

  it("refuses a snap-as-you-go preview: the ride does not hold that drawing yet (OGV-D-285)", () => {
    const refused = buildRideHandoff({
      document: document(),
      bundle: bundle(),
      selectedCandidate: candidate(),
      hasRouteLine: true,
      sketchPreview: true,
    });
    expect(refused).toMatchObject({ outcome: "refused", code: "sketch-preview" });
    expect(
      buildRideHandoff({
        document: document(),
        bundle: bundle(),
        selectedCandidate: candidate(),
        hasRouteLine: true,
        sketchPreview: false,
      }).outcome,
    ).toBe("ready");
  });

  it("refuses a ride with neither a destination nor a stop", () => {
    const base = createRideDocument({ rideId: RIDE_ID, now: NOW });
    const outcome = buildRideHandoff({
      document: {
        ...base,
        intent: {
          ...base.intent,
          start: {
            id: newPointId(),
            kind: "start",
            coordinate: { lon: -75.44, lat: 40.13 },
            provenance: { type: "map", selectedAt: NOW },
          },
        },
      },
      bundle: bundle(),
      selectedCandidate: candidate(),
      hasRouteLine: true,
    });

    expect(outcome).toMatchObject({ outcome: "refused", code: "no-destination" });
  });

  it("starts a planned loop, which ends where it started and needs no finish", () => {
    const base = createRideDocument({ rideId: RIDE_ID, now: NOW });
    const outcome = buildRideHandoff({
      document: {
        ...base,
        intent: {
          ...base.intent,
          shape: "loop",
          start: {
            id: newPointId(),
            kind: "start",
            coordinate: { lon: -75.44, lat: 40.13 },
            provenance: { type: "map", selectedAt: NOW },
          },
        },
      },
      bundle: bundle(),
      selectedCandidate: candidate(),
      hasRouteLine: true,
    });

    expect(outcome).toMatchObject({ outcome: "ready", request: { itinerary: [] } });
  });
});

/** A journal that only records what was written, for ordering assertions. */
function journalSpy(log: string[]): RideSessionRepositoryPort {
  return {
    appendEvents: async () => {
      log.push("journal");
      return { ok: true };
    },
    checkpoint: async () => {
      log.push("checkpoint");
      return { ok: true };
    },
    loadSession: async () => null,
    listSessions: async () => [],
    deleteSession: async () => undefined,
  };
}

describe("startRideFromHandoff", () => {
  it("starts a route-free session and stores an empty-line pointer", async () => {
    const order: string[] = [];
    const controller = createRideSessionController({ repository: journalSpy(order), now: () => NOW });
    const port = pointer();
    const ride = document();
    const saveRide = vi.fn(async () => { order.push("ride"); return { ok: true as const }; });

    const outcome = await startFreeRideFromPlanner({
      controller,
      pointer: port,
      document: ride,
      rides: { saveRide } as never,
      writerToken: "free-ride-test-writer",
      now: NOW,
    });

    expect(outcome.outcome).toBe("started");
    expect(order[0]).toBe("ride");
    expect(saveRide).toHaveBeenCalledWith(ride, { writerToken: "free-ride-test-writer", baseRevision: 7 });
    expect(controller.snapshot()).toMatchObject({
      activity: "free",
      suggestions: "on",
      plan: { rideId: RIDE_ID, rideRevision: 7, route: null },
    });
    expect(port.writes).toContainEqual({
      sessionId: outcome.sessionId,
      rideId: RIDE_ID,
      routeGeometryRef: null,
      updatedAt: NOW,
    });
  });

  it("does not start or publish a session when the RideDocument cannot be persisted", async () => {
    const controller = createRideSessionController({ now: () => NOW });
    const port = pointer();
    const outcome = await startFreeRideFromPlanner({
      controller,
      pointer: port,
      document: document(),
      rides: { saveRide: vi.fn(async () => ({ ok: false as const, reason: "write-failed" as const, error: new Error("storage down") })) } as never,
      writerToken: "free-ride-test-writer",
      now: NOW,
    });
    expect(outcome).toMatchObject({ outcome: "rejected", message: "The ride could not be saved, so Free Ride was not started." });
    expect(controller.snapshot()).toBeNull();
    expect(port.writes).toEqual([]);
  });

  const request = (() => {
    const outcome = buildRideHandoff({
      document: document(),
      bundle: bundle(),
      selectedCandidate: candidate(),
      hasRouteLine: true,
    });
    if (outcome.outcome !== "ready") throw new Error("fixture handoff was refused");
    return outcome.request;
  })();

  it("journals the session before it writes the pointer", async () => {
    const order: string[] = [];
    const controller = createRideSessionController({
      now: () => NOW,
      repository: journalSpy(order),
    });
    const port = pointer();

    const outcome = await startRideFromHandoff({
      controller,
      pointer: {
        ...port,
        write: (value): void => {
          order.push("pointer");
          port.write(value);
        },
      },
      request,
      now: NOW,
    });

    expect(outcome.outcome).toBe("started");
    // 8 §13: the event is the durable record, so a crash between the two writes
    // leaves a session the rider can find — never a pointer to nothing.
    expect(order).toEqual(["journal", "checkpoint", "pointer"]);
    // The event reached the state machine, so the session is real rather than a
    // pointer to nothing.
    expect(controller.snapshot()?.activity).toBe("guided");
    expect(controller.snapshot()?.plan.route).toEqual({
      planningGeneration: 3,
      routeId: ROUTE_ID,
    });
    expect(controller.snapshot()?.remainingStopIds).toHaveLength(1);
    expect(port.writes).toHaveLength(1);
    expect(port.writes[0]).toMatchObject({
      sessionId: outcome.sessionId,
      rideId: RIDE_ID,
      routeGeometryRef: GEOMETRY_REF,
    });
  });

  it("resumes an existing session for the same ride instead of starting a second one", async () => {
    const controller = createRideSessionController({ now: () => NOW });
    const port = pointer();
    const start = vi.spyOn(controller, "start");
    const existing = newRideSessionId();

    const outcome = await startRideFromHandoff({
      controller,
      pointer: port,
      request,
      now: NOW,
      existingSessionId: existing,
    });

    expect(outcome).toMatchObject({ outcome: "resumed", sessionId: existing });
    expect(start).not.toHaveBeenCalled();
    expect(port.writes[0]).toMatchObject({ sessionId: existing });
  });

  it("returns the reducer's refusal and writes no pointer", async () => {
    const controller = createRideSessionController({ now: () => NOW });
    const port = pointer();
    // A session that is already running cannot be started twice.
    await controller.start({
      activity: "guided",
      rideId: RIDE_ID,
      rideRevision: 7,
      route: request.route,
      at: NOW,
    });

    const outcome = await startRideFromHandoff({ controller, pointer: port, request, now: NOW });

    expect(outcome.outcome).toBe("rejected");
    expect(outcome.message).not.toBeNull();
    expect(port.writes).toHaveLength(0);
  });
});

describe("prepareRecordingFromPlanner", () => {
  it("durably checkpoints the current RideDocument before the recording route opens", async () => {
    const ride = document();
    const saveRide = vi.fn(async () => ({ ok: true as const }));

    const outcome = await prepareRecordingFromPlanner({
      document: ride,
      rides: { saveRide } as never,
      writerToken: "recording-handoff-writer",
    });

    expect(outcome).toEqual({ outcome: "ready" });
    expect(saveRide).toHaveBeenCalledWith(ride, {
      writerToken: "recording-handoff-writer",
      baseRevision: ride.revision,
    });
  });

  it("refuses to open Ride Focus if the RideDocument checkpoint fails", async () => {
    const outcome = await prepareRecordingFromPlanner({
      document: document(),
      rides: {
        saveRide: vi.fn(async () => ({
          ok: false as const,
          reason: "write-failed" as const,
          error: new Error("storage down"),
        })),
      } as never,
      writerToken: "recording-handoff-writer",
    });

    expect(outcome).toMatchObject({
      outcome: "rejected",
      message: "The current ride could not be saved, so recording was not started.",
    });
  });
});
