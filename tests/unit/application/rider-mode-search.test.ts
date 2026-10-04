import { describe, expect, it, vi } from "vitest";
import { DIRT_DETOUR_CAP, searchRiderEnvelope, riderEnvelopeMetrics } from "@/application/planner/rider-mode-search";
import type { ProviderCandidate, ProviderRouteRequest } from "@/application/planner/route-provider";
const request: ProviderRouteRequest = { requestId: "test", origin: { lat: 40, lon: -75 }, destination: { lat: 41, lon: -75 }, stops: [], shaping: [], avoidPolygons: [], profile: "motorcycle_adventure", options: { vehicle: "motorcycle", tollPolicy: "avoid", avoidHighways: false, includeAlternatives: false, targetUnpavedShare: 0.5 } };
// About a kilometre a minute, like a rural ride.
const candidate = (seconds: number, share: number, meters = (seconds / 60) * 1000): ProviderCandidate => ({ providerId: "test", profile: request.profile, geometry: [request.origin, request.destination], durationSeconds: seconds, distanceMeters: meters, roadSummary: { totalMeters: meters, surfaceByRoadClassMeters: { "gravel|track": meters * share, "asphalt|primary": meters * (1 - share) }, curvatureMeters: {}, tollMeters: 0, roadRuns: [{ meters: meters * share, durationSeconds: null, surface: "gravel", roadClass: "track", urbanDensity: "rural", roadEnvironment: "road", toll: false, curvatureRatio: null }, { meters: meters * (1 - share), durationSeconds: null, surface: "asphalt", roadClass: "primary", urbanDensity: "city", roadEnvironment: "road", toll: false, curvatureRatio: null }] } });
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
    const result = await searchRiderEnvelope({ request, candidates: [initial], provider: { id: "test", capabilities: () => ({ profiles: [], supportsAlternatives: false, supportsAvoidPolygons: true }), candidates: async r => ({ candidates: [r.options.riderModeFactor === 0 ? initial : candidate(600 * DIRT_DETOUR_CAP + 60, 0.8)] }) }, maxCalls: 3, deadlineMs: 1000, signal: new AbortController().signal });
    expect(result.candidate?.durationSeconds).toBe(600);
  });
  it("caps against the rider's own profile, not a faster engine ETA", async () => {
    // Lock Haven -> Slate Run: fastest profile 75 min, adventure 91 min on the
    // same road, 115 min with 28% dirt. 115 is over 1.35x75 but within the cap of 91.
    const calls = async (r: ProviderRouteRequest) => ({ candidates: [r.options.riderModeFactor === 0 ? candidate(75 * 60, 0) : candidate(115 * 60, 0.28)] });
    const result = await searchRiderEnvelope({ request, candidates: [candidate(91 * 60, 0)], provider: { id: "test", capabilities: () => ({ profiles: [], supportsAlternatives: false, supportsAvoidPolygons: true }), candidates: calls }, maxCalls: 3, deadlineMs: 1000, signal: new AbortController().signal });
    expect(result.candidate?.durationSeconds).toBe(115 * 60);
  });
  it("does not spend minutes on a trace of dirt", async () => {
    const calls = async (r: ProviderRouteRequest) => ({ candidates: [r.options.riderModeFactor === 0 ? candidate(50 * 60, 0) : candidate(76 * 60, 0.03)] });
    const result = await searchRiderEnvelope({ request, candidates: [candidate(55 * 60, 0)], provider: { id: "test", capabilities: () => ({ profiles: [], supportsAlternatives: false, supportsAvoidPolygons: true }), candidates: calls }, maxCalls: 3, deadlineMs: 1000, signal: new AbortController().signal });
    expect(result.candidate?.durationSeconds).toBe(50 * 60);
  });
  it("keeps the pipeline's own dirtier candidate even when the trial baseline is faster", async () => {
    const calls = async (r: ProviderRouteRequest) => ({ candidates: [r.options.riderModeFactor === 0 ? candidate(20 * 60, 0) : candidate(26 * 60, 0)] });
    const result = await searchRiderEnvelope({ request, candidates: [candidate(26 * 60, 0), candidate(38 * 60, 0.15)], provider: { id: "test", capabilities: () => ({ profiles: [], supportsAlternatives: false, supportsAvoidPolygons: true }), candidates: calls }, maxCalls: 3, deadlineMs: 1000, signal: new AbortController().signal });
    expect(result.candidate?.durationSeconds).toBe(38 * 60);
  });
  it("uses no calls when budget is zero", async () => {
    const calls = vi.fn(async () => ({ candidates: [] }));
    const result = await searchRiderEnvelope({ request, candidates: [candidate(600, 0.1)], provider: { id: "test", capabilities: () => ({ profiles: [], supportsAlternatives: false, supportsAvoidPolygons: true }), candidates: calls }, maxCalls: 0, deadlineMs: 1000, signal: new AbortController().signal });
    expect(calls).not.toHaveBeenCalled();
    expect(result.calls).toBe(0);
  });
  it("rejects a candidate that fails the canonical gate", async () => {
    const result = await searchRiderEnvelope({ request, candidates: [candidate(600, 0.1)], provider: { id: "test", capabilities: () => ({ profiles: [], supportsAlternatives: false, supportsAvoidPolygons: true }), candidates: async () => ({ candidates: [candidate(600, 0.9)] }) }, verify: async () => [], maxCalls: 3, deadlineMs: 1000, signal: new AbortController().signal });
    expect(result.candidate?.roadSummary?.surfaceByRoadClassMeters["gravel|track"]).toBe(1000);
  });
});

