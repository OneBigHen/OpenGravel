import { expect, it, vi } from "vitest";
import { planRide } from "@/server/planning/plan-service";
import type { GravelAtlasPort } from "@/application/roads/gravel-atlas";
import type { ProviderRouteRequest, RouteCandidateProvider } from "@/application/planner/route-provider";
const request: ProviderRouteRequest = { requestId: "atlas_plan", origin: { lat: 40, lon: -75 }, destination: { lat: 40.1, lon: -75 }, stops: [], shaping: [], avoidPolygons: [], profile: "motorcycle_adventure", options: { vehicle: "motorcycle", includeAlternatives: true, avoidHighways: false, tollPolicy: "avoid", surfacePreference: "dirt-preferred", traffic: "minimize-delay" } };
const provider: RouteCandidateProvider = { id: "test", capabilities: () => ({ profiles: ["motorcycle_adventure", "motorcycle_fastest"], supportsAlternatives: true, supportsAvoidPolygons: true }), candidates: async () => ({ candidates: [{ providerId: "test", profile: "motorcycle_adventure", geometry: [request.origin, request.destination], distanceMeters: 10000, durationSeconds: 900, roadSummary: { totalMeters: 10000, surfaceByRoadClassMeters: { "gravel|unclassified": 10000 }, curvatureMeters: {}, tollMeters: 0 } }] }) };
const makeAtlas = (): GravelAtlasPort => ({ availability: () => ({ available: true, path: null, schemaVersion: 3, corridorCount: 0 }), corridorsNear: vi.fn(() => []) });
const loop = (surface: "mixed" | "dirt-preferred" | "pavement" | "mostly-pavement"): ProviderRouteRequest => ({ ...request, destination: request.origin, discovery: { targetMinutes: 30, toleranceMinutes: 4.5 }, options: { ...request.options, surfacePreference: surface } });
const loopProvider = (): RouteCandidateProvider => ({ ...provider, candidates: async (asked, signal) => {
  const answer = await provider.candidates(asked, signal);
  return { candidates: answer.candidates.map(candidate => ({ ...candidate, durationSeconds: 30 * 60, geometry: [asked.origin, { lon: asked.origin.lon + 0.01, lat: asked.origin.lat + 0.01 }, asked.origin] })) };
} });

it("never queries the atlas for a point-to-point plan", async () => {
  const atlas = makeAtlas();
  const result = await planRide({ identity: { rideId: "ride_atlas", rideRevision: 1, planningGeneration: 1 }, request }, { provider, gravelAtlas: atlas, env: { OGV_DIRT_LOOP_GENERATORS: "on", OGV_TRAFFIC_LIVE_AVOID: "off" }, roadAuthority: null });
  expect(result.ok).toBe(true);
  expect(atlas.corridorsNear).not.toHaveBeenCalled();
});

it("the rider kill switch prevents atlas queries", async () => {
  const atlas = makeAtlas();
  await planRide({ identity: { rideId: "ride_atlas", rideRevision: 1, planningGeneration: 1 }, request: loop("mixed") }, { provider: loopProvider(), gravelAtlas: atlas, env: { OGV_RIDER_MODES: "off", OGV_DIRT_LOOP_GENERATORS: "on" }, roadAuthority: null });
  expect(atlas.corridorsNear).not.toHaveBeenCalled();
});

it("does not query the atlas for a first-route answer", async () => {
  const atlas = makeAtlas();
  const first = loop("mixed");
  const result = await planRide({ identity: { rideId: "ride_atlas", rideRevision: 1, planningGeneration: 1 }, request: { ...first, options: { ...first.options, includeAlternatives: false } } }, { provider: loopProvider(), gravelAtlas: atlas, env: { OGV_DIRT_LOOP_GENERATORS: "on" }, roadAuthority: null });
  expect(result.ok).toBe(true);
  expect(atlas.corridorsNear).not.toHaveBeenCalled();
});

it("queries dirt for Mixed loops without a redundant fastest-loop baseline", async () => {
  const atlas = makeAtlas();
  const candidates = vi.fn(loopProvider().candidates);
  const result = await planRide({ identity: { rideId: "ride_atlas", rideRevision: 1, planningGeneration: 1 }, request: loop("mixed") }, { provider: { ...provider, candidates }, gravelAtlas: atlas, env: { OGV_DIRT_LOOP_GENERATORS: "on", OGV_TRAFFIC_LIVE_AVOID: "off" }, roadAuthority: null });
  expect(result.ok).toBe(true);
  expect(atlas.corridorsNear).toHaveBeenCalledWith(expect.anything(), "dirt", expect.anything());
  expect(candidates.mock.calls.some(([asked]) => asked.requestId.endsWith(":fastest"))).toBe(false);
});

it.each(["dirt-preferred", "mixed", "pavement", "mostly-pavement"] as const)("limits the dirt-loop atlas to dirt-seeking loops: %s", async surface => {
  const atlas = makeAtlas();
  const env = { OGV_DIRT_LOOP_GENERATORS: "on", OGV_TRAFFIC_LIVE_AVOID: "off" };
  const result = await planRide({ identity: { rideId: "ride_atlas", rideRevision: 1, planningGeneration: 1 }, request: loop(surface) }, { provider: loopProvider(), gravelAtlas: atlas, env, roadAuthority: null });
  expect(result.ok).toBe(true);
  expect(atlas.corridorsNear).toHaveBeenCalledTimes(surface === "mixed" || surface === "dirt-preferred" ? 1 : 0);
  const pointAtlas = makeAtlas();
  await planRide({ identity: { rideId: "ride_atlas", rideRevision: 1, planningGeneration: 1 }, request: { ...request, options: { ...request.options, surfacePreference: surface } } }, { provider, gravelAtlas: pointAtlas, env, roadAuthority: null });
  expect(pointAtlas.corridorsNear).not.toHaveBeenCalled();
});
