import { describe, expect, it } from "vitest";
import { createRoadAuthorityCoordinator } from "@/application/route-intelligence/coordinator";
import type { RoadAuthoritySource } from "@/application/route-intelligence/road-authority-source";
import type { RoadAuthorityRecord } from "@/application/route-intelligence/types";
import type { ProviderCandidate, ProviderRouteRequest, RouteCandidateProvider } from "@/application/planner/route-provider";
import { planRide } from "@/server/planning/plan-service";
import { handleRoutePlanRequest } from "@/server/planning/route-handler";
import { blockedRoadOverlap } from "@/application/planner/final-approach";
import { haversine } from "@/domain/geometry/analysis";

const point = (meters: number) => ({ lon: -75, lat: 40 + meters / 111_195 });
const original: ProviderCandidate = {
  providerId: "router", profile: "motorcycle_fastest", geometry: [point(0), point(10_000)], distanceMeters: 10_000, durationSeconds: 600,
};
const request: ProviderRouteRequest = {
  requestId: "test", origin: point(0), destination: point(10_000), destinationLabel: "Mountain Park",
  stops: [], shaping: [], profile: "motorcycle_fastest", avoidPolygons: [],
  options: { includeAlternatives: false, vehicle: "motorcycle", avoidHighways: false, tollPolicy: "avoid" },
};
const identity = { rideId: "ride_test", rideRevision: 1, planningGeneration: 1 };
function record(start = 9500, end = 10_000): RoadAuthorityRecord {
  return {
    sourceId: "feed", sourceRecordId: String(start), kind: "motor-vehicle-designation", roadName: "Unnamed Road", description: "Restricted access",
    validFrom: null, validUntil: null, geometry: { type: "line", coordinates: [point(start), point(end)] },
    motorcycleAccess: { status: "closed", seasons: null },
  };
}
function authority(records = [record()]) {
  const source: RoadAuthoritySource = {
    info: { id: "feed", label: "Test feed", authority: "authoritative-operational", family: "road-authority", facet: "access", coverage: [{ west: -76, east: -74, south: 39, north: 42 }], precedence: 1 },
    budget: { maxRemoteCallsPerPlan: 1, maxRecords: 10, timeoutMs: 100, concurrency: 1, cacheTtlMs: 100, serveStaleMs: 100, retry: "none", cancellable: false },
    probe: () => ({ available: true, reason: null }),
    snapshot: async () => ({ status: "fresh", fetchedAt: "2026-10-23T12:00:00Z", reason: null, records, covered: [] }),
  };
  return createRoadAuthorityCoordinator({ sources: [source] });
}
function router(answer: (req: ProviderRouteRequest, call: number) => readonly ProviderCandidate[] = req => [{ ...original, geometry: [point(0), req.destination], distanceMeters: 9470, durationSeconds: 583 }]) {
  const requests: ProviderRouteRequest[] = [];
  const provider: RouteCandidateProvider = {
    id: "router", capabilities: () => ({ profiles: ["motorcycle_fastest"], supportsAlternatives: false, supportsAvoidPolygons: true }),
    candidates: async req => {
      requests.push(req);
      return { candidates: requests.length === 1 ? [original] : answer(req, requests.length) };
    },
  };
  return { provider, requests };
}
const deps = { env: {}, funCharacterClassifier: null, funJudge: null };

