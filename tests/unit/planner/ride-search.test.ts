import { describe, expect, it } from "vitest";
import { candidateGoodMeters } from "@/application/planner/geometry-fun";
import { RIDE_BUDGETS, rideBudgetFactor } from "@/application/planner/ride-budget";
import {
  MAX_WAVE_CALLS,
  pickRide,
  runWave,
  waveCandidates,
  waveMembers,
  type WaveCandidate,
  type WaveMember,
} from "@/application/planner/ride-search";
import type { ProviderCandidate, ProviderRouteRequest, RouteCandidateProvider } from "@/application/planner/route-provider";
import { createGraphHopperRequest } from "@/infrastructure/routing/graphhopper/request-builder";
import { riderModeRules, STRONG_CURVE_RULE } from "@/infrastructure/routing/graphhopper/rider-modes";

const request: ProviderRouteRequest = {
  requestId: "ride", origin: { lat: 41.13, lon: -77.44 }, destination: { lat: 41.42, lon: -77.66 },
  stops: [], shaping: [], avoidPolygons: [], profile: "motorcycle_adventure",
  options: {
    includeAlternatives: true, avoidHighways: false, tollPolicy: "allow-with-warning", vehicle: "motorcycle",
    roadCharacter: "balanced", surfacePreference: "dirt-preferred", targetUnpavedShare: 0.5, traffic: "protect-ride",
    bike: { category: "adventure", maintainedGravel: "allow", roughTracks: "avoid" },
  },
};
const curvy: ProviderRouteRequest = {
  ...request, profile: "motorcycle_twisty",
  options: { ...request.options, roadCharacter: "curvy", surfacePreference: "mixed", targetUnpavedShare: undefined, bike: { category: "street", maintainedGravel: "allow", roughTracks: "avoid" } },
};

/** A straight line of `minutes` whose road runs are `dirtShare` gravel. */
function route(minutes: number, dirtShare: number, id = `${minutes}:${dirtShare}`): ProviderCandidate {
  const meters = minutes * 1000;
  return {
    providerId: "test", profile: "motorcycle_adventure", distanceMeters: meters, durationSeconds: minutes * 60,
    geometry: [{ lat: 41, lon: -77 }, { lat: 41 + minutes / 1e4, lon: -77 + dirtShare / 1e3 }], instructions: [],
    providerMetadata: { id },
    roadSummary: {
      totalMeters: meters, surfaceByRoadClassMeters: { "gravel|track": meters * dirtShare }, curvatureMeters: {}, tollMeters: 0,
      roadRuns: [
        { meters: meters * dirtShare, surface: "gravel", roadClass: "track", roadEnvironment: "road", urbanDensity: "rural", curvatureRatio: null, toll: null, durationSeconds: null },
        { meters: meters * (1 - dirtShare), surface: "asphalt", roadClass: "secondary", roadEnvironment: "road", urbanDensity: "rural", curvatureRatio: null, toll: null, durationSeconds: null },
      ],
    },
  };
}
const member = (role: WaveMember["role"]): WaveMember => ({ role, factor: role === "fastest" ? 0 : 1, request });
const entry = (candidate: ProviderCandidate, role: WaveMember["role"] = "own"): WaveCandidate => ({ candidate, member: member(role) });

describe("ride budget", () => {
  it("is Direct 1.15, Balanced 1.35, Scenic 1.75, Balanced by default", () => {
    expect(RIDE_BUDGETS).toEqual({ direct: 1.15, balanced: 1.35, scenic: 1.75 });
    expect(rideBudgetFactor(undefined)).toBe(1.35);
  });
});

