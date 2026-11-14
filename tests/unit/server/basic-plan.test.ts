import { describe, expect, it } from "vitest";

import type { RoutePlanIdentityWire } from "@/application/planner/ports/route-plan-contract";
import type { ProviderCandidateSet, ProviderRouteRequest, RouteCandidateProvider } from "@/application/planner/route-provider";
import { GraphHopperProviderError } from "@/infrastructure/routing/graphhopper/response-parser";
import { ValhallaRoutingError, VALHALLA_COPY, type BasicRoute, type ValhallaRouter } from "@/infrastructure/routing/valhalla/router";
import { BASIC_LOOP_COPY, BASIC_ROAD_CHOICES_COPY, BASIC_ROUTE_COPY, leavesCoverage } from "@/server/planning/basic-plan";
import { planRide } from "@/server/planning/plan-service";

const IDENTITY: RoutePlanIdentityWire = { rideId: "ride_basic", rideRevision: 1, planningGeneration: 1 };
/** The deployed graph's box today (PA/NJ). */
const BOX = [-80.588779, 38.782374, -73.90647, 42.281185] as const;

const PA: ProviderRouteRequest = {
  requestId: "req",
  origin: { lon: -75.66, lat: 40.8 },
  destination: { lon: -75.66, lat: 40.86 },
  stops: [],
  shaping: [],
  profile: "motorcycle_twisty",
  avoidPolygons: [],
  options: { includeAlternatives: false, avoidHighways: false, tollPolicy: "allow-with-warning", vehicle: "motorcycle", roadCharacter: "curvy" },
};
const VERMONT: ProviderRouteRequest = { ...PA, origin: { lon: -72.58, lat: 44.26 }, destination: { lon: -72.82, lat: 44.47 } };

const LINE: BasicRoute = {
  geometry: [{ lon: -72.58, lat: 44.26 }, { lon: -72.7, lat: 44.35 }, { lon: -72.82, lat: 44.47 }],
  distanceMeters: 30_000,
  durationSeconds: 1_900,
  instructions: [{ text: "Turn left onto VT 100.", type: "turn", maneuver: "left", distanceMeters: 30_000, durationSeconds: 1_900, geometryIndex: 0 }],
};

