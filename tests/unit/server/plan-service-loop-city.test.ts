/**
 * A loop from the edge of a city heads out to the countryside (owner
 * 2026-11-13, "loop into Philly"). From Hatboro, PA the planner used to pick a
 * loop south-west into Philadelphia's suburbs and city streets over an equally
 * long loop north through farm country, because suburb and countryside
 * scored the same. Both lines here are real router answers for that start.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planRide } from "@/server/planning/plan-service";
import { bearingDegrees, loopCentroid } from "@/application/planner/loop-heading";
import type { GravelAtlasPort } from "@/application/roads/gravel-atlas";
import type { ProviderCandidate, ProviderRoadRun, ProviderRouteRequest, RouteCandidateProvider } from "@/application/planner/route-provider";
import type { RoadCharacterIntent } from "@/domain/ride/types";

interface FixtureLoop {
  readonly providerId: string;
  readonly profile: string;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly geometry: readonly (readonly [number, number])[];
  readonly roadSummary: ProviderCandidate["roadSummary"] & { readonly roadRuns: readonly Partial<ProviderRoadRun>[] };
}
const fixture = JSON.parse(readFileSync("tests/fixtures/route-plan/hatboro-loops.json", "utf8")) as {
  readonly start: { readonly lat: number; readonly lon: number };
  readonly intoPhiladelphia: FixtureLoop;
  readonly northToFarms: FixtureLoop;
};
const candidate = (loop: FixtureLoop): ProviderCandidate => ({
  providerId: loop.providerId, profile: loop.profile, distanceMeters: loop.distanceMeters, durationSeconds: loop.durationSeconds,
  geometry: loop.geometry.map(([lon, lat]) => ({ lon, lat })),
  roadSummary: {
    ...loop.roadSummary!,
    roadRuns: loop.roadSummary.roadRuns.map(run => ({ durationSeconds: null, curvatureRatio: null, toll: null, ...run }) as ProviderRoadRun),
  },
});
const city = candidate(fixture.intoPhiladelphia);
const farms = candidate(fixture.northToFarms);

const providerOf = (...routes: ProviderCandidate[]): RouteCandidateProvider => ({
  id: "test",
  capabilities: () => ({ profiles: ["motorcycle_scenic", "motorcycle_twisty", "motorcycle_fastest"], supportsAlternatives: true, supportsAvoidPolygons: true }),
  candidates: async () => ({ candidates: routes }),
});
const noAtlas: GravelAtlasPort = { availability: () => ({ available: false, path: null, schemaVersion: null, corridorCount: 0 }), corridorsNear: () => [] };
const env = { OGV_RIDER_MODES: "on", OGV_DIRT_LOOP_GENERATORS: "off", OGV_TRAFFIC_LIVE_AVOID: "off" };

/** The default "Make my loop": 2 h, Balanced roads, Mixed surface. */
const loopRequest = (roadCharacter: RoadCharacterIntent): ProviderRouteRequest => ({
  requestId: `loop_city_${roadCharacter}`, origin: fixture.start, destination: fixture.start, stops: [], shaping: [], avoidPolygons: [],
  profile: "motorcycle_fastest",
  discovery: { targetMinutes: 120, toleranceMinutes: 18 },
  options: {
    vehicle: "motorcycle", includeAlternatives: true, avoidHighways: false, tollPolicy: "avoid", traffic: "protect-ride",
    surfacePreference: "mixed", roadCharacter, bike: { category: "touring", maintainedGravel: "allow", roughTracks: "avoid" },
  },
});

async function bestRide(roadCharacter: RoadCharacterIntent, ...routes: ProviderCandidate[]) {
  const result = await planRide(
    { identity: { rideId: "ride_loop_city", rideRevision: 1, planningGeneration: 1 }, request: loopRequest(roadCharacter) },
    { provider: providerOf(...routes), gravelAtlas: noAtlas, env, roadAuthority: null },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  const best = result.bundle.candidates.find(shown => shown.id === result.bundle.roles["best-ride"]);
  expect(best).toBeDefined();
  return { best: best!, bundle: result.bundle };
}
const heading = (route: { readonly geometry: ProviderCandidate["geometry"] }) => bearingDegrees(fixture.start, loopCentroid(route.geometry)!);

describe("a loop from the edge of a city", () => {
  it("is the real case: one loop heads south-west into Philadelphia, the other north-west", () => {
    expect(heading(city)).toBeGreaterThan(200);
    expect(heading(city)).toBeLessThan(260);
    expect(Math.min(...city.geometry.map(point => point.lat))).toBeLessThan(40.0);
    expect(heading(farms)).toBeLessThan(60);
  });

  it("picks the countryside loop over the one into the city, whichever the router sends first", async () => {
    for (const order of [[city, farms], [farms, city]]) {
      const { best } = await bestRide("balanced", ...order);
      expect(heading(best)).toBeLessThan(60);
      expect(best.score.components.junctionFriction.input).not.toBeNull();
    }
  });

  it("measures time in town on both loops, and the city loop has more of it", async () => {
    const { bundle } = await bestRide("balanced", city, farms);
    const friction = (route: ProviderCandidate) => bundle.candidates.find(shown => shown.distanceMeters === route.distanceMeters)?.score.components.junctionFriction.input;
    expect(friction(city)).toBeGreaterThan(friction(farms)! + 0.15);
  });

  it("does the same for a Curvy loop", async () => {
    const { best } = await bestRide("curvy", city, farms);
    expect(heading(best)).toBeLessThan(60);
  });

  it("leaves Fast rides as they were: time in town is not scored there", async () => {
    const { best } = await bestRide("efficient", city, farms);
    expect(best.score.components.junctionFriction.input).toBeNull();
  });
});
