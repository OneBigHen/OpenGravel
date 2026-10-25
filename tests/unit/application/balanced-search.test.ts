import { describe, expect, it, vi } from "vitest";
import { planRide } from "@/server/planning/plan-service";
import { analyzeBends } from "@/domain/geometry/bends";
import { searchBalancedEnvelope } from "@/application/planner/balanced-search";
import type { ProviderCandidate, ProviderRouteRequest } from "@/application/planner/route-provider";

const request: ProviderRouteRequest = { requestId: "balanced", origin: { lat: 40, lon: -75 }, destination: { lat: 40, lon: -74.8 }, stops: [], shaping: [], avoidPolygons: [], profile: "motorcycle_fastest", options: { vehicle: "motorcycle", tollPolicy: "avoid", avoidHighways: false, includeAlternatives: true, roadCharacter: "balanced", traffic: "protect-ride" } };
const route = (minutes: number, franco: number, busy = 0, profile = request.profile): ProviderCandidate => ({
  providerId: "test", profile, geometry: [request.origin, request.destination], durationSeconds: minutes * 60, distanceMeters: 17_000 + franco, providerMetadata: { franco },
  roadSummary: { totalMeters: 17_000, surfaceByRoadClassMeters: { "asphalt|secondary": 17_000 }, curvatureMeters: {}, tollMeters: 0, roadRuns: [{ meters: 17_000 * busy, durationSeconds: null, surface: "asphalt", roadClass: "primary", urbanDensity: "rural", roadEnvironment: "road", toll: false, curvatureRatio: null }, { meters: 17_000 * (1 - busy), durationSeconds: null, surface: "asphalt", roadClass: "secondary", urbanDensity: "rural", roadEnvironment: "road", toll: false, curvatureRatio: null }] },
});
const provider = (answer: (r: ProviderRouteRequest) => ProviderCandidate[]) => ({ id: "test", capabilities: () => ({ profiles: [], supportsAlternatives: true, supportsAvoidPolygons: true }), candidates: vi.fn(async (r: ProviderRouteRequest) => ({ candidates: answer(r) })) });


