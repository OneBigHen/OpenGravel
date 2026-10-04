import { describe, expect, it } from "vitest";
import { refineRiderTraffic } from "@/application/planner/rider-live-traffic";
import type { ProviderCandidate, ProviderRouteRequest, RouteCandidateProvider } from "@/application/planner/route-provider";
const line = [{ lat: 40, lon: -75 }, { lat: 40.01, lon: -75 }];
const candidate: ProviderCandidate = { providerId: "test", profile: "motorcycle_fastest", geometry: line, durationSeconds: 600, distanceMeters: 1100 };
const request: ProviderRouteRequest = { requestId: "test", origin: line[0]!, destination: line[1]!, stops: [], shaping: [], avoidPolygons: [], profile: candidate.profile, options: { vehicle: "motorcycle", includeAlternatives: false, avoidHighways: false, tollPolicy: "avoid", traffic: "protect-ride", departureNow: true } };
const provider = (next: ProviderCandidate): RouteCandidateProvider => ({ id: "test", capabilities: () => ({ profiles: [], supportsAlternatives: false, supportsAvoidPolygons: true }), candidates: async r => { expect(r.options.trafficPenaltyPolygons).toHaveLength(1); return { candidates: [next] }; } });
describe("live congestion soft avoidance", () => {
  it("keeps a jam-free detour within ten percent", async () => {
    const next = { ...candidate, durationSeconds: 650, geometry: line.map(p => ({ ...p, lon: p.lon + 0.01 })) };
    const result = await refineRiderTraffic({ request, candidate, provider: provider(next), signal: new AbortController().signal, sample: async () => [{ geometry: line, currentSpeed: 20, freeFlowSpeed: 50, delaySeconds: 120 }] });
    expect(result?.durationSeconds).toBe(650);
  });
  it("fails open when traffic is unavailable", async () => {
    expect(await refineRiderTraffic({ request, candidate, provider: provider(candidate), signal: new AbortController().signal, sample: async () => { throw Error("quota"); } })).toBeNull();
  });
  it("never samples future departures or efficient mode", async () => {
    const sample = async () => { throw Error("must not sample"); };
    expect(await refineRiderTraffic({ request: { ...request, options: { ...request.options, departureNow: false } }, candidate, provider: provider(candidate), signal: new AbortController().signal, sample })).toBeNull();
  });
});

describe("live detour bounds", () => {
  it("rejects a slower route outside the ten percent cap", async () => {
    const next = { ...candidate, durationSeconds: 800, geometry: line.map(p => ({ ...p, lon: p.lon + 0.01 })) };
    expect(await refineRiderTraffic({ request, candidate, provider: provider(next), signal: new AbortController().signal, sample: async () => [{ geometry: line, currentSpeed: 20, freeFlowSpeed: 50, delaySeconds: 30 }] })).toBeNull();
  });
});

it("does not claim adjusted-time improvement without observed delay data", async () => {
  expect(await refineRiderTraffic({ request, candidate, provider: provider({ ...candidate, durationSeconds: 590 }), signal: new AbortController().signal, sample: async () => [{ geometry: line, currentSpeed: 20, freeFlowSpeed: 50, delaySeconds: null }] })).toBeNull();
});