describe("plan handler blocked final approach", () => {
  it("recovers a destination snapped to an explicitly prohibited engine road without authority coverage", async () => {
    const { provider, requests } = router();
    const callRouter = provider.candidates;
    const total = haversine(point(0), point(10_000));
    const run = { durationSeconds: null, surface: "asphalt", roadClass: "service", roadEnvironment: "road", urbanDensity: "rural", curvatureRatio: null, toll: false };
    const snapped: RouteCandidateProvider = { ...provider, candidates: async (req, signal) => {
      const answer = await callRouter(req, signal);
      return requests.length !== 1 ? answer : { candidates: answer.candidates.map(candidate => ({ ...candidate,
        roadSummary: { totalMeters: total, surfaceByRoadClassMeters: {}, curvatureMeters: {}, tollMeters: 0,
          roadRuns: [{ ...run, meters: total - 500, roadAccess: "yes" }, { ...run, meters: 500, roadAccess: "private" }] },
      })) };
    } };
    const result = await planRide({ identity, request }, { ...deps, provider: snapped, roadAuthority: null });
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(2);
    if (result.ok) expect(result.bundle.candidates[0]!.warnings.at(-1)!.code).toBe("destination-final-approach");
  });
  it("returns fresh router metrics, checked geometry, and a named rider notice; unknown stays unknown", async () => {
    const { provider, requests } = router();
    const roadAuthority = authority();
    const result = await handleRoutePlanRequest({ identity, request }, { plan: input => planRide(input, { ...deps, provider, roadAuthority }) });
    expect(result.status).toBe(200);
    if (!("bundle" in result.body)) throw new Error("Expected a shortened route");
    const route = result.body.bundle.candidates[0]!;
    expect(route.distanceMeters).toBe(9470);
    expect(route.durationSeconds).toBe(583);
    expect(route.geometry).toEqual([point(0), requests[1]!.destination]);
    expect(route.warnings).toContainEqual(expect.objectContaining({ code: "destination-final-approach", message: "Ends 0.3 mi before Mountain Park — the last stretch isn't open to motorcycles." }));
    expect(route.evidence["closures"]?.status).toBe("unknown");
    expect(route.evidence["access"]?.status).toBe("unknown");
    expect(requests).toHaveLength(2);
  });
  it("leaves middle blocks alone, even if two unnamed records deduplicate to one sentence", async () => {
    const { provider, requests } = router();
    const result = await planRide({ identity, request }, { ...deps, provider, roadAuthority: authority([record(3000, 3500), record()]) });
    expect(result).toMatchObject({ ok: false, error: { code: "no-route" } });
    expect(requests).toHaveLength(1);
  });
  it("keeps blocked geometry out even when a retry rides too little of it to trigger the normal hard gate", async () => {
    const { provider, requests } = router(() => [{ ...original, geometry: [point(0), point(9530)] }]);
    const result = await planRide({ identity, request }, { ...deps, provider, roadAuthority: authority() });
    expect(result.ok).toBe(false);
    expect(requests).toHaveLength(4);
  });
  it("retries farther back when the engine snaps the first endpoint back onto a blocked road", async () => {
    const { provider, requests } = router((req, call) => [{ ...original, geometry: [point(0), call === 2 ? point(9530) : req.destination] }]);
    const result = await planRide({ identity, request }, { ...deps, provider, roadAuthority: authority() });
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(3);
  });
  it("preserves the original error on optional retry failures", async () => {
    const { provider, requests } = router(() => { throw new Error("router unavailable"); });
    const result = await planRide({ identity, request }, { ...deps, provider, roadAuthority: authority() });
    expect(result).toMatchObject({ ok: false, error: { code: "no-route", details: { roadBlocked: true } } });
    expect(requests).toHaveLength(4);
  });
  it("checks all candidates before permitting fallback", async () => {
    const { provider, requests } = router();
    const first = provider.candidates;
    const mixed: RouteCandidateProvider = { ...provider, candidates: async (req, signal) => {
      const result = await first(req, signal);
      return { candidates: [...result.candidates, { ...original, distanceMeters: Number.NaN }] };
    } };
    expect((await planRide({ identity, request }, { ...deps, provider: mixed, roadAuthority: authority() })).ok).toBe(false);
    expect(requests).toHaveLength(1);
  });
  it("preserves authored stops and shaping during the replan", async () => {
    const { provider, requests } = router();
    const authored = { ...request, stops: [point(2000)], shaping: [point(3000)] };
    expect((await planRide({ identity, request: authored }, { ...deps, provider, roadAuthority: authority() })).ok).toBe(true);
    expect(requests[1]).toMatchObject({ stops: authored.stops, shaping: authored.shaping, avoidPolygons: authored.avoidPolygons, profile: authored.profile });
  });
  it("cannot recover by dropping a required road span on the blocked approach", async () => {
    const { provider, requests } = router();
    const corridor = [point(9700), point(9900)];
    const roadSpans = [{ id: "must-reach", mode: "must" as const, direction: "forward" as const, anchors: corridor, corridor }];
    const withSpanAnchors: RouteCandidateProvider = { ...provider, candidates: async (req, signal) => {
      const answer = await provider.candidates(req, signal);
      return requests.length !== 1 ? answer : { candidates: answer.candidates.map(candidate => ({
        ...candidate, geometry: [point(0), ...corridor, point(10_000)],
      })) };
    } };
    const result = await planRide({ identity, request: { ...request, roadSpans } }, { ...deps, provider: withSpanAnchors, roadAuthority: authority() });
    expect(result.ok).toBe(false);
    expect(requests.length).toBeGreaterThan(1);
    for (const retry of requests.slice(1)) expect(retry.roadSpans).toEqual(roadSpans);
  });
  it("uses closure copy for an approach closed by works", async () => {
    const { provider } = router();
    const result = await planRide({ identity, request }, { ...deps, provider, roadAuthority: authority([{ ...record(), kind: "closure", motorcycleAccess: undefined }]) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bundle.candidates[0]!.warnings.at(-1)!.message).toContain("the last stretch is closed.");
  });
  it("retains every blocked geometry before failure-copy deduplication", async () => {
    const checked = await authority([record(3000, 3500), record()]).assess({ west: -76, east: -74, south: 39, north: 42 }, new AbortController().signal);
    const verdict = checked.evaluate(original.geometry);
    expect(verdict.failures).toHaveLength(1);
    expect(verdict.blockedRoads).toHaveLength(2);
    expect(blockedRoadOverlap(original.geometry, verdict)).toBe(true);
  });
});
