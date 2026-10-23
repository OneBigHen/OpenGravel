import { describe, expect, it, vi } from "vitest";
import type { ProviderCandidate, ProviderRouteRequest, RouteCandidateProvider } from "@/application/planner/route-provider";
import type { KnownRoadsPort } from "@/application/roads/known-roads";
import { planRide } from "@/server/planning/plan-service";
import { createRoadAuthorityCoordinator, ROAD_AUTHORITY_DEADLINE_MS } from "@/application/route-intelligence/coordinator";
import type { BoundingBox } from "@/application/route-intelligence/types";

const origin = { lon: -75.16, lat: 39.95 };
const destination = { lon: -74.8, lat: 40.2 };
const request: ProviderRouteRequest = {
  requestId: "perf", origin, destination, stops: [], shaping: [], profile: "motorcycle_fastest", avoidPolygons: [],
  options: { includeAlternatives: true, avoidHighways: false, tollPolicy: "avoid", vehicle: "motorcycle" },
};
const identity = { rideId: "perf", rideRevision: 1, planningGeneration: 1 };
const env = { OGV_ATLAS_GENERATORS: "off", OGV_TRAFFIC_LIVE_AVOID: "off" };
function candidate(index = 0): ProviderCandidate {
  return {
    providerId: "counting", profile: "motorcycle_fastest",
    geometry: [origin, { lon: -75.12 + index * 0.05, lat: 40.1 }, destination],
    distanceMeters: 50_000, durationSeconds: 3_000,
    roadSummary: { totalMeters: 50_000, surfaceByRoadClassMeters: { "asphalt|tertiary": 50_000 }, curvatureMeters: {}, tollMeters: 0 },
    // Intentionally collide: catalogue evidence belongs to the actual line.
    providerMetadata: { fingerprint: "same-provider-fingerprint" },
  };
}
function providerWith(answer: (request: ProviderRouteRequest) => readonly ProviderCandidate[]): RouteCandidateProvider {
  return {
    id: "counting", capabilities: () => ({ profiles: ["motorcycle_fastest"], supportsAlternatives: true, supportsAvoidPolygons: true }),
    candidates: async request => ({ candidates: answer(request) }),
  };
}
function authority(snapshot: () => Promise<never> | Promise<{ status: "fresh"; fetchedAt: string; reason: null; records: []; covered: BoundingBox[] }>) {
  return createRoadAuthorityCoordinator({ sources: [{
    info: { id: "feed", label: "Test feed", authority: "authoritative-operational", family: "road-authority", facet: "closures", coverage: [{ west: -76, south: 39, east: -74, north: 41 }], precedence: 1 },
    budget: { maxRemoteCallsPerPlan: 1, maxRecords: 1, timeoutMs: 1, concurrency: 1, cacheTtlMs: 1, serveStaleMs: 1, retry: "none", cancellable: false },
    probe: () => ({ available: true, reason: null }), snapshot,
  }] });
}

