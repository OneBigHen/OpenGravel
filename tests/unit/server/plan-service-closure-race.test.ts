import { describe, expect, it } from "vitest";
import { createRoadAuthorityCoordinator, ROAD_AUTHORITY_DEADLINE_MS } from "@/application/route-intelligence/coordinator";
import type { RoadAuthoritySource } from "@/application/route-intelligence/road-authority-source";
import type { RoadAuthorityRecord, RoadAuthoritySnapshot } from "@/application/route-intelligence/types";
import type { ProviderCandidate, ProviderRouteRequest, RouteCandidateProvider } from "@/application/planner/route-provider";
import { planRide } from "@/server/planning/plan-service";

// The race RM-2 measured: a closure/access feed that answers a moment after
// the plan's 2.5 s budget. Before the fix the plan returned the route over the
// closed road with closures "unknown"; the check then said "closed".
const point = (north: number, east = 0) => ({ lon: -75 + east / 85_000, lat: 40 + north / 111_195 });
const overClosedRoad: ProviderCandidate = {
  providerId: "router", profile: "motorcycle_fastest",
  geometry: [point(0), point(4_000), point(6_000), point(10_000)], distanceMeters: 10_000, durationSeconds: 600,
};
const detour: ProviderCandidate = {
  providerId: "router", profile: "motorcycle_fastest",
  geometry: [point(0), point(2_000, 3_000), point(8_000, 3_000), point(10_000)], distanceMeters: 13_000, durationSeconds: 780,
};
const request: ProviderRouteRequest = {
  requestId: "race", origin: point(0), destination: point(10_000),
  stops: [], shaping: [], profile: "motorcycle_fastest", avoidPolygons: [],
  options: { includeAlternatives: false, vehicle: "motorcycle", avoidHighways: false, tollPolicy: "avoid" },
};
const identity = { rideId: "ride_race", rideRevision: 1, planningGeneration: 1 };
const closedRoad: RoadAuthorityRecord = {
  sourceId: "feed", sourceRecordId: "couch-road", kind: "closure", roadName: "Couch Road", description: "Closed for the season",
  validFrom: null, validUntil: null, geometry: { type: "line", coordinates: [point(4_000), point(6_000)] },
};
const provider: RouteCandidateProvider = {
  id: "router",
  capabilities: () => ({ profiles: ["motorcycle_fastest"], supportsAlternatives: true, supportsAvoidPolygons: true }),
  candidates: async () => ({ candidates: [overClosedRoad, detour] }),
};

/** A feed with an in-flight load and a cache per corridor, like the PGC/DCNR sources. */
function feed(loadMs: number | "down" | "hang") {
  const cache = new Map<string, Promise<RoadAuthoritySnapshot>>();
  let loads = 0;
  const source: RoadAuthoritySource = {
    info: { id: "feed", label: "Seasonal roads", authority: "authoritative-operational", family: "road-authority", facet: "closures", coverage: [{ west: -76, east: -74, south: 39, north: 42 }], precedence: 1 },
    budget: { maxRemoteCallsPerPlan: 1, maxRecords: 10, timeoutMs: 8_000, concurrency: 1, cacheTtlMs: 60_000, serveStaleMs: 60_000, retry: "none", cancellable: false },
    probe: () => ({ available: true, reason: null }),
    snapshot: corridor => {
      const key = [corridor.west, corridor.south, corridor.east, corridor.north].map(value => value.toFixed(2)).join(":");
      let pending = cache.get(key);
      if (pending === undefined) {
        loads += 1;
        pending = loadMs === "hang" ? new Promise(() => undefined)
          : loadMs === "down" ? Promise.resolve({ status: "unavailable", fetchedAt: null, reason: "Seasonal roads are unavailable right now.", records: [], covered: [] })
          : new Promise(resolve => setTimeout(() => resolve({ status: "fresh", fetchedAt: new Date().toISOString(), reason: null, records: [closedRoad], covered: [corridor] }), loadMs));
        cache.set(key, pending);
      }
      return pending;
    },
  };
  return { roadAuthority: createRoadAuthorityCoordinator({ sources: [source] }), loads: () => loads };
}
const deps = { env: {}, funCharacterClassifier: null, funJudge: null, provider };

async function timed<T>(run: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const started = performance.now();
  const result = await run();
  return { result, ms: performance.now() - started };
}

describe("closure check that answers after the plan's deadline", () => {
  it("never returns the route over the closed road; it waits for the answer and drops it", async () => {
    const { roadAuthority, loads } = feed(ROAD_AUTHORITY_DEADLINE_MS + 600);
    const { result, ms } = await timed(() => planRide({ identity, request }, { ...deps, roadAuthority }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const routes = result.bundle.candidates;
    expect(routes.map(route => route.distanceMeters)).toEqual([13_000]);
    expect(routes[0]!.evidence["closures"]).toMatchObject({ status: "known", value: 0 });
    expect(routes[0]!.warnings.map(warning => warning.code)).not.toContain("road-authority-unavailable");
    // One load, joined rather than restarted; the wait ends when it answers.
    expect(loads()).toBe(1);
    expect(ms).toBeLessThan(ROAD_AUTHORITY_DEADLINE_MS + 1_500);
  }, 15_000);

  it("adds no wait when the area is already cached", async () => {
    const { roadAuthority, loads } = feed(ROAD_AUTHORITY_DEADLINE_MS + 600);
    await planRide({ identity, request }, { ...deps, roadAuthority });
    const { result, ms } = await timed(() => planRide({ identity, request }, { ...deps, roadAuthority }));
    expect(result.ok && result.bundle.candidates.map(route => route.distanceMeters)).toEqual([13_000]);
    expect(loads()).toBe(1);
    expect(ms).toBeLessThan(300);
  }, 15_000);

  it("adds no wait when the feed answers inside the budget", async () => {
    const { roadAuthority } = feed(50);
    const { result, ms } = await timed(() => planRide({ identity, request }, { ...deps, roadAuthority }));
    expect(result.ok && result.bundle.candidates.map(route => route.distanceMeters)).toEqual([13_000]);
    expect(ms).toBeLessThan(500);
  });

  it("does not wait on a feed that is down, and says the check did not answer", async () => {
    const { roadAuthority } = feed("down");
    const { result, ms } = await timed(() => planRide({ identity, request }, { ...deps, roadAuthority }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ms).toBeLessThan(500);
    for (const route of result.bundle.candidates) {
      expect(route.evidence["closures"]?.status).toBe("unknown");
      expect(route.warnings.map(warning => warning.code)).toContain("road-authority-unavailable");
    }
  });

  it("gives up after a bounded wait on a feed that never answers, and never reads as clear", async () => {
    const { roadAuthority } = feed("hang");
    const { result, ms } = await timed(() => planRide({ identity, request }, { ...deps, roadAuthority }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Plan budget plus one bounded settle (the progressive answer's shorter one).
    expect(ms).toBeLessThan(2 * ROAD_AUTHORITY_DEADLINE_MS + 1_000);
    for (const route of result.bundle.candidates) {
      expect(route.evidence["closures"]?.status).toBe("unknown");
      expect(route.warnings.map(warning => warning.code)).toContain("road-authority-unavailable");
    }
  }, 15_000);
});