function fakeRouter(answer: BasicRoute | Error = LINE): ValhallaRouter & { calls: ProviderRouteRequest[] } {
  const calls: ProviderRouteRequest[] = [];
  return {
    upstream: "fossgis",
    calls,
    async route(request) {
      calls.push(request);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

function graphHopper(answer: ProviderCandidateSet | Error): RouteCandidateProvider & { calls: number } {
  const provider = {
    id: "gh",
    calls: 0,
    capabilities: () => ({ profiles: ["motorcycle_twisty"], supportsAlternatives: false, supportsAvoidPolygons: true }),
    async candidates(): Promise<ProviderCandidateSet> {
      provider.calls += 1;
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return provider;
}

const coverage = async () => BOX;

describe("coverage decision", () => {
  it("any point outside the router's box leaves coverage", () => {
    expect(leavesCoverage(PA, BOX)).toBe(false);
    expect(leavesCoverage(VERMONT, BOX)).toBe(true);
    expect(leavesCoverage({ ...PA, shaping: [{ lon: -72.5, lat: 44 }] }, BOX)).toBe(true);
    expect(leavesCoverage({ ...PA, stops: [{ lon: -105, lat: 39.7 }] }, BOX)).toBe(true);
  });
  it("an unknown box is not outside", () => {
    expect(leavesCoverage(VERMONT, null)).toBe(false);
  });
});

describe("planRide outside the tuned area", () => {
  it("a Vermont ride gets a labelled, unscored basic route and never asks GraphHopper", async () => {
    const router = fakeRouter();
    const gh = graphHopper(new Error("must not be asked"));
    const result = await planRide({ identity: IDENTITY, request: VERMONT }, { provider: gh, basicRouter: router, coverage, env: {} });
    expect(gh.calls).toBe(0);
    expect(router.calls).toHaveLength(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [candidate] = result.bundle.candidates;
    expect(candidate!.provider.providerId).toBe("valhalla-fossgis");
    expect(candidate!.warnings).toEqual([expect.objectContaining({ code: "basic-routing", message: BASIC_ROUTE_COPY["outside-coverage"] })]);
    // Unknown stays unknown: no surface, closure or access evidence, a zero score.
    expect(candidate!.evidence).toEqual({});
    expect(candidate!.score.total).toBe(0);
    expect(Object.values(candidate!.score.components).every((component) => component.evidenceStatus === "unknown")).toBe(true);
    expect(result.bundle.policyVersion).toBe("basic-v1");
    expect(candidate!.instructions).toHaveLength(1);
  });

  it("a PA ride still goes to GraphHopper", async () => {
    const router = fakeRouter();
    const gh = graphHopper({ candidates: [{ providerId: "gh", profile: "motorcycle_twisty", geometry: [PA.origin, { lon: -75.67, lat: 40.83 }, PA.destination], distanceMeters: 8_000, durationSeconds: 600 }] });
    const result = await planRide({ identity: IDENTITY, request: PA }, { provider: gh, basicRouter: router, coverage, env: {}, roadAuthority: null });
    expect(gh.calls).toBeGreaterThan(0);
    expect(router.calls).toHaveLength(0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bundle.candidates[0]!.warnings.some((warning) => warning.code === "basic-routing")).toBe(false);
  });

  it("GraphHopper's own off-graph answer inside its box becomes a basic route", async () => {
    const router = fakeRouter();
    const gh = graphHopper(new GraphHopperProviderError("Part of this ride is outside the routing coverage.", "outside-coverage"));
    const result = await planRide({ identity: IDENTITY, request: PA }, { provider: gh, basicRouter: router, coverage: async () => null, env: {}, roadAuthority: null });
    expect(router.calls).toHaveLength(1);
    expect(result.ok).toBe(true);
  });

  it("when our router is down, a basic route is labelled as such", async () => {
    const router = fakeRouter();
    const gh = graphHopper(new GraphHopperProviderError("The routing service could not be reached.", "provider-unavailable", { recoverable: true }));
    const result = await planRide({ identity: IDENTITY, request: PA }, { provider: gh, basicRouter: router, coverage: async () => null, env: {}, roadAuthority: null });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bundle.candidates[0]!.warnings[0]!.message).toBe(BASIC_ROUTE_COPY["router-down"]);
  });

  it("if both routers fail, the rider sees our router's error", async () => {
    const router = fakeRouter(new ValhallaRoutingError("provider-unavailable", VALHALLA_COPY.busy, true));
    const gh = graphHopper(new GraphHopperProviderError("The routing service could not be reached.", "provider-unavailable", { recoverable: true }));
    const result = await planRide({ identity: IDENTITY, request: PA }, { provider: gh, basicRouter: router, coverage: async () => null, env: {}, roadAuthority: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("provider-unavailable");
  });

  it("a busy basic service outside coverage is a clear error, never a line", async () => {
    const router = fakeRouter(new ValhallaRoutingError("provider-unavailable", VALHALLA_COPY.busy, true));
    const result = await planRide({ identity: IDENTITY, request: VERMONT }, { provider: graphHopper({ candidates: [] }), basicRouter: router, coverage, env: {} });
    expect(result).toEqual({ ok: false, error: { code: "provider-unavailable", message: VALHALLA_COPY.busy, recoverable: true } });
  });

  it("loops and road choices outside coverage say plainly they are tuned-area only", async () => {
    const router = fakeRouter();
    const loop = await planRide({ identity: IDENTITY, request: { ...VERMONT, destination: VERMONT.origin, discovery: { targetMinutes: 90, toleranceMinutes: 15 } } }, { provider: graphHopper({ candidates: [] }), basicRouter: router, coverage, env: {} });
    expect(loop).toMatchObject({ ok: false, error: { code: "outside-coverage", message: BASIC_LOOP_COPY } });
    const spans = await planRide({ identity: IDENTITY, request: { ...VERMONT, roadSpans: [{ id: "s", mode: "avoid", direction: "either", anchors: [VERMONT.origin, VERMONT.destination] }] } }, { provider: graphHopper({ candidates: [] }), basicRouter: router, coverage, env: {} });
    expect(spans).toMatchObject({ ok: false, error: { code: "constraint-conflict", message: BASIC_ROAD_CHOICES_COPY } });
    expect(router.calls).toHaveLength(0);
  });

  it("is off when a provider is injected without a basic router", async () => {
    const gh = graphHopper(new GraphHopperProviderError("x", "provider-unavailable", { recoverable: true }));
    const result = await planRide({ identity: IDENTITY, request: VERMONT }, { provider: gh, coverage, env: {} });
    expect(gh.calls).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
  });
});

