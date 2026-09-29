/**
 * Road authority against the live feeds (route intelligence RI-1). Manual:
 * `OGV_ROAD_AUTHORITY=on npm run test:real-router` with the deployment env.
 * It proves the wiring end to end; what the feeds report changes daily, so it
 * asserts honesty (every covering source answered or said why) rather than a
 * particular closure.
 */

import { describe, expect, it } from "vitest";

import { roadAuthoritySourcesFromEnv } from "@/server/planning/road-authority";
import { createRoadAuthorityCoordinator } from "@/application/route-intelligence/coordinator";
import { planRide } from "@/server/planning/plan-service";

const live = process.env["OGV_ROAD_AUTHORITY"] === "on";

describe.skipIf(!live)("road authority, live", () => {
  it("every source answers a PA/NJ corridor or says why", async () => {
    const coordinator = createRoadAuthorityCoordinator({ sources: roadAuthoritySourcesFromEnv(process.env), deadlineMs: 20_000 });
    const assessment = await coordinator.assess({ west: -75.9, south: 40.4, east: -74.4, north: 41.0 }, new AbortController().signal);
    for (const outcome of assessment.sources) {
      console.log(outcome.info.id, outcome.snapshot.status, outcome.snapshot.records.length, outcome.snapshot.reason ?? "");
      expect(outcome.snapshot.status === "unavailable" ? outcome.snapshot.reason : "ok").toBeTruthy();
    }
  }, 60_000);

  it("a real plan carries closure evidence and caveats", async () => {
    const result = await planRide({
      identity: { rideId: "ride_live", rideRevision: 1, planningGeneration: 1 },
      request: {
        requestId: "live-road-authority",
        origin: { lon: -75.49, lat: 40.6 },
        destination: { lon: -74.75, lat: 40.87 },
        stops: [],
        shaping: [],
        profile: "motorcycle_fastest",
        avoidPolygons: [],
        options: { includeAlternatives: true, avoidHighways: false, tollPolicy: "avoid", vehicle: "motorcycle" },
      },
    }, { funCharacterClassifier: null });
    if (!result.ok) console.log(result.error);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const candidate of result.bundle.candidates) {
      console.log(candidate.id, JSON.stringify(candidate.evidence["closures"]).slice(0, 300));
      console.log(candidate.warnings.map((warning) => `${warning.code}: ${warning.message}`).join("\n"));
    }
    expect(result.bundle.candidates[0]?.evidence["closures"]).toBeDefined();
  }, 60_000);

  it("a route wholly inside a state with a feed is checked end to end", async () => {
    const result = await planRide({
      identity: { rideId: "ride_live_nj", rideRevision: 1, planningGeneration: 1 },
      request: {
        requestId: "live-road-authority-nj",
        // Morristown to Princeton, NJ.
        origin: { lon: -74.48, lat: 40.8 },
        destination: { lon: -74.66, lat: 40.35 },
        stops: [],
        shaping: [],
        profile: "motorcycle_fastest",
        avoidPolygons: [],
        options: { includeAlternatives: false, avoidHighways: false, tollPolicy: "avoid", vehicle: "motorcycle" },
      },
    }, { funCharacterClassifier: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const closures = result.bundle.candidates[0]?.evidence["closures"];
    console.log("NJ", JSON.stringify(closures).slice(0, 200));
    expect(closures?.status === "known" || closures?.status === "stale").toBe(true);
  }, 60_000);
});