describe("planning latency regressions", () => {
  it.each([false, true])("uses one engine search for a first route (request-level override: %s)", async override => {
    let calls = 0;
    const requests: ProviderRouteRequest[] = [];
    const provider = providerWith(request => { calls += 1; requests.push(request); return [candidate()]; });
    const dirt = { ...request, options: { ...request.options, surfacePreference: "dirt-preferred" as const, includeAlternatives: override } };
    const result = await planRide({ identity, request: dirt, ...(override ? { options: { includeAlternatives: false } } : {}) }, {
      provider, env: { ...env, OGV_ATLAS_GENERATORS: "on", OGV_FUN_GENERATORS: "on" },
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(1);
    expect(requests[0]?.options.includeAlternatives).toBe(false);
  });

  it.each([1, 4])("queries catalogues once per distinct box for %s candidates and reuses line evidence", async count => {
    const curvyRoadsNear = vi.fn(() => [{ id: "rated", name: "Rated Road", rating: 900, line: candidate().geometry }]);
    const gravelCorridorsNear = vi.fn(() => []);
    const knownRoads: KnownRoadsPort = { curvyRoadsNear, gravelCorridorsNear };
    const result = await planRide({ identity, request: { ...request, options: { ...request.options, surfacePreference: "dirt-preferred" } } }, {
      provider: providerWith(() => Array.from({ length: count }, (_, index) => candidate(index))), knownRoads, env,
    });
    console.info(JSON.stringify({ benchmark: "catalogue", candidates: count, curvy: curvyRoadsNear.mock.calls.length, gravel: gravelCorridorsNear.mock.calls.length }));
    expect(result.ok).toBe(true);
    expect(curvyRoadsNear).toHaveBeenCalledTimes(1);
    expect(gravelCorridorsNear).toHaveBeenCalledTimes(1);
    if (result.ok) {
      const ridden = result.bundle.candidates.find(route => route.geometry[1]?.lon === candidate().geometry[1]?.lon);
      expect(ridden?.evidence["namedRoads"]).toMatchObject({ value: { roads: [{ name: "Rated Road" }] } });
      for (const other of result.bundle.candidates.filter(route => route !== ridden)) expect(other.evidence["namedRoads"]).toBeUndefined();
    }
  });

  it("shares an engine concurrency bound across simultaneous dirt plans while keeping the full sweep", async () => {
    let active = 0;
    let peak = 0;
    let calls = 0;
    const provider: RouteCandidateProvider = {
      ...providerWith(() => []),
      candidates: async () => {
        active += 1; calls += 1; peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 1));
        active -= 1;
        return { candidates: [candidate()] };
      },
    };
    const results = await Promise.all(Array.from({ length: 2 }, () => planRide({ identity, request: { ...request, options: { ...request.options, surfacePreference: "dirt-preferred" } } }, { provider, env })));
    console.info(JSON.stringify({ benchmark: "engine", plans: 2, calls, peak }));
    expect(results.every(result => result.ok)).toBe(true);
    expect(calls).toBe(16); // One lane plus the seven-factor dirt sweep per full plan.
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("reuses authority for covered proposals and only grows the assessed corridor", async () => {
    const roadAuthority = authority(async () => ({ status: "fresh", fetchedAt: new Date().toISOString(), reason: null, records: [], covered: [{ west: -76, south: 39, east: -74, north: 41 }] }));
    const assess = vi.spyOn(roadAuthority, "assess");
    const result = await planRide({ identity, request: { ...request, options: { ...request.options, surfacePreference: "dirt-preferred" } } }, { provider: providerWith(() => [candidate()]), roadAuthority, env: { OGV_TRAFFIC_LIVE_AVOID: "off" } });
    console.info(JSON.stringify({ benchmark: "authority", calls: assess.mock.calls.length }));
    expect(result.ok).toBe(true);
    expect(assess).toHaveBeenCalledTimes(1);
  });

  it("returns cancelled when a first-route request aborts during authority assessment", async () => {
    const roadAuthority = authority(() => new Promise<never>(() => undefined));
    vi.spyOn(roadAuthority, "assess").mockImplementation(() => new Promise(() => undefined));
    const controller = new AbortController();
    const pending = planRide({ identity, request: { ...request, options: { ...request.options, includeAlternatives: false } } }, { provider: providerWith(() => [candidate()]), roadAuthority, env, signal: controller.signal });
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort(new Error("superseded"));
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: "cancelled", recoverable: false } });
  });

  it("spends one optional authority budget even when a coordinator never settles", async () => {
    vi.useFakeTimers();
    try {
      const roadAuthority = authority(() => new Promise<never>(() => undefined));
      const assess = vi.spyOn(roadAuthority, "assess").mockImplementation(() => new Promise(() => undefined));
      let result: Awaited<ReturnType<typeof planRide>> | undefined;
      void planRide({ identity, request: { ...request, options: { ...request.options, surfacePreference: "dirt-preferred" } } }, { provider: providerWith(() => [candidate()]), roadAuthority, env }).then(value => { result = value; });
      await vi.advanceTimersByTimeAsync(ROAD_AUTHORITY_DEADLINE_MS + 1);
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.bundle.candidates[0]?.evidence["closures"]?.status).toBe("unknown");
        expect(result.bundle.candidates[0]?.warnings.map(warning => warning.code)).toContain("road-authority-unavailable");
      }
      expect(assess).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
