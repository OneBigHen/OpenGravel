import { describe, expect, it, vi } from "vitest";
import { searchCurvyEnvelope } from "@/application/planner/curvy-search";
import type { ProviderCandidate, ProviderRouteRequest } from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";

const request: ProviderRouteRequest = { requestId: "curvy", origin: { lat: 40, lon: -75 }, destination: { lat: 40, lon: -74.8 }, stops: [], shaping: [], avoidPolygons: [], profile: "motorcycle_twisty", options: { vehicle: "motorcycle", tollPolicy: "avoid", avoidHighways: false, includeAlternatives: false, roadCharacter: "curvy", traffic: "protect-ride" } };

const line: Coordinate[] = [request.origin, request.destination];
/** `franco` is the route's curvature per km, read back through the test's curvature seam. */
const route = (minutes: number, franco: number, busy = 0, profile = request.profile): ProviderCandidate => ({
  providerId: "test", profile, geometry: line, durationSeconds: minutes * 60, distanceMeters: 17_000 + franco, providerMetadata: { franco },
  roadSummary: { totalMeters: 17_000, surfaceByRoadClassMeters: { "asphalt|secondary": 17_000 }, curvatureMeters: {}, tollMeters: 0, roadRuns: [{ meters: 17_000 * busy, durationSeconds: null, surface: "asphalt", roadClass: "primary", urbanDensity: "rural", roadEnvironment: "road", toll: false, curvatureRatio: null }, { meters: 17_000 * (1 - busy), durationSeconds: null, surface: "asphalt", roadClass: "secondary", urbanDensity: "rural", roadEnvironment: "road", toll: false, curvatureRatio: null }] },
});
const provider = (answer: (r: ProviderRouteRequest) => ProviderCandidate[]) => ({ id: "test", capabilities: () => ({ profiles: [], supportsAlternatives: true, supportsAvoidPolygons: true }), candidates: vi.fn(async (r: ProviderRouteRequest) => ({ candidates: answer(r) })) });
const base = { deadlineMs: 1000, signal: new AbortController().signal, sweepCalls: 5, curvature: (c: ProviderCandidate) => Number(c.providerMetadata?.["franco"] ?? 0) };

describe("curvy search", () => {
  it("picks a twistier line the pipeline held but did not lead with", async () => {
    const bland = route(68, 0);
    const twisty = route(61, 60);
    const p = provider(() => []);
    const result = await searchCurvyEnvelope({ ...base, request, candidates: [bland, twisty], incumbent: bland, provider: p });
    expect(result.candidate?.durationSeconds).toBe(twisty.durationSeconds);
  });
  it("spends a few minutes on much more curvature, but not many on a little", async () => {
    const pick = route(60, 0);
    const worth = await searchCurvyEnvelope({ ...base, request, candidates: [pick, route(66, 60)], incumbent: pick, provider: provider(() => []) });
    expect(worth.candidate?.durationSeconds).toBe(route(66, 60).durationSeconds);
    const notWorth = await searchCurvyEnvelope({ ...base, request, candidates: [pick, route(78, 8)], incumbent: pick, provider: provider(() => []) });
    expect(notWorth.candidate).toBeNull();
  });
  it("adds twisty alternatives and the scenic profile in one parallel wave", async () => {
    const pick = route(60, 0);
    const p = provider(r => r.profile === "motorcycle_scenic" ? [route(64, 60)] : [route(60, 0)]);
    const result = await searchCurvyEnvelope({ ...base, request, candidates: [pick], incumbent: pick, provider: p });
    expect(p.candidates).toHaveBeenCalledTimes(5);
    expect(p.candidates.mock.calls.map(([r]) => r.profile)).toContain("motorcycle_scenic");
    expect(result.candidate?.profile).toBe("motorcycle_twisty");
    expect(result.candidate?.durationSeconds).toBe(route(64, 60).durationSeconds);
  });
  it("keeps busy roads out when the rider avoids them", async () => {
    const pick = route(60, 0, 0.02);
    const result = await searchCurvyEnvelope({ ...base, request, candidates: [pick, route(60, 60, 0.4)], incumbent: pick, provider: provider(() => []) });
    expect(result.candidate).toBeNull();
  });
  it("leads a loop with the twistiest loop in the time window, without router calls", async () => {
    const loop = { ...request, destination: request.origin, discovery: { targetMinutes: 120, toleranceMinutes: 15 } } as ProviderRouteRequest;
    const pick = route(118, 0);
    const p = provider(() => []);
    const result = await searchCurvyEnvelope({ ...base, request: loop, candidates: [pick, route(130, 40), route(150, 80)], incumbent: pick, provider: p });
    expect(result.candidate?.durationSeconds).toBe(route(130, 40).durationSeconds);
    expect(p.candidates).not.toHaveBeenCalled();
  });
});