it("screens hard constraints before using a trial to steer the interval", async () => {
  const result = await searchRiderEnvelope({ request, candidates: [candidate(600, 0.1)], provider: { id: "test", capabilities: () => ({ profiles: [], supportsAlternatives: false, supportsAvoidPolygons: true }), candidates: async r => ({ candidates: [r.options.riderModeFactor === 0 ? candidate(600, 0.1) : candidate(600, 0.9)] }) }, screen: next => (riderEnvelopeMetrics(next)?.unpavedShare ?? 0) < 0.5, maxCalls: 3, deadlineMs: 1000, signal: new AbortController().signal });
  expect(result.candidate?.roadSummary?.surfaceByRoadClassMeters["gravel|track"]).toBe(1000);
});

describe("dirt sweep", () => {
  const provider = (answer: (factor: number) => ProviderCandidate[]) => ({ id: "test", capabilities: () => ({ profiles: [], supportsAlternatives: true, supportsAvoidPolygons: true }), candidates: vi.fn(async (r: ProviderRouteRequest) => ({ candidates: answer(r.options.riderModeFactor ?? 1) })) });
  it("fires every strength at once and finds a step bisection skipped", async () => {
    // Lock Haven -> Slate Run, live 2026-10-04: no dirt below 1.25, then 126 min
    // with 28% as an alternative; 2 and up only give a slower line with no more dirt.
    const fast = candidate(91 * 60, 0);
    const p = provider(f => f < 1.25 ? [fast] : f < 2 ? [fast, candidate(126 * 60, 0.28)] : [candidate(133 * 60, 0.26)]);
    const result = await searchRiderEnvelope({ request, candidates: [fast], provider: p, maxCalls: 3, sweepCalls: 7, deadlineMs: 1000, signal: new AbortController().signal });
    expect(p.candidates).toHaveBeenCalledTimes(7);
    expect(result.calls).toBe(7);
    expect(result.candidate?.durationSeconds).toBe(126 * 60);
    expect(result.candidate?.providerMetadata?.["riderModeFactor"]).toBe(1.25);
  });
  it("asks for alternatives on every strength but the baseline", async () => {
    const p = provider(() => [candidate(600, 0)]);
    await searchRiderEnvelope({ request, candidates: [candidate(600, 0)], provider: p, maxCalls: 3, sweepCalls: 4, deadlineMs: 1000, signal: new AbortController().signal });
    const asked = p.candidates.mock.calls.map(([r]) => [r.options.riderModeFactor, r.options.includeAlternatives]);
    expect(asked).toEqual([[0, false], [2, true], [1.25, true], [3, true]]);
  });
  it("keeps the pool when some strengths fail", async () => {
    const p = { ...provider(() => []), candidates: vi.fn(async (r: ProviderRouteRequest) => {
      if (r.options.riderModeFactor === 2) throw Error("timeout");
      return { candidates: [r.options.riderModeFactor === 0 ? candidate(600, 0) : candidate(700, 0.3)] };
    }) };
    const result = await searchRiderEnvelope({ request, candidates: [candidate(620, 0)], provider: p, maxCalls: 3, sweepCalls: 3, deadlineMs: 1000, signal: new AbortController().signal });
    expect(result.candidate?.durationSeconds).toBe(700);
  });
  it("verifies one copy of a line several strengths returned", async () => {
    const verify = vi.fn(async (proposed: readonly ProviderCandidate[]) => proposed);
    await searchRiderEnvelope({ request, candidates: [candidate(600, 0)], provider: provider(f => [f === 0 ? candidate(600, 0) : candidate(700, 0.3)]), verify, maxCalls: 3, sweepCalls: 5, deadlineMs: 1000, signal: new AbortController().signal });
    // The baseline repeats the pipeline's own line and four strengths share one dirt line.
    expect(verify.mock.calls[0]![0]).toHaveLength(1);
  });
});

