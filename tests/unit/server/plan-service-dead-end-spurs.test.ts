import { describe, expect, it } from "vitest";
import { planRide } from "@/server/planning/plan-service";
import { findDeadEndSpurs } from "@/domain/geometry/dead-end-spurs";
import type { GravelAtlasPort } from "@/application/roads/gravel-atlas";
import type { ProviderCandidate, ProviderRouteRequest, RouteCandidateProvider } from "@/application/planner/route-provider";

const O = { lat: 40, lon: -75 };
const p = (east: number, north = 0) => ({ lat: O.lat + north / 111195, lon: O.lon + east / (111195 * Math.cos(O.lat * Math.PI / 180)) });
/** A square loop to the west, 1.5 km a side. */
const clean = [O, p(0, 1500), p(-1500, 1500), p(-1500), O];
/** A square loop to the east that first rides 600 m down a side road to its end and back. */
const retracing = [O, p(1500), p(2100), p(1500), p(1500, 1500), p(0, 1500), O];

const candidate = (geometry: ProviderCandidate["geometry"], seconds: number): ProviderCandidate => ({
  providerId: "test", profile: "motorcycle_twisty", geometry,
  distanceMeters: seconds * 4, durationSeconds: seconds,
  roadSummary: { totalMeters: seconds * 4, surfaceByRoadClassMeters: { "asphalt|tertiary": seconds * 4 }, curvatureMeters: {}, tollMeters: 0 },
});
const providerOf = (...routes: ProviderCandidate[]): RouteCandidateProvider => ({
  id: "test",
  capabilities: () => ({ profiles: ["motorcycle_twisty", "motorcycle_fastest"], supportsAlternatives: true, supportsAvoidPolygons: true }),
  candidates: async () => ({ candidates: routes }),
});
const noAtlas: GravelAtlasPort = { availability: () => ({ available: false, path: null, schemaVersion: null, corridorCount: 0 }), corridorsNear: () => [] };
const env = { OGV_FUN_GENERATORS: "off", OGV_TRAFFIC_LIVE_AVOID: "off", OGV_ATLAS_GENERATORS: "off" };
const loop: ProviderRouteRequest = {
  requestId: "spurs_loop", origin: O, destination: O, stops: [], shaping: [], avoidPolygons: [], profile: "motorcycle_twisty",
  discovery: { targetMinutes: 30, toleranceMinutes: 4.5 },
  options: { vehicle: "motorcycle", includeAlternatives: true, avoidHighways: false, tollPolicy: "avoid", traffic: "minimize-delay" },
};
const plan = (request: ProviderRouteRequest, provider: RouteCandidateProvider) =>
  planRide({ identity: { rideId: "ride_spurs", rideRevision: 1, planningGeneration: 1 }, request }, { provider, gravelAtlas: noAtlas, env, roadAuthority: null, funCharacterClassifier: null });

describe("planning a ride that must not ride down a dead-end road and back", () => {
  it("offers the loop without the spur and never shows the one with it", async () => {
    // The retracing loop is the better fit for the ride time, but it is not offered.
    const result = await plan(loop, providerOf(candidate(retracing, 1800), candidate(clean, 1860)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.candidates.length).toBeGreaterThan(0);
    for (const shown of result.bundle.candidates) {
      expect(findDeadEndSpurs(shown.geometry)).toHaveLength(0);
      expect(shown.warnings.map((warning) => warning.code)).not.toContain("dead-end-spur");
    }
    expect(result.bundle.candidates.some((shown) => shown.geometry.length === clean.length)).toBe(true);
    const best = result.bundle.candidates.find((shown) => shown.id === result.bundle.roles["best-ride"]);
    expect(best?.geometry).toHaveLength(clean.length);
  });

  it("still gives a route when every loop retraces, and says so", async () => {
    const result = await plan(loop, providerOf(candidate(retracing, 1800)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const best = result.bundle.candidates.find((shown) => shown.id === result.bundle.roles["best-ride"]);
    expect(best).toBeDefined();
    expect(best!.warnings.map((warning) => warning.code)).toContain("dead-end-spur");
    expect(best!.warnings.find((warning) => warning.code === "dead-end-spur")?.message).toMatch(/dead-end road and back/);
  });

  it("leaves a rider's own stop alone, even down a dead end", async () => {
    const toStop: ProviderRouteRequest = {
      ...loop, requestId: "spurs_stop", destination: p(0, 1500), stops: [p(2100)],
    };
    delete (toStop as { discovery?: unknown }).discovery;
    const result = await plan(toStop, providerOf(candidate(retracing, 1800)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.candidates.every((shown) => !shown.warnings.some((warning) => warning.code === "dead-end-spur"))).toBe(true);
  });
});
