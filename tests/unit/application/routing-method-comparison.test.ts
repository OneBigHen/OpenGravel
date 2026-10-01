import { describe, expect, it } from "vitest";
import { buildRoutingMethodComparison } from "@/application/planner/routing-method-comparison";
import { emptyRouteRoles } from "@/application/planner/planning-session";
import { defaultRideIntent } from "@/domain/ride/create";
import { asGeometryRef, newRideId } from "@/domain/ride/ids";
import { asRouteCandidateId } from "@/domain/route/ids";
import type { RouteBundle, RouteCandidate, RouteScoreComponents } from "@/domain/route/types";

function route(id: string, minutes: number, curvature: number | null, longest: number | null): RouteCandidate {
  const component = (input: number | null) => ({ input, weight: 1, contribution: input ?? 0, explanationKey: "test", evidenceStatus: input === null ? "unknown" as const : "estimated" as const });
  const components: RouteScoreComponents = {
    curvature: component(curvature), backroad: component(0.8), surfaceFit: component(0.9),
    elevation: component(null), traffic: component(null), junctionFriction: component(null),
    novelty: component(null), closureRisk: component(null), timeCost: component(0), confidence: component(0.8),
  };
  return {
    id: asRouteCandidateId(id), geometryRef: asGeometryRef(`geo_${id}`), fingerprint: `fp_${id}`,
    provider: { providerId: "test", profile: "test" }, durationSeconds: minutes * 60, distanceMeters: 60_000,
    eligibility: { eligible: true, failures: [] }, warnings: [],
    score: { policyVersion: "test", total: 0.7, components },
    evidence: longest === null ? {} : { curvature: {
      value: { curvyMeters: 10_000, totalMeters: 60_000, unit: curvature, longestRunMeters: longest, continuityShare: longest / 10_000 },
      status: "estimated", confidence: 0.8, coverage: 1, provenance: [],
    } },
  };
}

const fast = route("fast", 60, 0.1, 80);
const chopped = route("chopped", 72, 0.95, 140);
const flow = route("flow", 75, 0.85, 1_400);
function bundle(candidates: readonly RouteCandidate[] = [fast, chopped, flow]): RouteBundle {
  return {
    rideId: newRideId(), rideRevision: 4, planningGeneration: 2,
    policyVersion: "test", graphVersion: "test", evidenceVersion: "test", candidates,
    roles: { ...emptyRouteRoles(), "best-ride": chopped.id, fastest: fast.id },
    selectedRouteId: chopped.id, selectionSource: "automatic", createdAt: "2026-10-01T00:00:00Z",
  };
}
function compare(routes = bundle(), overrides: Partial<Parameters<typeof buildRoutingMethodComparison>[0]> = {}) {
  return buildRoutingMethodComparison({ bundle: routes, selectedRouteId: routes.selectedRouteId, intent: defaultRideIntent(), stale: false, ...overrides });
}

