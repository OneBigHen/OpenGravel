import { expect, it } from "vitest";
import { riderRoadEligibility } from "@/application/planner/rider-road-eligibility";
import type { ProviderCandidate, ProviderRoadRun } from "@/application/planner/route-provider";
const run: ProviderRoadRun = { meters: 1000, durationSeconds: 100, surface: "gravel", roadClass: "track", roadEnvironment: "road", urbanDensity: "rural", curvatureRatio: 1, toll: false, carAccess: true, roadAccess: "yes", trackType: "grade2" };
const candidate = (patch: Partial<ProviderRoadRun>): ProviderCandidate => ({ geometry: [], distanceMeters: 1000, durationSeconds: 100, providerId: "test", profile: "test", roadSummary: { totalMeters: 1000, surfaceByRoadClassMeters: { "gravel|track": 1000 }, curvatureMeters: {}, tollMeters: 0, roadRuns: [{ ...run, ...patch }] } });
it("hard-gates current sand/private/no-car facts independently of corridor prizes", () => {
  for (const patch of [{ surface: "sand" }, { roadAccess: "private" }, { carAccess: false }]) expect(riderRoadEligibility(candidate(patch), {}).eligible).toBe(false);
});
it("opens grade3–4 only for a dual-sport with explicit rough permission", () => {
  expect(riderRoadEligibility(candidate({ trackType: "grade3" }), { bike: { category: "street", maintainedGravel: "allow", roughTracks: "allow" } }).eligible).toBe(false);
  expect(riderRoadEligibility(candidate({ trackType: "grade4" }), { bike: { category: "dual-sport", maintainedGravel: "allow", roughTracks: "allow" } }).eligible).toBe(true);
  expect(riderRoadEligibility(candidate({ trackType: "grade5" }), { bike: { category: "dual-sport", maintainedGravel: "allow", roughTracks: "allow" } }).eligible).toBe(false);
});
it("does not invent restrictions from missing facts", () => {
  expect(riderRoadEligibility(candidate({ carAccess: null, roadAccess: null, trackType: null }), {}).eligible).toBe(true);
});