it("ignores the pipeline's fastest-profile line when it sets the cap", async () => {
  // Gettysburg -> Pine Grove, live 2026-10-04: fastest 36 min, adventure 44, dirt 66 min 28%.
  const fastestLine = { ...candidate(36 * 60, 0), profile: "motorcycle_fastest" };
  const result = await searchRiderEnvelope({ request, candidates: [fastestLine, candidate(44 * 60, 0)], provider: { id: "test", capabilities: () => ({ profiles: [], supportsAlternatives: true, supportsAvoidPolygons: true }), candidates: async r => ({ candidates: [r.options.riderModeFactor === 0 ? { ...candidate(37.6 * 60, 0), profile: "motorcycle_fastest" } : candidate(66.3 * 60, 0.28)] }) }, maxCalls: 3, sweepCalls: 3, deadlineMs: 1000, signal: new AbortController().signal });
  expect(result.candidate?.durationSeconds).toBe(66.3 * 60);
});

describe("dirt valued in kilometres", () => {
  const provider = (answer: (factor: number) => ProviderCandidate[]) => ({ id: "test", capabilities: () => ({ profiles: [], supportsAlternatives: true, supportsAvoidPolygons: true }), candidates: async (r: ProviderRouteRequest) => ({ candidates: answer(r.options.riderModeFactor ?? 1) }) });
  const run = (initial: ProviderCandidate, answer: (factor: number) => ProviderCandidate[]) => searchRiderEnvelope({ request, candidates: [initial], provider: provider(answer), maxCalls: 3, sweepCalls: 3, deadlineMs: 1000, signal: new AbortController().signal });
  it("pays the same minutes for the same dirt km on a long trip as on a short one", async () => {
    // 10% of a 300 km day is 30 km of dirt: worth 20 extra minutes, though only 10 pp.
    const long = await run(candidate(300 * 60, 0, 300_000), f => [f === 0 ? candidate(300 * 60, 0, 300_000) : candidate(320 * 60, 0.1, 300_000)]);
    expect(long.candidate?.durationSeconds).toBe(320 * 60);
  });
  it("prefers one long stretch to the same dirt in scraps", () => {
    const scraps = candidate(3600, 0, 60_000);
    const runs = Array.from({ length: 20 }, (_, i) => ({ meters: 400, durationSeconds: null, surface: i % 2 === 0 ? "gravel" : "asphalt", roadClass: "unclassified", urbanDensity: "rural", roadEnvironment: "road", toll: false, curvatureRatio: null }));
    const scrappy = riderEnvelopeMetrics({ ...scraps, roadSummary: { ...scraps.roadSummary!, surfaceByRoadClassMeters: { "gravel|unclassified": 4000 }, roadRuns: runs } });
    const stretch = riderEnvelopeMetrics({ ...scraps, roadSummary: { ...scraps.roadSummary!, surfaceByRoadClassMeters: { "gravel|unclassified": 4000 }, roadRuns: [{ ...runs[0]!, meters: 4000 }] } });
    expect(scrappy?.unpavedShare).toBe(stretch?.unpavedShare);
    expect(stretch!.dirtValueKm).toBeCloseTo(6);
    expect(scrappy!.dirtValueKm).toBeCloseTo(2.2);
  });
});

describe("dirt loops", () => {
  const loop = { ...request, destination: request.origin, discovery: { targetMinutes: 120, toleranceMinutes: 15 } } as ProviderRouteRequest;
  const never = { id: "test", capabilities: () => ({ profiles: [], supportsAlternatives: true, supportsAvoidPolygons: true }), candidates: vi.fn(async () => ({ candidates: [] })) };
  it("leads with the dirtiest loop that fits the window, without router calls", async () => {
    // Pine Grove dual-sport on honest ETAs: the pick was 119 min with 2% dirt; a 130-min loop had 31%.
    const paved = candidate(119 * 60, 0.02);
    const result = await searchRiderEnvelope({ request: loop, candidates: [paved, candidate(113 * 60, 0.05), candidate(130 * 60, 0.31), candidate(140 * 60, 0.6)], incumbent: paved, provider: never, maxCalls: 3, deadlineMs: 1000, signal: new AbortController().signal });
    expect(result.candidate?.durationSeconds).toBe(130 * 60);
    expect(result.calls).toBe(0);
    expect(never.candidates).not.toHaveBeenCalled();
  });
  it("keeps the pick when no loop in the window has meaningfully more dirt", async () => {
    const pick = candidate(119 * 60, 0.3);
    const result = await searchRiderEnvelope({ request: loop, candidates: [candidate(113 * 60, (0.3 * 119) / 113), pick, candidate(125 * 60, (0.3 * 119) / 125)], incumbent: pick, provider: never, maxCalls: 3, deadlineMs: 1000, signal: new AbortController().signal });
    expect(result.candidate).toBeNull();
  });
});
