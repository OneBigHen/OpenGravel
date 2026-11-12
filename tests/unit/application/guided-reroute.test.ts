import { describe, expect, it, vi } from "vitest";

import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import type { ProviderRouteRequest } from "@/application/planner/route-provider";
import { createGuidedReroutePlanner } from "@/application/ride-session/guided-reroute";
import { chainage, nearestAlong, pointAlong } from "@/application/ride-session/rejoin-splice";
import type { RouteInstruction } from "@/domain/route/types";
import { createRideDocument } from "@/domain/ride/create";
import type { PointId } from "@/domain/ride/ids";
import type { SessionNavigationState } from "@/domain/ride-session/navigation";

import { createFakeConnectorProvider } from "../../ride-sim/fake-connector-provider";

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

  it("leaves the way a moving rider is heading, and any way when they are stopped", async () => {
    const port = provider();
    const planner = createGuidedReroutePlanner({
      rides: { loadRide: vi.fn(async () => ({ ok: true as const, document })) } as never,
      geometry: createMemoryGeometryStore(), provider: port,
    });
    const moving = navigation({ position: { ...navigation().position, headingDegrees: -90, speedMps: 15 } });
    await planner.plan({ navigation: moving, signal: new AbortController().signal });
    expect(port.requests[0]?.originHeadingDegrees).toBe(270);
    const stopped = navigation({ position: { ...navigation().position, headingDegrees: 90, speedMps: 0.5 } });
    await planner.plan({ navigation: stopped, signal: new AbortController().signal });
    expect(port.requests[1]).not.toHaveProperty("originHeadingDegrees");
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

describe("createGuidedReroutePlanner: rejoin the planned line (RM-6)", () => {
  const LAT = 40.5;
  const lonPerMeter = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180));
  const latPerMeter = 1 / 111_320;
  // 20 km east, a vertex every 250 m, one turn onto a second road at 5 km.
  const line = Array.from({ length: 81 }, (_, index) => ({ lon: -77 + index * 250 * lonPerMeter, lat: LAT }));
  const chain = chainage(line);
  const leg = (from: number, to: number) => ({ distanceMeters: chain[to]! - chain[from]!, durationSeconds: (chain[to]! - chain[from]!) / 15 });
  const instructions: RouteInstruction[] = [
    { text: "Head east on Ridge Road", type: "depart", roadName: "Ridge Road", geometryIndex: 0, ...leg(0, 20) },
    { text: "Continue onto Hollow Road", type: "turn", maneuver: "slight-left", roadName: "Hollow Road", geometryIndex: 20, ...leg(20, 80) },
    { text: "Arrive", type: "finish", geometryIndex: 80, distanceMeters: 0, durationSeconds: 0 },
  ];
  const ride = {
    ...document,
    intent: {
      ...document.intent,
      start: { ...document.intent.start!, coordinate: line[0]! },
      finish: { ...document.intent.finish!, coordinate: line[80]! },
    },
  };
  const rider = (along: number) => {
    const point = pointAlong(line, chain, along).coordinate;
    return navigation({ position: { ...navigation().position, coordinate: { lon: point.lon, lat: point.lat - 400 * latPerMeter }, headingDegrees: 90, speedMps: 15 } });
  };
  const plannerWith = (port: ReturnType<typeof createFakeConnectorProvider>, geometry = createMemoryGeometryStore()) =>
    createGuidedReroutePlanner({ rides: { loadRide: vi.fn(async () => ({ ok: true as const, document: ride })) } as never, geometry, provider: port });

  it("routes only the way back, in at most three calls on the ride's profile, and keeps the rest exactly", async () => {
    const port = createFakeConnectorProvider({ line, instructions });
    const geometry = createMemoryGeometryStore();
    const result = await plannerWith(port, geometry).plan({
      navigation: rider(9_000),
      route: { line, alongMeters: 8_800, instructions },
      signal: new AbortController().signal,
    });
    expect(port.requests.length).toBeLessThanOrEqual(3);
    expect(port.requests.every((request) => request.originHeadingDegrees === 90 && request.stops.length === 0)).toBe(true);
    expect(new Set(port.requests.map((request) => request.profile)).size).toBe(1);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.rejoin).toMatchObject({ routerCalls: port.requests.length, closureChecked: false });
    const stored = await geometry.get(result.routeGeometryRef);
    const spliced = stored?.payload.kind === "line" ? stored.payload.coordinates : [];
    // The earliest target, 0.8 km beyond the rider's nearest point (9 km): the tail is the planned line from there.
    const joinAt = spliced.length - 1 - (line.length - 40);
    expect(Math.round(nearestAlong(line, chain, spliced[joinAt]!))).toBe(9_800);
    expect(spliced.slice(joinAt + 1)).toEqual(line.slice(40));
    expect(result.instructions?.at(-1)).toMatchObject({ type: "finish", geometryIndex: spliced.length - 1 });
  });

  it("falls back to one full replan when the way back costs more than a quarter of the time left", async () => {
    const port = createFakeConnectorProvider({ line, instructions, extraSeconds: 3_600 });
    const result = await plannerWith(port).plan({
      navigation: rider(9_000),
      route: { line, alongMeters: 8_800, instructions },
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.rejoin).toBeUndefined();
    expect(port.requests.at(-1)?.destination).toEqual(line[80]);
  });

  it("starts the targets at 3 km after the rider rode away from two reroutes in a row", async () => {
    const port = createFakeConnectorProvider({ line, instructions });
    const planner = plannerWith(port);
    let generation = 7;
    const firstTargets: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = port.requests.length;
      const result = await planner.plan({
        navigation: { ...rider(9_000), plan: { ...rider(9_000).plan, route: { planningGeneration: generation, routeId: "route_x" as never } } },
        route: { line, alongMeters: 8_800, instructions },
        signal: new AbortController().signal,
      });
      if (result.status === "planned") generation = result.route.planningGeneration;
      firstTargets.push(Math.round(nearestAlong(line, chain, port.requests[before]!.destination)));
    }
    expect(firstTargets).toEqual([9_800, 9_800, 12_000]);
  });
});
