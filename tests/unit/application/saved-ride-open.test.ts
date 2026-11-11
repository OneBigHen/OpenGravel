/**
 * R3-1 "Saved means exact": the ride I saved, imported or picked opens as
 * exactly that line.
 *
 * These pin the whole path a rider takes from My rides to the planner, with the
 * real library service and repository: the line handed to the planner is the
 * saved line, its numbers are the saved card's, the truth lines still read the
 * saved surface, and the router is not asked — until the rider presses
 * "Plan it again".
 */

import "fake-indexeddb/auto";

import { describe, expect, it, vi } from "vitest";

import {
  isSavedLineCandidate,
  markRideToRestore,
  openLibraryRide,
  preparedRouteAnswer,
  SAVED_LINE_MISSING_MESSAGE,
  takePreparedRoute,
  takeRideToRestoreRequest,
  withPreparedRoute,
  type PreparedRouteStorage,
} from "@/application/explore/ride-this";
import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import { createLibraryService } from "@/application/library/library-service";
import type { ClientPlanningService } from "@/application/planner/client-planning-service";
import { planAgainMessage } from "@/application/planner/plan-again";
import { emptyPlanningSession, type PlanningSessionSnapshot } from "@/application/planner/planning-session";
import { rideTruth } from "@/application/planner/ride-truth";
import { createRideDocument } from "@/domain/ride/create";
import type { GeometryRef } from "@/domain/ride/ids";
import { validateSessionRouteBinding } from "@/domain/ride-session/validate";
import { VNextDatabase } from "@/infrastructure/storage/db";
import { createRideRepository } from "@/infrastructure/storage/ride-repository";
import { createPlanningSessionStore } from "@/ui/stores/planning-session-store";

const NOW = "2026-11-11T12:00:00.000Z";

const LINE = [
  { lon: -77.9, lat: 40.7 },
  { lon: -77.85, lat: 40.75 },
  { lon: -77.8, lat: 40.7 },
  { lon: -77.9, lat: 40.7005 },
];

const SURFACE_MIX = {
  value: {
    pavedMeters: 47_800,
    gravelMeters: 37_495,
    dirtMeters: 0,
    unknownMeters: 0,
    runs: [[47_800, "paved"], [37_495, "gravel"]],
  },
  status: "known",
  confidence: 0.9,
  provenance: [{ id: "graphhopper", label: "Road data", category: "routing" }],
} as const;

const CLEAR_CLOSURE_CHECK = {
  value: 0,
  status: "known",
  confidence: 1,
  provenance: [{ id: "511pa", label: "511PA", category: "other", observedAt: NOW }],
} as const;

let sequence = 0;

function memoryStorage(): PreparedRouteStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

/** The router, as the planner sees it: every `begin` is one route-plan request. */
function router(): { readonly service: ClientPlanningService; readonly begin: ReturnType<typeof vi.fn> } {
  let snapshot: PlanningSessionSnapshot = emptyPlanningSession();
  const begin = vi.fn(async (input: unknown) => { void input; });
  return {
    begin,
    service: {
      snapshot: () => snapshot,
      begin: async (input) => {
        await begin(input);
        snapshot = { ...snapshot, identity: { rideId: input.rideId, rideRevision: input.rideRevision, planningGeneration: 1 } };
      },
      cancel: () => undefined,
      selectRoute: () => undefined,
      dispose: () => undefined,
      subscribe: () => () => undefined,
      readGeometry: async (ref: GeometryRef) => ({ kind: "line", coordinates: LINE, ref }),
    },
  };
}

function library() {
  sequence += 1;
  const repository = createRideRepository({ database: new VNextDatabase(`og-r3-saved-exact-${sequence}`) });
  const geometryStore = createMemoryGeometryStore();
  const service = createLibraryService(repository, { now: () => NOW, geometryStore });
  return { service, geometryStore, repository };
}

async function savedLoop(service: ReturnType<typeof library>["service"]) {
  return service.saveNamed(createRideDocument({ now: NOW, title: "Rothrock loop" }), {
    title: "Rothrock loop",
    bundleSummary: { distanceMeters: 85_295, durationSeconds: 7_920 },
    plannedRoute: {
      geometry: LINE,
      distanceMeters: 85_295,
      durationSeconds: 7_920,
      evidence: { surfaceMix: SURFACE_MIX, closures: CLEAR_CLOSURE_CHECK } as never,
    },
  });
}

