import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createGraphHopperProvider } from "@/infrastructure/routing/graphhopper/provider";
import { planRide } from "@/server/planning/plan-service";
import type { ProviderCandidate, ProviderRouteRequest, RouteCandidateProvider } from "@/application/planner/route-provider";
import { analyzeFrancoCurvature } from "@/domain/geometry/franco-curvature";
import { DEFAULT_BIKE } from "@/domain/ride/create";
import { analyzeBends } from "@/domain/geometry/bends";

const url = process.env.GRAPHHOPPER_URL ?? "http://127.0.0.1:8989";
const enabled = process.env.OGV_FUN_BEST_RIDE_LIVE === "1";
const reachable = enabled && await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) }).then(r => r.ok, () => false);
const live = reachable ? describe : describe.skip;
const rows: unknown[] = [];
const origin = { lon: -75.7387, lat: 40.8636 };
function measure(candidate: Pick<ProviderCandidate, "geometry" | "durationSeconds" | "distanceMeters">) {
  const franco = analyzeFrancoCurvature(candidate.geometry);
  return { minutes: +(candidate.durationSeconds / 60).toFixed(2), miles: +(candidate.distanceMeters / 1609.344).toFixed(2), curvyMiles: +(analyzeBends(candidate.geometry).bendMeters / 1609.344).toFixed(2), francoPerKm: +franco.curvaturePerKm.toFixed(2) };
}
/** Run explicitly: OGV_FUN_BEST_RIDE_LIVE=1 npm run test:real-router -- tests/real-router/fun-best-ride-live.test.ts.
 * Optional OGV_FUN_BEST_RIDE_EVIDENCE writes aggregate measurements, never geometry.
 * Fixed request IDs make the router's loop seeds reproducible across revisions.
 */
live("fun Best Ride (opt-in live measurement)", () => {
  for (const style of ["balanced", "efficient", "curvy"] as const) {
  for (const loop of [false, true]) {
    it(`${style}: ${loop ? "Jim Thorpe 120 minute loop" : "Jim Thorpe to Hawk Mountain"}`, { timeout: 120_000 }, async () => {
      const inner = createGraphHopperProvider({ baseUrl: url });
      const calls: unknown[] = [];
      const provider: RouteCandidateProvider = {
        id: inner.id, capabilities: () => inner.capabilities(),
        async candidates(request, signal) {
          const result = await inner.candidates(request, signal);
          calls.push({ profile: request.profile, alternatives: request.options.includeAlternatives, factor: request.options.riderModeFactor, candidates: result.candidates.map(c => ({ ...measure(c), profile: c.profile })) });
          return result;
        },
      };
      const request: ProviderRouteRequest = {
        requestId: loop ? "fun-best-loop-120" : "fun-best-destination",
        origin, destination: loop ? origin : { lon: -75.9832, lat: 40.6364 },
        stops: [], shaping: [], avoidPolygons: [], profile: style === "curvy" ? "motorcycle_twisty" : "motorcycle_fastest",
        options: { includeAlternatives: true, avoidHighways: false, tollPolicy: "avoid", surfacePreference: "mixed", roadCharacter: style, traffic: "protect-ride", vehicle: "motorcycle", bike: DEFAULT_BIKE },
        ...(loop ? { discovery: { targetMinutes: 120, toleranceMinutes: 15 } } : {}),
      };
      const started = performance.now();
      const result = await planRide({ identity: { rideId: "fun-best", rideRevision: 1, planningGeneration: 1 }, request }, { provider, env: {}, roadAuthority: null,  funCharacterClassifier: null });
      expect(result.ok).toBe(true);
      if (!result.ok) { console.log(result.error); return; }
      const best = result.bundle.candidates.find(c => c.id === result.bundle.roles["best-ride"]);
      expect(best).toBeDefined();
      const row = { style, loop, elapsedMs: Math.round(performance.now() - started), best: best && measure(best), candidates: result.bundle.candidates.map(c => ({ ...measure(c), score: c.score.total, components: c.score.components })), calls, diagnostics: result.diagnostics };
      rows.push(row);
      console.log(JSON.stringify(row));
      if (process.env.OGV_FUN_BEST_RIDE_EVIDENCE) writeFileSync(process.env.OGV_FUN_BEST_RIDE_EVIDENCE, JSON.stringify(rows, null, 2));
    });
  }
  }
});
