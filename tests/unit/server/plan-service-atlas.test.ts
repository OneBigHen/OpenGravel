import { expect, it, vi } from "vitest";
import { planRide } from "@/server/planning/plan-service";
import type { GravelAtlasPort } from "@/application/roads/gravel-atlas";
import type { ProviderRouteRequest, RouteCandidateProvider } from "@/application/planner/route-provider";
const request: ProviderRouteRequest = { requestId: "atlas_plan", origin: { lat: 40, lon: -75 }, destination: { lat: 40.1, lon: -75 }, stops: [], shaping: [], avoidPolygons: [], profile: "motorcycle_adventure", options: { vehicle: "motorcycle", includeAlternatives: true, avoidHighways: false, tollPolicy: "avoid", surfacePreference: "dirt-preferred", traffic: "minimize-delay" } };
const provider: RouteCandidateProvider = { id: "test", capabilities: () => ({ profiles: ["motorcycle_adventure", "motorcycle_fastest"], supportsAlternatives: true, supportsAvoidPolygons: true }), candidates: async () => ({ candidates: [{ providerId: "test", profile: "motorcycle_adventure", geometry: [request.origin, request.destination], distanceMeters: 10000, durationSeconds: 900, roadSummary: { totalMeters: 10000, surfaceByRoadClassMeters: { "gravel|unclassified": 10000 }, curvatureMeters: {}, tollMeters: 0 } }] }) };
const makeAtlas = (): GravelAtlasPort => ({ availability: () => ({ available: true, path: null, schemaVersion: 3, corridorCount: 0 }), corridorsNear: vi.fn(() => []) });
it("queries the new atlas for full dirt plans even when the research generator family is off", async () => {
  const atlas = makeAtlas();
  const result = await planRide({ identity: { rideId: "ride_atlas", rideRevision: 1, planningGeneration: 1 }, request }, { provider, gravelAtlas: atlas, env: { OGV_FUN_GENERATORS: "off", OGV_TRAFFIC_LIVE_AVOID: "off" }, roadAuthority: null, funCharacterClassifier: null });
  expect(result.ok).toBe(true);
  expect(atlas.corridorsNear).toHaveBeenCalled();
});
it("the rider kill switch prevents atlas queries", async () => {
  const atlas = makeAtlas();
  await planRide({ identity: { rideId: "ride_atlas", rideRevision: 1, planningGeneration: 1 }, request }, { provider, gravelAtlas: atlas, env: { OGV_RIDER_MODES: "off" }, roadAuthority: null, funCharacterClassifier: null });
  expect(atlas.corridorsNear).not.toHaveBeenCalled();
});

it("does not query the atlas for a first-route answer", async () => {
  const atlas = makeAtlas();
  const result = await planRide({ identity: { rideId: "ride_atlas", rideRevision: 1, planningGeneration: 1 }, request: { ...request, options: { ...request.options, includeAlternatives: false } } }, { provider, gravelAtlas: atlas, env: { OGV_FUN_GENERATORS: "off" }, roadAuthority: null, funCharacterClassifier: null });
  expect(result.ok).toBe(true);
  expect(atlas.corridorsNear).not.toHaveBeenCalled();
});

it("queries dirt for Mixed loops without a redundant fastest-loop baseline", async () => {
  const atlas = makeAtlas();
  const candidates = vi.fn(async (asked: ProviderRouteRequest, signal: AbortSignal) => {
    const answer = await provider.candidates(asked, signal);
    return { candidates: answer.candidates.map(candidate => ({ ...candidate, durationSeconds: 30 * 60, geometry: [asked.origin, { lon: asked.origin.lon + 0.01, lat: asked.origin.lat + 0.01 }, asked.origin] })) };
  });
  const loop = { ...request, destination: request.origin, discovery: { targetMinutes: 30, toleranceMinutes: 4.5 }, options: { ...request.options, surfacePreference: "mixed" as const } };
  const result = await planRide({ identity: { rideId: "ride_atlas", rideRevision: 1, planningGeneration: 1 }, request: loop }, { provider: { ...provider, candidates }, gravelAtlas: atlas, env: { OGV_FUN_GENERATORS: "off", OGV_TRAFFIC_LIVE_AVOID: "off" }, roadAuthority: null, funCharacterClassifier: null });
  expect(result.ok).toBe(true);
  expect(atlas.corridorsNear).toHaveBeenCalledWith(expect.anything(), "dirt", expect.anything());
  expect(candidates.mock.calls.some(([asked]) => asked.requestId.endsWith(":fastest"))).toBe(false);
});

