import { describe, expect, it } from "vitest";
import { buildRoutingMethodComparison } from "@/application/planner/routing-method-comparison";
import { defaultRideIntent } from "@/domain/ride/create";
import { asGeometryRef, newRideId } from "@/domain/ride/ids";
import type { RouteBundle } from "@/domain/route/types";
import { createGraphHopperProvider } from "@/infrastructure/routing/graphhopper/provider";
import { planRide } from "@/server/planning/plan-service";

const url = process.env.GRAPHHOPPER_URL ?? "http://127.0.0.1:8989";
const reachable = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1_500) }).then((response) => response.ok, () => false);
const live = reachable ? describe : describe.skip;

live("live routing method comparison", () => {
  it("compares real eligible profiles and carries measured sustained curves without selecting", async () => {
    const rideId = newRideId();
    const result = await planRide({
      identity: { rideId, rideRevision: 1, planningGeneration: 1 },
      request: {
        requestId: "live_method_comparison", origin: { lon: -75.4714, lat: 40.6023 }, destination: { lon: -75.1946, lat: 40.9868 },
        stops: [], shaping: [], avoidPolygons: [], profile: "motorcycle_twisty",
        options: { includeAlternatives: true, avoidHighways: false, tollPolicy: "avoid", surfacePreference: "pavement", roadCharacter: "curvy", vehicle: "motorcycle" },
      },
    }, { provider: createGraphHopperProvider({ baseUrl: url }), env: {}, roadAuthority: null, funCharacterClassifier: null });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.code);
    const candidates = result.bundle.candidates.map(({ geometry, ...candidate }, index) => {
      expect(geometry.length).toBeGreaterThan(1);
      expect(candidate.eligibility.eligible).toBe(true);
      const curvature = candidate.evidence.curvature?.value as Record<string, unknown>;
      expect(curvature.longestRunMeters).toBeTypeOf("number");
      expect(curvature.curvyMeters).toBeGreaterThanOrEqual(curvature.longestRunMeters as number);
      return { ...candidate, geometryRef: asGeometryRef(`live_comparison_${index}`) };
    });
    const bundle: RouteBundle = { ...result.bundle, candidates, rideId, rideRevision: 1, planningGeneration: 1, createdAt: new Date().toISOString() };
    const before = JSON.stringify(bundle);
    const comparison = buildRoutingMethodComparison({ bundle, selectedRouteId: bundle.selectedRouteId, intent: { ...defaultRideIntent(), roadCharacter: "curvy" }, stale: false });
    expect(comparison.methods[1]?.routeId).not.toBeNull();
    expect(comparison.methods[2]?.routeId).not.toBeNull();
    expect(comparison.methods.every((method) => candidates.some((candidate) => candidate.id === method.routeId))).toBe(true);
    expect(comparison.jev.state).toBe("unavailable");
    expect(JSON.stringify(bundle)).toBe(before);
  });
});
