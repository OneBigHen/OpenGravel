import { describe, expect, it, vi } from "vitest";

import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import type { ProviderRouteRequest } from "@/application/planner/route-provider";
import { createGuidedReroutePlanner } from "@/application/ride-session/guided-reroute";
import { createRideDocument } from "@/domain/ride/create";
import type { PointId } from "@/domain/ride/ids";
import type { SessionNavigationState } from "@/domain/ride-session/navigation";

const base = createRideDocument({ now: "2026-09-25T12:00:00.000Z" });
const document = {
  ...base,
  intent: {
    ...base.intent,
    shape: "destination" as const,
    start: { id: "pt_start" as PointId, kind: "start" as const, coordinate: { lon: -75.4, lat: 40.1 }, provenance: { type: "map" as const, selectedAt: "2026-09-25T12:00:00.000Z" } },
    finish: { id: "pt_finish" as PointId, kind: "finish" as const, coordinate: { lon: -75.7, lat: 40.9 }, provenance: { type: "map" as const, selectedAt: "2026-09-25T12:00:00.000Z" } },
  },
};

function navigation(overrides: Partial<SessionNavigationState> = {}): SessionNavigationState {
  return {
    sessionId: "sess_reroute" as SessionNavigationState["sessionId"], activity: "guided", resumeActivity: null,
    startedAt: "2026-09-25T12:00:00.000Z", endedAt: null, endReason: null,
    plan: { rideId: document.rideId, rideRevision: document.revision, route: { planningGeneration: 7, routeId: "route_old" as never } },
    recordingId: null, aheadGuidanceSuspended: false, instruction: null, offRouteState: "off-route",
    nextStopId: null, completedStopIds: [], remainingStopIds: [],
    position: { coordinate: { lon: -75.5, lat: 40.4 }, observedAt: "2026-09-25T12:30:00.000Z", ageMs: 0,
      accuracyMeters: 6, headingDegrees: 0, speedMps: 20, quality: "fresh-good" },
    ...overrides,
  };
}

function provider() {
  const requests: ProviderRouteRequest[] = [];
  return {
    requests,
    beginAttempt: vi.fn(),
    candidates: vi.fn(async (request: ProviderRouteRequest) => {
      requests.push(request);
      return { candidates: [
        { providerId: "api", profile: "motorcycle", geometry: [{ lon: -75.5, lat: 40.4 }, { lon: -75.7, lat: 40.9 }], distanceMeters: 60_000, durationSeconds: 3_600, providerMetadata: { candidateId: "route_new", bestRide: true } },
      ] };
    }),
  };
}

describe("createGuidedReroutePlanner", () => {
  it("plans from the rider's position to the finish and outranks the current binding", async () => {
    const geometry = createMemoryGeometryStore();
    const port = provider();
    const planner = createGuidedReroutePlanner({
      rides: { loadRide: vi.fn(async () => ({ ok: true as const, document })) } as never,
      geometry, provider: port,
    });
    const result = await planner.plan({ navigation: navigation(), signal: new AbortController().signal });

    expect(port.requests[0]).toMatchObject({ origin: { lon: -75.5, lat: 40.4 }, destination: { lon: -75.7, lat: 40.9 }, stops: [] });
    expect(result).toMatchObject({ status: "planned", route: { planningGeneration: 8, routeId: "route_new" }, distanceMeters: 60_000 });
    if (result.status === "planned") expect(await geometry.get(result.routeGeometryRef)).not.toBeNull();
  });

  it("routes through a chosen detour before the finish", async () => {
    const port = provider();
    const planner = createGuidedReroutePlanner({
      rides: { loadRide: vi.fn(async () => ({ ok: true as const, document })) } as never,
      geometry: createMemoryGeometryStore(), provider: port,
    });
    await planner.plan({
      navigation: navigation(),
      detour: { coordinate: { lon: -75.55, lat: 40.5 }, label: "Sunoco" },
      signal: new AbortController().signal,
    });
    expect(port.requests[0]?.stops).toEqual([{ lon: -75.55, lat: 40.5 }]);
  });

  it("does not plan without a good fix or outside guidance", async () => {
    const port = provider();
    const planner = createGuidedReroutePlanner({
      rides: { loadRide: vi.fn(async () => ({ ok: true as const, document })) } as never,
      geometry: createMemoryGeometryStore(), provider: port,
    });
    const weak = navigation({ position: { ...navigation().position, quality: "fresh-poor" } });
    expect(await planner.plan({ navigation: weak, signal: new AbortController().signal })).toEqual({ status: "unavailable", reason: "gps" });
    expect(await planner.plan({ navigation: navigation({ activity: "free" }), signal: new AbortController().signal })).toEqual({ status: "unavailable", reason: "not-guided" });
    expect(port.candidates).not.toHaveBeenCalled();
  });
});