it.each(["pavement", "mostly-pavement"] as const)("retains the existing atlas baseline for %s loops on a dual-sport", async surface => {
  const candidates = vi.fn(async (asked: ProviderRouteRequest, signal: AbortSignal) => {
    const answer = await provider.candidates(asked, signal);
    return { candidates: answer.candidates.map(candidate => ({ ...candidate, durationSeconds: 30 * 60, geometry: [asked.origin, { lon: asked.origin.lon + 0.01, lat: asked.origin.lat + 0.01 }, asked.origin] })) };
  });
  const loop: ProviderRouteRequest = { ...request, destination: request.origin, discovery: { targetMinutes: 30, toleranceMinutes: 4.5 }, options: { ...request.options, surfacePreference: surface, bike: { category: "dual-sport", maintainedGravel: "allow", roughTracks: "avoid" } } };
  const result = await planRide({ identity: { rideId: "ride_atlas", rideRevision: 1, planningGeneration: 1 }, request: loop }, { provider: { ...provider, candidates }, gravelAtlas: makeAtlas(), env: { OGV_FUN_GENERATORS: "off", OGV_TRAFFIC_LIVE_AVOID: "off" }, roadAuthority: null, funCharacterClassifier: null });
  expect(result.ok).toBe(true);
  expect(candidates.mock.calls.some(([asked]) => asked.requestId.endsWith(":fastest"))).toBe(true);
});

it.each(["dirt-preferred", "mixed", "pavement", "mostly-pavement"] as const)("limits the dedicated atlas override to dirt-seeking loops: %s", async surface => {
  const atlas = makeAtlas();
  const loopProvider: RouteCandidateProvider = { ...provider, candidates: async (asked, signal) => {
    const answer = await provider.candidates(asked, signal);
    return { candidates: answer.candidates.map(candidate => ({ ...candidate, durationSeconds: 30 * 60, geometry: [asked.origin, { lon: asked.origin.lon + 0.01, lat: asked.origin.lat + 0.01 }, asked.origin] })) };
  } };
  const env = { OGV_ATLAS_GENERATORS: "off", OGV_DIRT_LOOP_GENERATORS: "on", OGV_FUN_GENERATORS: "off", OGV_TRAFFIC_LIVE_AVOID: "off" };
  const loop: ProviderRouteRequest = { ...request, destination: request.origin, discovery: { targetMinutes: 30, toleranceMinutes: 4.5 }, options: { ...request.options, surfacePreference: surface } };
  const result = await planRide({ identity: { rideId: "ride_atlas", rideRevision: 1, planningGeneration: 1 }, request: loop }, { provider: loopProvider, gravelAtlas: atlas, env, roadAuthority: null, funCharacterClassifier: null });
  expect(result.ok).toBe(true);
  expect(atlas.corridorsNear).toHaveBeenCalledTimes(surface === "mixed" || surface === "dirt-preferred" ? 1 : 0);
  const pointAtlas = makeAtlas();
  await planRide({ identity: { rideId: "ride_atlas", rideRevision: 1, planningGeneration: 1 }, request: { ...request, options: { ...request.options, surfacePreference: surface } } }, { provider, gravelAtlas: pointAtlas, env, roadAuthority: null, funCharacterClassifier: null });
  expect(pointAtlas.corridorsNear).not.toHaveBeenCalled();
});