describe("routing method comparisons", () => {
  it("compares loop added time against the timeboxed choices, excluding a short out-of-range route", () => {
    const outside = route("short", 30, 0.8, 50);
    const within = route("within", 75, 0.8, 200);
    const curves = route("curves", 90, 0.9, 1_000);
    const intent = { ...defaultRideIntent(), shape: "loop" as const, time: { kind: "budget" as const, targetMinutes: 75, toleranceMinutes: 15 } };
    const vm = compare(bundle([outside, within, curves]), { intent });
    expect(vm.methods[2]?.routeId).toBe(curves.id);
    expect(vm.methods[2]?.addedMinutes).toBe(15);
    expect(vm.methods[2]).toHaveProperty("addedTimeReference", "loop-comparison");
  });

  it.each(["curvature", "backroad"] as const)("withholds Frontier when %s has a finite but unknown input", (key) => {
    const unknown = route("unknown", 60, 0.8, 100);
    Object.assign(unknown.score.components[key], { evidenceStatus: "unknown" });
    expect(compare(bundle([unknown])).methods[1]?.routeId).toBeNull();
  });

  it("keeps unknown traffic and junction status unknown even with finite inputs", () => {
    const unknown = route("unknown", 60, 0.8, 100);
    Object.assign(unknown.score.components.traffic, { input: 0.2, evidenceStatus: "unknown" });
    Object.assign(unknown.score.components.junctionFriction, { input: 0.2, evidenceStatus: "unavailable" });
    expect(compare(bundle([unknown])).methods[1]?.caveat).toMatch(/unknown/i);
  });

  it("compares existing routes without mutating scores, roles or selection", () => {
    const routes = bundle();
    const before = JSON.stringify(routes);
    const vm = compare(routes);
    expect(vm.methods.map((method) => method.id)).toEqual(["classic", "frontier", "sustained-curves"]);
    expect(vm.methods[0]?.routeId).toBe(chopped.id);
    expect(vm.methods[2]?.routeId).toBe(flow.id);
    expect(vm.methods[2]?.addedMinutes).toBe(15);
    expect(JSON.stringify(routes)).toBe(before);
  });

  it("keeps frontier recommendations invariant under candidate order", () => {
    const left = compare(bundle());
    const right = compare(bundle([flow, fast, chopped]));
    expect(left.methods[1]?.routeId).not.toBeNull();
    expect(right.methods[1]?.routeId).toBe(left.methods[1]?.routeId);
  });

  it("never recommends an ineligible candidate, even if it carries a role", () => {
    const rejected = { ...chopped, eligibility: { eligible: false, failures: [] } };
    const vm = compare(bundle([fast, rejected, flow]));
    expect(vm.methods.every((method) => method.routeId !== chopped.id)).toBe(true);
  });

  it("bounds experimental detours to the canonical Best Ride envelope", () => {
    const distant = { ...flow, id: asRouteCandidateId("distant"), durationSeconds: 120 * 60 };
    const vm = compare(bundle([fast, chopped, distant]));
    expect(vm.methods.slice(1).every((method) => method.routeId !== distant.id)).toBe(true);
  });

  it("does not treat missing continuity as zero or claim a sustained run", () => {
    const vm = compare(bundle([route("unknown", 60, 0.7, null)]));
    expect(vm.methods[2]?.routeId).toBeNull();
    expect(vm.methods[2]?.caveat).toMatch(/continuity|sustained/i);
  });

  it("rejects impossible continuity metrics", () => {
    const bad = route("invalid", 60, 0.9, 11_000);
    expect(compare(bundle([bad])).methods[2]?.routeId).toBeNull();
  });

  it("distinguishes a measured straight route from unavailable continuity", () => {
    const straight = route("straight", 60, 0, 0);
    const vm = compare(bundle([straight]));
    expect(vm.methods[2]?.routeId).toBeNull();
    expect(vm.methods[2]?.caveat).toMatch(/no sustained bend run/i);
  });

  it("requires measured curvature and backroad values for the frontier profiles", () => {
    const sparse = route("sparse", 60, null, 100);
    expect(compare(bundle([sparse])).methods[1]?.routeId).toBeNull();
  });

  it("withholds frontier when only time is known", () => {
    const unknown = route("unknown", 60, null, null);
    for (const component of Object.values(unknown.score.components)) {
      Object.assign(component, { input: null, evidenceStatus: "unknown" });
    }
    expect(compare(bundle([unknown])).methods[1]?.routeId).toBeNull();
  });

  it("does not rebrand traffic or junction unknown as flowing traffic", () => {
    const vm = compare();
    expect(vm.methods[1]?.caveat).toMatch(/unknown/i);
    expect(vm.methods[2]?.detail).toMatch(/geometry|mapped/i);
  });

  it("respects a loop's timebox instead of rewarding a longer core", () => {
    const tooLong = route("long", 150, 1, 2_000);
    const intent = { ...defaultRideIntent(), shape: "loop" as const, time: { kind: "budget" as const, targetMinutes: 75, toleranceMinutes: 15 } };
    const vm = compare(bundle([fast, flow, tooLong]), { intent });
    expect(vm.methods.slice(1).every((method) => method.routeId !== tooLong.id)).toBe(true);
  });

  it("uses the planner's default loop timebox when no time was authored", () => {
    const near = route("near", 120, 0.8, 1_200);
    const far = route("far", 240, 1, 2_000);
    const vm = compare(bundle([near, far]), { intent: { ...defaultRideIntent(), shape: "loop" } });
    expect(vm.methods[2]?.routeId).toBe(near.id);
    expect(vm.methods[2]?.caveat).toMatch(/loop time/i);
  });

  it("preserves an explicitly stale flag for retained last-good results", () => {
    expect(compare(bundle(), { stale: true }).stale).toBe(true);
  });

  it("does not offer an empty bundle as a method", () => {
    expect(compare(bundle([])).methods).toEqual([]);
  });

  it("binds Jev only to the fingerprint it assessed, without changing methods", () => {
    const routes = bundle();
    const reading = { fingerprint: flow.fingerprint, label: "TWISTY" as const, confidence: 0.91, model: "jev-1.13.0", policyVersion: "test" };
    const withJev = compare(routes, { reading });
    expect(withJev.jev).toMatchObject({ state: "available", routeId: flow.id, confidence: 0.91 });
    expect(withJev.methods).toEqual(compare(routes).methods);
  });

  it.each(["fp_old-generation", "fp_unrelated"])("withholds unrelated Jev reading %s", (fingerprint) => {
    const reading = { fingerprint, label: "TWISTY" as const, confidence: 0.91, model: "jev-1.13.0", policyVersion: "test" };
    expect(compare(bundle(), { reading }).jev.state).toBe("unavailable");
  });

  it("withholds uncalibrated low-confidence, UNKNOWN or unpinned Jev readings", () => {
    const reading = { fingerprint: flow.fingerprint, label: "TWISTY" as const, confidence: 0.91, model: "jev-1.13.0", policyVersion: "test" };
    for (const invalid of [{ ...reading, confidence: NaN }, { ...reading, confidence: 0.4 }, { ...reading, label: "UNKNOWN" as const }, { ...reading, model: "jev-latest" }]) {
      expect(compare(bundle(), { reading: invalid }).jev.state).toBe("unavailable");
    }
  });
});