describe("A-to-B in one wave", () => {
  it("sends at most five single-route calls, all started before any finishes", async () => {
    const started: ProviderRouteRequest[] = [];
    const release: (() => void)[] = [];
    const provider: RouteCandidateProvider = {
      id: "test", capabilities: () => ({ profiles: [], supportsAlternatives: true, supportsAvoidPolygons: true }),
      candidates: wanted => new Promise(resolve => {
        started.push(wanted);
        release.push(() => resolve({ candidates: [route(60 + started.length, 0)] }));
      }),
    };
    const anchors = [{ lat: 41.2, lon: -77.5 }, { lat: 41.3, lon: -77.6 }, { lat: 41.35, lon: -77.62 }];
    const members = waveMembers({ request, ownProfile: "motorcycle_adventure", fastestProfile: "motorcycle_fastest", graph: null, anchors });
    expect(members).toHaveLength(MAX_WAVE_CALLS);
    const running = runWave(members, provider, new AbortController().signal);
    await Promise.resolve();
    // Every call is in flight while none has answered.
    expect(started).toHaveLength(5);
    release.forEach(done => done());
    const answers = await running;
    expect(answers.every(answer => answer.candidates.length === 1)).toBe(true);
    expect(started.every(sent => sent.options.includeAlternatives === false)).toBe(true);
    expect(started.map(sent => sent.shaping.length)).toEqual([0, 0, 0, 1, 1]);
  });

  it("is three calls without a detour source: fastest, the first answer's own request, strong", () => {
    const members = waveMembers({ request, ownProfile: "motorcycle_adventure", fastestProfile: "motorcycle_fastest", graph: null });
    expect(members.map(m => m.role)).toEqual(["fastest", "own", "strong"]);
    expect(members[0]!.request).toMatchObject({ profile: "motorcycle_fastest", options: { riderModeFactor: 0, roadCharacter: "efficient", bike: request.options.bike } });
    // Byte for byte the first answer's request, so a shared provider reuses it.
    expect(members[1]!.request).toEqual({ ...request, options: { ...request.options, includeAlternatives: false } });
    expect(members[2]!.request.options.riderModeFactor).toBe(3);
  });

  it("asks curvy 'strong' through og_curve only when the graph lists it", () => {
    const old = waveMembers({ request: curvy, ownProfile: "motorcycle_twisty", fastestProfile: "motorcycle_fastest", graph: { encodedValues: ["surface", "road_class"] } });
    expect(old[2]!.request.options.curvePressure).toBeUndefined();
    const v2 = waveMembers({ request: curvy, ownProfile: "motorcycle_twisty", fastestProfile: "motorcycle_fastest", graph: { encodedValues: ["surface", "og_curve", "og_through"] } });
    expect(v2[2]!.request.options.curvePressure).toBe("strong");
  });

  it("never sends an og_curve rule to a graph that does not list og_curve", () => {
    const strong = { ...curvy, options: { ...curvy.options, includeAlternatives: false, curvePressure: "strong" as const } };
    const text = (encoded?: ReadonlySet<string>) => JSON.stringify(createGraphHopperRequest(strong, { details: [], ...(encoded === undefined ? {} : { encodedValues: encoded }) }));
    expect(text()).not.toContain("og_curve");
    expect(text(new Set(["surface", "road_class"]))).not.toContain("og_curve");
    expect(text(new Set(["og_curve"]))).toContain(STRONG_CURVE_RULE.if);
  });

  it("does not repeat the busy-road penalties a v2 profile already bakes", () => {
    const busy = (rules: readonly { if?: string }[]) => rules.filter(rule => rule.if === "road_class == PRIMARY");
    expect(busy(riderModeRules(curvy.options, true, false, "motorcycle_twisty"))).toHaveLength(1);
    expect(busy(riderModeRules(curvy.options, true, false, "motorcycle_twisty", new Set(["og_curve"])))).toHaveLength(0);
    // A stronger search still asks for what lies beyond strength 1.
    expect(busy(riderModeRules({ ...curvy.options, riderModeFactor: 3 }, true, false, "motorcycle_twisty", new Set(["og_curve"])))[0]).toMatchObject({ multiply_by: String(Number((0.8 ** 2).toFixed(4))) });
  });

  it("keeps one copy of a line two calls both found", () => {
    const same = route(60, 0.2);
    const all = waveCandidates([{ member: member("own"), candidates: [same], error: null }, { member: member("strong"), candidates: [{ ...same }], error: null }]);
    expect(all).toHaveLength(1);
    expect(all[0]!.member.role).toBe("own");
  });
});

describe("pick once", () => {
  const fastest = entry(route(60, 0), "fastest");

  it("picks the most good miles by good-miles.ts inside the budget", () => {
    const some = entry(route(70, 0.2));
    const most = entry(route(80, 0.3), "strong");
    const pick = pickRide({ eligible: [fastest, some, most], reference: fastest.candidate, mode: "dirt", protectBusy: true });
    expect(pick.chosen).toBe(most);
    const scores = [fastest, some, most].map(item => candidateGoodMeters(item.candidate, "dirt"));
    expect(candidateGoodMeters(pick.chosen!.candidate, "dirt")).toBe(Math.max(...scores));
  });

  it("never picks a ride over budget while one fits, however much dirt it has", () => {
    const over = entry(route(60 * 1.35 + 1, 0.9), "strong");
    const inside = entry(route(75, 0.1));
    const pick = pickRide({ eligible: [fastest, over, inside], mode: "dirt", protectBusy: true });
    expect(pick.chosen).toBe(inside);
    expect(pick.overBudget).toBe(false);
    expect(pickRide({ eligible: [fastest, entry(route(70, 0.9))], mode: "dirt", budget: "direct", protectBusy: true }).chosen!.candidate.durationSeconds).toBe(60 * 60);
  });

  it("breaks a tie in good miles with the shorter time", () => {
    const slow = entry(route(80, 0.25));
    const quick = entry({ ...route(70, 0.25 * 80 / 70), providerMetadata: { id: "quick" } });
    expect(pickRide({ eligible: [fastest, slow, quick], mode: "dirt", protectBusy: true }).chosen).toBe(quick);
  });

  it("offers the closest to the budget, marked over, when nothing fits", () => {
    const a = entry(route(100, 0.4));
    const b = entry(route(95, 0.1));
    // The fastest line failed a hard gate (a closure); the budget still runs from it.
    const pick = pickRide({ eligible: [a, b], reference: fastest.candidate, mode: "dirt", budget: "direct", protectBusy: true });
    expect(pick.referenceSeconds).toBe(60 * 60);
    expect(pick.chosen).toBe(b);
    expect(pick.overBudget).toBe(true);
    // Without a reference the quickest eligible line sets it, and fits.
    expect(pickRide({ eligible: [a, b], mode: "dirt", budget: "direct", protectBusy: true }).overBudget).toBe(false);
    const none = pickRide({ eligible: [], mode: "dirt", protectBusy: true });
    expect(none.chosen).toBeNull();
  });

  it("Efficient takes the quickest line", () => {
    expect(pickRide({ eligible: [entry(route(65, 0.5)), fastest], mode: "time", protectBusy: true }).chosen).toBe(fastest);
  });
});