describe("Balanced fun envelope", () => {
  const balanced = { ...request, profile: "motorcycle_fastest", options: { ...request.options, roadCharacter: "balanced" as const } };
  const measure = (candidate: ProviderCandidate) => ({ perKm: Number(candidate.providerMetadata?.["franco"] ?? 0), bendMeters: Number(candidate.providerMetadata?.["bendMeters"] ?? 0) });
  const bendy = (minutes: number, franco: number, bendMeters: number, busy = 0) => {
    const candidate = route(minutes, franco, busy, balanced.profile);
    return { ...candidate, providerMetadata: { ...candidate.providerMetadata, bendMeters } };
  };
  const run = (candidates: ProviderCandidate[], override: Partial<Parameters<typeof searchBalancedEnvelope>[0]> = {}) => searchBalancedEnvelope({ request: balanced, candidates, incumbent: candidates[0], provider: provider(() => []), maxCalls: 2, deadlineMs: 1000, signal: new AbortController().signal, measure, ...override });
  it("buys real curves within 25% of fastest, never 25% of the slower incumbent", async () => {
    const fastest = bendy(48, 15, 2000);
    const incumbent = bendy(53, 23, 4750);
    const good = bendy(59, 65, 8500);
    const tooSlow = bendy(61, 90, 12000);
    const result = await run([incumbent, fastest, good, tooSlow]);
    expect(result.candidate?.durationSeconds).toBe(59 * 60);
  });
  it("brings an over-budget incumbent back inside the fastest envelope", async () => {
    const result = await run([bendy(70, 100, 15000), bendy(48, 15, 2000), bendy(59, 60, 8000)]);
    expect(result.candidate?.durationSeconds).toBe(59 * 60);
  });
  it("does not infer low exposure from missing road measurements", async () => {
    const unknown = { ...bendy(52, 100, 12000), roadSummary: undefined };
    expect((await run([bendy(48, 20, 4000), unknown])).candidate).toBeNull();
  });
  it("does not spend time for nominal curvature or street-corner counts", async () => {
    const incumbent = bendy(48, 30, 4000);
    expect((await run([incumbent, bendy(55, 33, 8000), bendy(50, 90, 4100)])).candidate).toBeNull();
  });
  it("keeps busy-road exposure bounded", async () => {
    expect((await run([bendy(48, 20, 4000), bendy(52, 90, 9000, 0.5)])).candidate).toBeNull();
  });
  it("rejects residential bend farming", async () => {
    const farm = bendy(52, 100, 12000);
    const roadSummary = farm.roadSummary!;
    const streets = { ...farm, roadSummary: { ...roadSummary, roadRuns: roadSummary.roadRuns!.map(run => ({ ...run, roadClass: "residential", urbanDensity: "residential" })) } };
    expect((await run([bendy(48, 20, 4000), streets])).candidate).toBeNull();
  });
  it("generates extra seeded twisty loops, respects the timebox, and verifies them", async () => {
    const incumbent = bendy(110, 30, 6000);
    const good = bendy(125, 75, 15000);
    const late = bendy(150, 100, 18000);
    const p = provider(() => [good, late]);
    const verify = vi.fn(async (proposed: readonly ProviderCandidate[]) => proposed);
    const loop = { ...balanced, destination: balanced.origin, discovery: { targetMinutes: 120, toleranceMinutes: 15 } };
    const result = await run([incumbent], { request: loop, provider: p, verify });
    expect(result.candidate?.durationSeconds).toBe(125 * 60);
    expect(p.candidates).toHaveBeenCalledTimes(2);
    expect(p.candidates.mock.calls.every(([r]) => r.profile === "motorcycle_twisty" && r.requestId !== loop.requestId)).toBe(true);
    expect(verify).toHaveBeenCalled();
    expect((await run([incumbent], { request: loop, provider: p, verify: async () => [] })).candidate).toBeNull();
  });
  it("leaves authored shaping, stops and sketches in charge", async () => {
    const p = provider(() => [bendy(52, 100, 9000)]);
    await run([bendy(48, 20, 4000)], { provider: p, request: { ...balanced, shaping: [balanced.origin] } });
    expect(p.candidates).not.toHaveBeenCalled();
  });
  it.each([0, 1, 2])("obeys a provider-call budget of %s", async maxCalls => {
    const p = provider(() => []);
    const result = await run([bendy(48, 20, 4000)], { provider: p, maxCalls });
    expect(p.candidates).toHaveBeenCalledTimes(maxCalls);
    expect(result.calls).toBe(maxCalls);
  });
  it("does not repeat equivalent strengths when busy-road avoidance is off", async () => {
    const p = provider(() => []);
    await run([bendy(48, 20, 4000)], { provider: p, request: { ...balanced, options: { ...balanced.options, traffic: "minimize-delay" } } });
    expect(p.candidates).toHaveBeenCalledTimes(1);
  });
  it("keeps residential safeguards when the incumbent has no road runs", async () => {
    const incumbent = { ...bendy(48, 20, 4000), roadSummary: undefined };
    const farm = bendy(52, 100, 12000);
    const streets = { ...farm, roadSummary: { ...farm.roadSummary!, roadRuns: farm.roadSummary!.roadRuns!.map(run => ({ ...run, roadClass: "residential", urbanDensity: "residential" })) } };
    expect((await run([incumbent, streets])).candidate).toBeNull();
  });
  it("propagates rider cancellation", async () => {
    const controller = new AbortController();
    controller.abort(new Error("rider stopped"));
    await expect(run([bendy(48, 20, 4000)], { signal: controller.signal })).rejects.toThrow("rider stopped");
  });
});


it.each(["yes", "private", "no"])("the complete plan gates a generated %s road before it can lead", async roadAccess => {
  const geometry = Array.from({ length: 801 }, (_, index) => ({
    lon: request.origin.lon + (request.destination.lon - request.origin.lon) * index / 800,
    lat: request.origin.lat + Math.sin(index / 800 * Math.PI * 64) * 0.002,
  }));
  const fast = route(48, 0);
  const curved = route(58, 100);
  const generated = { ...curved, geometry, roadSummary: {
    ...curved.roadSummary!, bendMeters: analyzeBends(geometry).bendMeters,
    roadRuns: curved.roadSummary!.roadRuns!.map(run => ({ ...run, roadAccess })),
  } };
  const p = provider(asked => asked.options.riderModeFactor === undefined ? [fast] : [generated]);
  const result = await planRide({ identity: { rideId: "balanced-gates", rideRevision: 1, planningGeneration: 1 }, request }, {
    provider: p, env: {}, roadAuthority: null,  funCharacterClassifier: null,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const best = result.bundle.candidates.find(candidate => candidate.id === result.bundle.roles["best-ride"]);
  const fastest = result.bundle.candidates.find(candidate => candidate.id === result.bundle.roles.fastest);
  expect(best?.durationSeconds).toBe((roadAccess === "yes" ? 58 : 48) * 60);
  expect(fastest?.durationSeconds).toBe(48 * 60);
});
