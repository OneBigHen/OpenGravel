import { expect, it, vi } from "vitest";
import { runCandidatePipeline } from "@/application/planner/pipeline";
import type { ProviderCandidate } from "@/application/planner/route-provider";
import { PA_NJ_ROUTE_POLICY_VNEXT_1 as policy } from "@/domain/route/policy";
const a = { lat: 40, lon: -75 };
const b = { lat: 40.1, lon: -74.9 };
const candidate = (id: string, seconds: number, offset: number): ProviderCandidate => ({ providerId: "test", profile: "motorcycle_fastest", geometry: [a, { lat: 40.05 + offset, lon: -74.95 }, b], distanceMeters: 20000, durationSeconds: seconds, providerMetadata: { fingerprint: id } });

it("measures every eligible candidate before diversity and pins the bounded recommendation without changing RouteScore", () => {
  const candidates = [candidate("a", 1000, 0), candidate("b", 1200, 0.05)];
  const control = runCandidatePipeline({ candidates, intent: {}, policy });
  const valueFor = vi.fn((route: { fingerprint: string }) => route.fingerprint === "b" ? 90 : 20);
  const treatment = runCandidatePipeline({ candidates, intent: {}, policy, candidateValueFor: valueFor });
  expect(valueFor).toHaveBeenCalledTimes(2);
  expect(treatment.candidates[treatment.roles["best-ride"]!]?.fingerprint).toBe("b");
  for (const route of treatment.candidates) expect(route.score).toEqual(control.candidates.find(other => other.fingerprint === route.fingerprint)?.score);
});

it("never calls recommendation scoring for ineligible answers and rejects over-cap value", () => {
  const candidates = [candidate("a", 1000, 0), candidate("slow", 1500, 0.05), { ...candidate("bad", 900, 0), geometry: [a] }];
  const valueFor = vi.fn((route: { fingerprint: string }) => route.fingerprint === "slow" ? 100 : 10);
  const treatment = runCandidatePipeline({ candidates, intent: {}, policy, candidateValueFor: valueFor });
  expect(valueFor).toHaveBeenCalledTimes(2);
  expect(treatment.candidates[treatment.roles["best-ride"]!]?.fingerprint).toBe("a");
});

it("null measurements leave the canonical result identical", () => {
  const input = { candidates: [candidate("a", 1000, 0), candidate("b", 1200, 0.05)], intent: {}, policy };
  expect(runCandidatePipeline({ ...input, candidateValueFor: () => null })).toEqual(runCandidatePipeline(input));
});
