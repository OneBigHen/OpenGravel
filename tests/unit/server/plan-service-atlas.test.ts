import { expect, it, vi } from "vitest";
import { planRide } from "@/server/planning/plan-service";
import type { GravelAtlasPort } from "@/application/roads/gravel-atlas";
import type { ProviderRouteRequest, RouteCandidateProvider } from "@/application/planner/route-provider";
const request: ProviderRouteRequest = { requestId: "atlas_plan", origin: { lat: 40, lon: -75 }, destination: { lat: 40.1, lon: -75 }, stops: [], shaping: [], avoidPolygons: [], profile: "motorcycle_adventure", options: { vehicle: "motorcycle", includeAlternatives: false, avoidHighways: false, tollPolicy: "avoid", surfacePreference: "dirt-preferred", traffic: "minimize-delay" } };
const provider: RouteCandidateProvider = { id: "test", capabilities: () => ({ profiles: ["motorcycle_adventure", "motorcycle_fastest"], supportsAlternatives: true, supportsAvoidPolygons: true }), candidates: async () => ({ candidates: [{ providerId: "test", profile: "motorcycle_adventure", geometry: [request.origin, request.destination], distanceMeters: 10000, durationSeconds: 900, roadSummary: { totalMeters: 10000, surfaceByRoadClassMeters: { "gravel|unclassified": 10000 }, curvatureMeters: {}, tollMeters: 0 } }] }) };
const makeAtlas = (): GravelAtlasPort => ({ availability: () => ({ available: true, path: null, schemaVersion: 3, corridorCount: 0 }), corridorsNear: vi.fn(() => []) });
it("queries the new atlas for dirt routes even when the research generator family is off", async () => {
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