describe("opening a saved ride from My rides", () => {
  it("opens on the same coordinates and numbers, and makes zero router calls", async () => {
    const { service, geometryStore } = library();
    const saved = await savedLoop(service);
    const storage = memoryStorage();

    const opened = await openLibraryRide(saved.document.rideId, service, geometryStore, { now: () => NOW, storage });
    expect(opened.prepared).toBe(true);
    expect(opened.message).toBeNull();

    const prepared = takePreparedRoute({ now: () => NOW, storage, keep: memoryStorage() });
    expect(prepared).not.toBeNull();
    expect(prepared!.rideId).toBe(opened.rideId);
    const line = await geometryStore.get(prepared!.geometryRef);
    expect(line?.payload).toEqual({ kind: "line", coordinates: LINE });

    // The planner boots, restores the working copy and asks to plan it.
    const route = router();
    const store = createPlanningSessionStore({ service: withPreparedRoute(route.service, prepared) });
    await store.getState().begin({ rideId: prepared!.rideId, rideRevision: prepared!.rideRevision, intent: createRideDocument({ now: NOW }).intent });
    expect(route.begin).not.toHaveBeenCalled();

    const candidate = store.getState().snapshot.committedBundle?.candidates[0];
    expect(candidate?.distanceMeters).toBe(85_295);
    expect(candidate?.durationSeconds).toBe(7_920);
    expect(isSavedLineCandidate(candidate)).toBe(true);
    // Start ride binds it like any other answer.
    const answer = preparedRouteAnswer(prepared!);
    expect(validateSessionRouteBinding({ planningGeneration: answer.planningGeneration, routeId: answer.selectedRouteId })).toEqual([]);
  });

  it("keeps the saved surface on the truth lines, and never a clear closure check from another day", async () => {
    const { service, geometryStore } = library();
    const saved = await savedLoop(service);
    const storage = memoryStorage();
    await openLibraryRide(saved.document.rideId, service, geometryStore, { now: () => NOW, storage });
    const candidate = preparedRouteAnswer(takePreparedRoute({ now: () => NOW, storage, keep: memoryStorage() })!).candidates[0]!;

    const [surface, , checked] = rideTruth({ evidence: candidate.evidence, distanceMeters: candidate.distanceMeters });
    expect(surface.tone).toBe("good");
    expect(surface.text).toMatch(/gravel/i);
    expect(checked).toEqual({ tone: "unknown", text: "Closure check is out of date" });
  });

  it("plans a ride saved without a line once, and says why", async () => {
    const { service, geometryStore } = library();
    const saved = await service.saveNamed(createRideDocument({ now: NOW }), { title: "Old row" });
    const storage = memoryStorage();

    const opened = await openLibraryRide(saved.document.rideId, service, geometryStore, { now: () => NOW, storage });
    expect(opened.prepared).toBe(false);
    expect(opened.message).toBe(SAVED_LINE_MISSING_MESSAGE);
    expect(takePreparedRoute({ now: () => NOW, storage, keep: memoryStorage() })).toBeNull();

    // The message rides the one-boot marker to the planner.
    const marker = memoryStorage();
    markRideToRestore(opened.rideId, { now: () => NOW, storage: marker, message: opened.message });
    expect(takeRideToRestoreRequest({ now: () => NOW, storage: marker })).toEqual({
      rideId: opened.rideId,
      message: "Planned again: the saved line was not stored.",
    });

    // With no line held, the restored ride's one ask goes to the router.
    const route = router();
    const planner = withPreparedRoute(route.service, null);
    await planner.begin({ rideId: opened.rideId, rideRevision: 0, intent: createRideDocument({ now: NOW }).intent });
    expect(route.begin).toHaveBeenCalledOnce();
  });

  it("\"Plan it again\" asks the router once and drops the kept line", async () => {
    const { service, geometryStore } = library();
    const saved = await savedLoop(service);
    const storage = memoryStorage();
    await openLibraryRide(saved.document.rideId, service, geometryStore, { now: () => NOW, storage });
    const prepared = takePreparedRoute({ now: () => NOW, storage, keep: memoryStorage() })!;
    const route = router();
    const diverged = vi.fn();
    const planner = withPreparedRoute(route.service, prepared, { onDiverged: diverged });
    const input = { rideId: prepared.rideId, rideRevision: prepared.rideRevision, intent: createRideDocument({ now: NOW }).intent };

    await planner.begin(input);
    expect(route.begin).not.toHaveBeenCalled();
    await planner.begin({ ...input, fresh: true });
    expect(route.begin).toHaveBeenCalledOnce();
    expect(diverged).toHaveBeenCalledOnce();
  });

  it("says once what the new plan changed", () => {
    expect(planAgainMessage(
      { distanceMeters: 85_295, durationSeconds: 7_920 },
      { distanceMeters: 88_514, durationSeconds: 6_900 },
    )).toBe("Planned again: now 55 mi, 1 h 55 min. The saved line was 53 mi, 2 h 12 min.");
    expect(planAgainMessage(
      { distanceMeters: 85_295, durationSeconds: 7_920 },
      { distanceMeters: 85_300, durationSeconds: 7_925 },
    )).toBe("Planned again: same as the saved line, 53 mi, 2 h 12 min.");
  });
});
