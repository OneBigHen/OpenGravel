import { describe, expect, it, vi } from "vitest";
import { searchRiderEnvelope, riderEnvelopeMetrics } from "@/application/planner/rider-mode-search";
import type { ProviderCandidate, ProviderRouteRequest } from "@/application/planner/route-provider";
const request: ProviderRouteRequest = { requestId: "test", origin: { lat: 40, lon: -75 }, destination: { lat: 41, lon: -75 }, stops: [], shaping: [], avoidPolygons: [], profile: "motorcycle_adventure", options: { vehicle: "motorcycle", tollPolicy: "avoid", avoidHighways: false, includeAlternatives: false, targetUnpavedShare: 0.5 } };
const candidate = (seconds: number, share: number): ProviderCandidate => ({ providerId: "test", profile: request.profile, geometry: [request.origin, request.destination], durationSeconds: seconds, distanceMeters: 1000, roadSummary: { totalMeters: 1000, surfaceByRoadClassMeters: { "gravel|track": 1000 * share, "asphalt|primary": 1000 * (1 - share) }, curvatureMeters: {}, tollMeters: 0, roadRuns: [{ meters: 1000 * share, durationSeconds: null, surface: "gravel", roadClass: "track", urbanDensity: "rural", roadEnvironment: "road", toll: false, curvatureRatio: null }, { meters: 1000 * (1 - share), durationSeconds: null, surface: "asphalt", roadClass: "primary", urbanDensity: "city", roadEnvironment: "road", toll: false, curvatureRatio: null }] } });
describe("rider envelope search", () => {
  it("counts busy-road union once", () => expect(riderEnvelopeMetrics(candidate(600, 0.5))?.busyShare).toBe(0.5));
  it("chooses the cheapest target hit and caps detours", async () => {
    const calls = vi.fn(async (r: ProviderRouteRequest) => ({ candidates: [r.options.riderModeFactor === 0 ? candidate(600, 0.1) : candidate(780, 0.6)] }));
    const result = await searchRiderEnvelope({ request, candidates: [candidate(700, 0.5)], provider: { id: "test", capabilities: () => ({ profiles: [], supportsAlternatives: false, supportsAvoidPolygons: true }), candidates: calls }, maxCalls: 3, deadlineMs: 1000, signal: new AbortController().signal });
    expect(result.candidate?.durationSeconds).toBe(700);
    expect(result.calls).toBeLessThanOrEqual(3);
    expect(result.trials.length).toBeGreaterThan(1);
  });
  it("fails open on provider failures", async () => {
    const initial = candidate(600, 0.1);
    const result = await searchRiderEnvelope({ request, candidates: [initial], provider: { id: "test", capabilities: () => ({ profiles: [], supportsAlternatives: false, supportsAvoidPolygons: true }), candidates: async () => { throw Error("offline"); } }, maxCalls: 2, deadlineMs: 1000, signal: new AbortController().signal });
    expect(result.candidate).toMatchObject(initial);
    expect(result.calls).toBe(2);
  });
});

describe("search bounds", () => {
  it("rejects an over-cap target hit", async () => {
    const initial = candidate(600, 0.1);
    const result = await searchRiderEnvelope({ request, candidates: [initial], provider: { id: "test", capabilities: () => ({ profiles: [], supportsAlternatives: false, supportsAvoidPolygons: true }), candidates: async r => ({ candidates: [r.options.riderModeFactor === 0 ? initial : candidate(900, 0.8)] }) }, maxCalls: 3, deadlineMs: 1000, signal: new AbortController().signal });
    expect(result.candidate?.durationSeconds).toBe(600);
  });
  it("uses no calls when budget is zero", async () => {
    const calls = vi.fn(async () => ({ candidates: [] }));
    const result = await searchRiderEnvelope({ request, candidates: [candidate(600, 0.1)], provider: { id: "test", capabilities: () => ({ profiles: [], supportsAlternatives: false, supportsAvoidPolygons: true }), candidates: calls }, maxCalls: 0, deadlineMs: 1000, signal: new AbortController().signal });
    expect(calls).not.toHaveBeenCalled();
    expect(result.calls).toBe(0);
  });
  it("rejects a candidate that fails the canonical gate", async () => {
    const result = await searchRiderEnvelope({ request, candidates: [candidate(600, 0.1)], provider: { id: "test", capabilities: () => ({ profiles: [], supportsAlternatives: false, supportsAvoidPolygons: true }), candidates: async () => ({ candidates: [candidate(600, 0.9)] }) }, verify: async () => [], maxCalls: 3, deadlineMs: 1000, signal: new AbortController().signal });
    expect(result.candidate?.roadSummary?.surfaceByRoadClassMeters["gravel|track"]).toBe(100);
  });
});

it("screens hard constraints before using a trial to steer the interval", async () => {
  const result = await searchRiderEnvelope({ request, candidates: [candidate(600, 0.1)], provider: { id: "test", capabilities: () => ({ profiles: [], supportsAlternatives: false, supportsAvoidPolygons: true }), candidates: async r => ({ candidates: [r.options.riderModeFactor === 0 ? candidate(600, 0.1) : candidate(600, 0.9)] }) }, screen: next => (riderEnvelopeMetrics(next)?.unpavedShare ?? 0) < 0.5, maxCalls: 3, deadlineMs: 1000, signal: new AbortController().signal });
  expect(result.candidate?.roadSummary?.surfaceByRoadClassMeters["gravel|track"]).toBe(100);
});
