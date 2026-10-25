import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { createGraphHopperProvider } from "@/infrastructure/routing/graphhopper/provider";
import { createRoadAuthorityCoordinator } from "@/application/route-intelligence/coordinator";
import { roadAuthoritySourcesFromEnv } from "@/server/planning/road-authority";
import { boundingBoxOf, padBox } from "@/application/route-intelligence/match";
import { handleRoutePlanRequest } from "@/server/planning/route-handler";
import { planRide } from "@/server/planning/plan-service";
import { haversine } from "@/domain/geometry/analysis";
import type { ProviderCandidate, RouteCandidateProvider } from "@/application/planner/route-provider";

// Opt-in; six handler requests, with all router calls counted in the evidence.
// OGV_FINAL_APPROACH_LIVE=on GRAPHHOPPER_URL=http://127.0.0.1:18989 npm run test:real-router -- tests/real-router/final-approach-live.test.ts --maxWorkers=2

const parks = [
  { name: "Hawk Mountain Sanctuary", lat: 40.6288, lon: -75.9772 },
  { name: "Hickory Run State Park", lat: 41.0262, lon: -75.6966 },
  { name: "Ricketts Glen State Park", lat: 41.3352, lon: -76.3016 },
];

describe.skipIf(process.env["OGV_FINAL_APPROACH_LIVE"] !== "on")("park destinations through /api/route-plan handler", () => {
  for (const includeAlternatives of [false, true]) for (const park of parks) it(`${park.name} (alternatives=${includeAlternatives})`, async () => {
    const router = createGraphHopperProvider({ baseUrl: process.env["GRAPHHOPPER_URL"] ?? "http://127.0.0.1:18989" });
    let calls = 0;
    const answers: ProviderCandidate[] = [];
    const provider: RouteCandidateProvider = {
      ...router,
      candidates: async (request, signal) => {
        calls += 1;
        const answer = await router.candidates(request, signal);
        answers.push(...answer.candidates);
        return answer;
      },
    };
    const authority = createRoadAuthorityCoordinator({ sources: roadAuthoritySourcesFromEnv({}), deadlineMs: 20_000 });
    // Warm the real feed snapshots before the normal plan's 2.5 s optional budget.
    const assessment = await authority.assess(padBox(boundingBoxOf([{ lat: 40.8676, lon: -75.7327 }, park]), 15_000), new AbortController().signal);
    const result = await handleRoutePlanRequest({
      identity: { rideId: "ride_park", rideRevision: 1, planningGeneration: 1 },
      request: {
        requestId: "park-live", origin: { lat: 40.8676, lon: -75.7327 }, destination: { lat: park.lat, lon: park.lon }, destinationLabel: park.name,
        stops: [], shaping: [], profile: "motorcycle_fastest", avoidPolygons: [],
        options: { vehicle: "motorcycle", includeAlternatives, avoidHighways: false, tollPolicy: "avoid" },
      },
    }, { plan: (input, { signal }) => planRide(input, { provider, roadAuthority: authority, env: {}, signal, funCharacterClassifier: null, funJudge: null }) });
    const routes = "bundle" in result.body ? result.body.bundle.candidates : [];
    const report = {
      park, includeAlternatives, status: result.status, calls, error: "error" in result.body ? result.body.error : null,
      routes: routes.map(route => ({ end: route.geometry.at(-1), gapMeters: haversine(route.geometry.at(-1)!, park), distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds, warnings: route.warnings })),
      originalVerdict: answers[0] === undefined ? null : assessment.evaluate(answers[0].geometry),
      sources: assessment.sources.map(source => ({ id: source.info.id, status: source.snapshot.status, count: source.snapshot.records.length, reason: source.snapshot.reason })),
    };
    console.log(JSON.stringify(report));
    if (process.env["OGV_FINAL_APPROACH_EVIDENCE_DIR"]) {
      await writeFile(`${process.env["OGV_FINAL_APPROACH_EVIDENCE_DIR"]}/${park.name.replaceAll(" ", "-")}${includeAlternatives ? "-alternatives" : ""}.json`, JSON.stringify({ ...report, answers, sources: assessment.sources }, null, 2));
    }
    expect(result.status).toBe(200);
    expect(routes.length).toBeGreaterThan(0);
    if (park.name === "Hawk Mountain Sanctuary") {
      expect(calls).toBeGreaterThan(1);
      expect(routes[0]!.warnings).toContainEqual(expect.objectContaining({ code: "destination-final-approach", message: expect.stringContaining("before Hawk Mountain Sanctuary") }));
      expect(haversine(routes[0]!.geometry.at(-1)!, park)).toBeLessThan(2000);
      expect(authority.sources.length).toBeGreaterThan(0);
      expect(assessment.evaluate(routes[0]!.geometry).failures).toEqual([]);
    } else {
      if (!includeAlternatives) expect(calls).toBe(1);
      expect(routes[0]!.warnings.some(warning => warning.code === "destination-final-approach")).toBe(false);
      expect(haversine(routes[0]!.geometry.at(-1)!, park)).toBeLessThan(100);
    }
  }, 60_000);
});
