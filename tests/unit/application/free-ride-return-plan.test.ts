import { describe, expect, it, vi } from "vitest";
import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import { createReturnPlanner } from "@/application/free-ride/return-plan";
import { createRideDocument } from "@/domain/ride/create";
import type { SessionNavigationState } from "@/domain/ride-session/navigation";
import type { ProviderRouteRequest } from "@/application/planner/route-provider";

const document = createRideDocument({ now: "2026-09-22T12:00:00.000Z" });
const navigation: SessionNavigationState = {
  sessionId: "sess_return" as SessionNavigationState["sessionId"], activity: "free", resumeActivity: null,
  startedAt: "2026-09-22T12:00:00.000Z", endedAt: null, endReason: null,
  plan: { rideId: document.rideId, rideRevision: document.revision, route: null },
  recordingId: null, aheadGuidanceSuspended: false, instruction: null, offRouteState: null,
  nextStopId: null, completedStopIds: [], remainingStopIds: [],
  position: { coordinate: { lon: -77, lat: 40 }, observedAt: "2026-09-22T12:00:00.000Z", ageMs: 0,
    accuracyMeters: 8, headingDegrees: 90, speedMps: 12, quality: "fresh-good" },
};

describe("createReturnPlanner", () => {
  it("selects the lower-workload server role and persists that legal fresh route", async () => {
    const geometry = createMemoryGeometryStore();
    let request: ProviderRouteRequest | null = null;
    const provider = {
      beginAttempt: vi.fn(),
      candidates: vi.fn(async (next: ProviderRouteRequest) => {
        request = next;
        return { candidates: [
          { providerId: "api", profile: "motorcycle", geometry: [{ lon: -77, lat: 40 }, { lon: -76.9, lat: 40 }], distanceMeters: 900, durationSeconds: 100, providerMetadata: { candidateId: "route_fast", bestRide: true, lowerWorkload: false } },
          { providerId: "api", profile: "motorcycle", geometry: [{ lon: -77, lat: 40 }, { lon: -76.8, lat: 40.1 }], distanceMeters: 1_200, durationSeconds: 150, providerMetadata: { candidateId: "route_easy", lowerWorkload: true, bestRide: false } },
        ] };
      }),
    };
    const planner = createReturnPlanner({
      rides: { loadRide: vi.fn(async () => ({ ok: true as const, document })) } as never,
      geometry, provider, now: () => "2026-09-22T12:01:00.000Z",
    });
    const result = await planner.plan({
      navigation,
      target: { kind: "chosen-destination", coordinate: { lon: -77.2, lat: 40.2 }, label: "Cabin" },
      mode: "fatigue", signal: new AbortController().signal,
    });

    expect(request).toMatchObject({ origin: navigation.position.coordinate, destination: { lon: -77.2, lat: 40.2 }, profile: "motorcycle" });
    expect(result).toMatchObject({ status: "planned", route: { routeId: "route_easy" }, durationSeconds: 150 });
    if (result.status === "planned") expect(await geometry.get(result.routeGeometryRef)).toMatchObject({ payload: { coordinates: [{ lon: -77, lat: 40 }, { lon: -76.8, lat: 40.1 }] } });
  });

  it("plans the same lower-workload return from an active guided ride", async () => {
    const geometry = createMemoryGeometryStore();
    const provider = {
      beginAttempt: vi.fn(),
      candidates: vi.fn(async () => ({
        candidates: [
          { providerId: "api", profile: "motorcycle", geometry: [{ lon: -77, lat: 40 }, { lon: -76.8, lat: 40.1 }], distanceMeters: 1_200, durationSeconds: 150, providerMetadata: { candidateId: "route_easy_guided", lowerWorkload: true, bestRide: false } },
        ],
      })),
    };
    const planner = createReturnPlanner({
      rides: { loadRide: vi.fn(async () => ({ ok: true as const, document })) } as never,
      geometry, provider, now: () => "2026-09-22T12:01:00.000Z",
    });
    const guided: SessionNavigationState = {
      ...navigation,
      activity: "guided",
      plan: {
        ...navigation.plan,
        route: { planningGeneration: 4, routeId: "route_current" as never },
      },
    };

    const result = await planner.plan({
      navigation: guided,
      target: { kind: "session-start", coordinate: { lon: -77.2, lat: 40.2 }, label: "Ride start" },
      mode: "fatigue",
      signal: new AbortController().signal,
    });

    expect(provider.beginAttempt).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: "planned",
      route: { routeId: "route_easy_guided" },
      distanceMeters: 1_200,
    });
  });

  it("re-plans a return under way through a chosen stop, taking the best route when no easier one comes back", async () => {
    const geometry = createMemoryGeometryStore();
    let request: ProviderRouteRequest | null = null;
    const provider = {
      beginAttempt: vi.fn(),
      candidates: vi.fn(async (next: ProviderRouteRequest) => {
        request = next;
        return { candidates: [
          { providerId: "api", profile: "motorcycle", geometry: [{ lon: -77, lat: 40 }, { lon: -76.9, lat: 40 }], distanceMeters: 900, durationSeconds: 100, providerMetadata: { candidateId: "route_best", bestRide: true, lowerWorkload: false } },
        ] };
      }),
    };
    const planner = createReturnPlanner({
      rides: { loadRide: vi.fn(async () => ({ ok: true as const, document })) } as never,
      geometry, provider, now: () => "2026-09-22T12:01:00.000Z",
    });
    const input = {
      navigation,
      target: { kind: "session-start" as const, coordinate: { lon: -77.2, lat: 40.2 }, label: "Ride start" },
      mode: "fatigue" as const,
      signal: new AbortController().signal,
      via: { coordinate: { lon: -77.1, lat: 40.1 }, label: "Sunoco" },
    };

    await expect(planner.plan(input)).resolves.toMatchObject({ status: "unavailable", reason: "no-lower-workload-route" });
    await expect(planner.plan({ ...input, fallbackToBest: true })).resolves.toMatchObject({ status: "planned", route: { routeId: "route_best" } });
    expect(request).toMatchObject({ destination: { lon: -77.2, lat: 40.2 }, stops: [{ lon: -77.1, lat: 40.1 }] });
  });

  it("refuses to weaken constraints when an authored geometry handle is unresolved", async () => {
    const provider = { beginAttempt: vi.fn(), candidates: vi.fn() };
    const brokenDocument = { ...document, intent: { ...document.intent, avoidAreas: [{ id: "avoid_missing" as never, name: null, geometryRef: "geo_missing" as never, enabled: true, createdBy: "rider" as const }] } };
    const planner = createReturnPlanner({
      rides: { loadRide: vi.fn(async () => ({ ok: true as const, document: brokenDocument })) } as never,
      geometry: createMemoryGeometryStore(), provider,
    });
    const result = await planner.plan({
      navigation, target: { kind: "session-start", coordinate: { lon: -77.2, lat: 40.2 }, label: null },
      mode: "head-home", signal: new AbortController().signal,
    });
    expect(result).toEqual({ status: "unavailable", reason: "constraints-unresolved" });
    expect(provider.candidates).not.toHaveBeenCalled();
  });
});
