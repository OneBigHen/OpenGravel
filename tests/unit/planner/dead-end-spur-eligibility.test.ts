import { describe, expect, it } from "vitest";
import {
  deadEndSpurEligibility,
  deadEndSpurRuleApplies,
  deadEndSpursOf,
} from "@/application/planner/dead-end-spur-eligibility";
import type { ProviderCandidate, ProviderRouteRequest } from "@/application/planner/route-provider";

const p = (east: number, north = 0) => ({ lat: 40 + north / 111195, lon: -77 + east / (111195 * Math.cos(40 * Math.PI / 180)) });
const request: ProviderRouteRequest = {
  requestId: "spur_rule",
  origin: p(0),
  destination: p(0),
  stops: [],
  shaping: [],
  avoidPolygons: [],
  profile: "motorcycle_adventure",
  options: { vehicle: "motorcycle", includeAlternatives: false, avoidHighways: false, tollPolicy: "allow-with-warning" },
  discovery: { targetMinutes: 60, toleranceMinutes: 9 },
};
const candidate = (geometry: ProviderCandidate["geometry"]): ProviderCandidate => ({
  providerId: "test", profile: "motorcycle_adventure", geometry, distanceMeters: 5000, durationSeconds: 3600,
});
const withSpur = candidate([p(-1000), p(0), p(600), p(0), p(0, 1000)]);
const clean = candidate([p(0), p(1000), p(1000, 1000), p(0, 1000), p(0)]);

describe("dead-end spur eligibility", () => {
  it("declines a route that rides down a dead-end road and back", () => {
    const verdict = deadEndSpurEligibility(withSpur, request, "reject");
    expect(verdict.eligible).toBe(false);
    expect(verdict.failures).toEqual([expect.objectContaining({ code: "dead-end-spur" })]);
    expect(verdict.failures[0]!.message).toMatch(/dead-end road and back/);
    expect(verdict.failures[0]!.message).toMatch(/0\.4 mi/);
  });

  it("keeps a route with no spur, in both modes", () => {
    expect(deadEndSpurEligibility(clean, request, "reject")).toEqual({ eligible: true, failures: [], warnings: [] });
    expect(deadEndSpurEligibility(clean, request, "warn")).toEqual({ eligible: true, failures: [], warnings: [] });
  });

  it("keeps a spur route as a last resort and says so, never calling it clear", () => {
    const verdict = deadEndSpurEligibility(withSpur, request, "warn");
    expect(verdict.eligible).toBe(true);
    expect(verdict.failures).toEqual([]);
    expect(verdict.warnings).toEqual([expect.objectContaining({ code: "dead-end-spur" })]);
  });

  it("counts every spur in the message", () => {
    const two = candidate([p(-1000), p(0), p(600), p(0), p(0, 1000), p(0, 1600), p(0, 1000), p(1000, 1000)]);
    expect(deadEndSpurEligibility(two, request, "reject").failures[0]!.message).toMatch(/2 dead-end roads/);
  });

  it("never judges a ride the rider drew or pinned themselves", () => {
    const point = p(600);
    const authored: ProviderRouteRequest[] = [
      { ...request, stops: [point] },
      { ...request, shaping: [point] },
      { ...request, roadSpans: [{ id: "span", mode: "must", direction: "either", anchors: [p(0), point] }] },
    ];
    for (const asked of authored) {
      expect(deadEndSpurRuleApplies(asked)).toBe(false);
      expect(deadEndSpurEligibility(withSpur, asked, "reject").eligible).toBe(true);
    }
    expect(deadEndSpurRuleApplies(request)).toBe(true);
  });

  it("applies to point-to-point rides too, but not to a turnaround at the destination", () => {
    const toB: ProviderRouteRequest = { ...request, destination: p(600), discovery: undefined };
    delete (toB as { discovery?: unknown }).discovery;
    expect(deadEndSpurEligibility(withSpur, toB, "reject").eligible).toBe(false);
    expect(deadEndSpurEligibility(candidate([p(-1000), p(0), p(600)]), toB, "reject").eligible).toBe(true);
  });

  it("measures the same line once", () => {
    expect(deadEndSpursOf(withSpur.geometry)).toBe(deadEndSpursOf(withSpur.geometry));
    expect(deadEndSpursOf(withSpur.geometry)).toHaveLength(1);
  });
});
