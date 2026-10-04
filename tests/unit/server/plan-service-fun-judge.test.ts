/**
 * FUN JUDGE promotion path through the real plan service (`OGV_JEV_FUN_JUDGE`).
 * The judge here is a test double at the application port; the pipeline,
 * eligibility, scoring and roles are the real ones.
 */
import { describe, expect, it } from "vitest";

import type { FunJudge, FunJudgeVerdict } from "@/application/planner/fun-judge";
import type { FunJudgeRequest } from "@/application/planner/ports/fun-judge";
import { parseFunJudgeMode } from "@/application/planner/fun-judge-selection";
import type {
  ProviderCandidate,
  ProviderCandidateSet,
  ProviderCapabilities,
  ProviderRouteRequest,
  RouteCandidateProvider,
} from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";
import { planRide, type PlanRideInput } from "@/server/planning/plan-service";

const ORIGIN: Coordinate = { lon: -75.16, lat: 39.95 };
const DESTINATION: Coordinate = { lon: -74.8, lat: 40.2 };

const REQUEST: ProviderRouteRequest = {
  requestId: "req_fun_judge",
  origin: ORIGIN,
  destination: DESTINATION,
  stops: [],
  shaping: [],
  profile: "motorcycle_fastest",
  avoidPolygons: [],
  options: { includeAlternatives: true, avoidHighways: false, tollPolicy: "avoid", vehicle: "motorcycle" },
};
const INPUT: PlanRideInput = {
  identity: { rideId: "ride_fun", rideRevision: 1, planningGeneration: 1 },
  request: REQUEST,
};

function summary(curvature: string, roadClass: string) {
  return {
    totalMeters: 120_000,
    surfaceByRoadClassMeters: { [`asphalt|${roadClass}`]: 120_000 },
    curvatureMeters: { [curvature]: 120_000 },
    tollMeters: 0,
  };
}

function candidate(
  fingerprint: string,
  via: Coordinate,
  durationSeconds: number,
  roadSummary: ReturnType<typeof summary>,
): ProviderCandidate {
  return {
    providerId: "stub-router",
    profile: "motorcycle_fastest",
    geometry: [ORIGIN, via, DESTINATION],
    distanceMeters: 120_000,
    durationSeconds,
    providerMetadata: { fingerprint },
    roadSummary,
  };
}

// Fast and plain; mildly curvy and +12%; very curvy but +60% (outside Best Ride's 35% envelope).
const FAST = candidate("fp_fast", { lon: -75.0, lat: 40.05 }, 6_000, summary("0.95", "primary"));
const MILD = candidate("fp_mild", { lon: -75.3, lat: 40.3 }, 6_720, summary("0.8", "tertiary"));
const FAR = candidate("fp_far", { lon: -74.6, lat: 39.7 }, 9_600, summary("0.6", "unclassified"));

function provider(candidates: readonly ProviderCandidate[]): RouteCandidateProvider {
  const capabilities: ProviderCapabilities = {
    profiles: ["motorcycle_fastest"],
    supportsAlternatives: true,
    supportsAvoidPolygons: false,
  };
  return {
    id: "stub-router",
    capabilities: () => capabilities,
    async candidates(): Promise<ProviderCandidateSet> {
      return { candidates };
    },
  };
}

/** Prefers whichever presented candidate is NOT the deterministic winner. */
function contrarianJudge(): FunJudge & { requests: FunJudgeRequest[] } {
  const requests: FunJudgeRequest[] = [];
  return {
    requests,
    async judge(request, fallbackRanking): Promise<FunJudgeVerdict> {
      requests.push(request);
      const pick = fallbackRanking.find((key) => key !== fallbackRanking[0]) ?? null;
      return {
        source: "jev",
        outcome: "preferred",
        preferredKey: pick,
        ranking: pick === null ? [...fallbackRanking] : [pick, ...fallbackRanking.filter((k) => k !== pick)],
        confidence: 0.82,
        margin: 0.66,
        noneProbability: 0.02,
        orderAgreement: true,
        model: "jev-1.13.0",
        calls: 2,
        cached: false,
        latencyMs: 420,
      };
    },
  };
}

function fallbackJudge(): FunJudge {
  return {
    async judge(_request, fallbackRanking) {
      return {
        source: "fallback",
        outcome: "low-confidence",
        preferredKey: null,
        ranking: [...fallbackRanking],
        confidence: 0.4,
        margin: 0.05,
        noneProbability: 0.3,
        orderAgreement: true,
        model: "jev-1.13.0",
        calls: 2,
        cached: false,
        latencyMs: 300,
      };
    },
  };
}

async function plan(env: Record<string, string>, funJudge: FunJudge | null) {
  const result = await planRide(INPUT, {
    provider: provider([FAST, MILD, FAR]),
    env,
    funCharacterClassifier: null,
    funJudge,
  });
  if (!result.ok) throw new Error(`plan failed: ${result.error.code}`);
  return result;
}

type Planned = Awaited<ReturnType<typeof plan>>;
/** Route ids are minted per plan; compare routes by provider fingerprint. */
function fp(result: Planned, id: string | null | undefined): string | null {
  return result.bundle.candidates.find((c) => c.id === id)?.fingerprint ?? null;
}
function roleFingerprints(result: Planned) {
  return Object.fromEntries(Object.entries(result.bundle.roles).map(([role, id]) => [role, fp(result, id)]));
}

describe("FUN JUDGE Best Ride promotion", () => {
  it("parses the flag conservatively: anything but shadow/on is off", () => {
    expect(parseFunJudgeMode(undefined)).toBe("off");
    expect(parseFunJudgeMode("")).toBe("off");
    expect(parseFunJudgeMode("true")).toBe("off");
    expect(parseFunJudgeMode(" Shadow ")).toBe("shadow");
    expect(parseFunJudgeMode("on")).toBe("on");
  });

  it("is off by default: no judge call, no diagnostic, deterministic answer", async () => {
    const judge = contrarianJudge();
    const result = await plan({}, judge);
    expect(judge.requests).toHaveLength(0);
    expect(result.diagnostics.funJudge).toBeUndefined();
  });

  it("shadow reports Jev's pick but never changes roles or selection", async () => {
    const baseline = await plan({}, null);
    const judge = contrarianJudge();
    const result = await plan({ OGV_JEV_FUN_JUDGE: "shadow" }, judge);
    expect(result.bundle.candidates.length).toBe(3);
    expect(roleFingerprints(result)).toEqual(roleFingerprints(baseline));
    expect(fp(result, result.bundle.selectedRouteId)).toBe(fp(baseline, baseline.bundle.selectedRouteId));
    const diagnostic = result.diagnostics.funJudge!;
    expect(diagnostic).toMatchObject({ mode: "shadow", outcome: "preferred", applied: false });
    expect(diagnostic.selectedRouteId).toBe(result.bundle.selectedRouteId);
    expect(diagnostic.jevRouteId).not.toBeNull();
    expect(diagnostic.jevRouteId).not.toBe(diagnostic.deterministicRouteId);
  });

  it("on: a confident Jev pick inside the budget becomes Best Ride and says why", async () => {
    const baseline = await plan({}, null);
    const judge = contrarianJudge();
    const result = await plan({ OGV_JEV_FUN_JUDGE: "on" }, judge);
    const diagnostic = result.diagnostics.funJudge!;
    expect(diagnostic.applied).toBe(true);
    expect(fp(result, diagnostic.deterministicRouteId)).toBe(fp(baseline, baseline.bundle.selectedRouteId));
    expect(fp(result, diagnostic.jevRouteId)).not.toBe(fp(baseline, baseline.bundle.selectedRouteId));
    expect(result.bundle.selectedRouteId).toBe(diagnostic.jevRouteId);
    expect(result.bundle.roles["best-ride"]).toBe(diagnostic.jevRouteId);
    expect(diagnostic.selectedRouteId).toBe(diagnostic.jevRouteId);
    expect(diagnostic.why.length).toBeGreaterThan(0);
    expect(diagnostic.addedTimePct).not.toBeNull();
    expect(diagnostic.addedTimePct!).toBeLessThanOrEqual(0.35);
    // The candidates themselves (eligibility, score, geometry, warnings) are untouched.
    const strip = (r: Planned) => r.bundle.candidates.map((c) => ({ ...c, id: null }));
    expect(strip(result)).toEqual(strip(baseline));
  });

  it("never offers a route outside the Best Ride detour envelope to the judge", async () => {
    const judge = contrarianJudge();
    const result = await plan({ OGV_JEV_FUN_JUDGE: "on" }, judge);
    const far = result.bundle.candidates.find((c) => c.durationSeconds === 9_600)!;
    expect(far).toBeDefined();
    expect(result.diagnostics.funJudge!.excluded).toContainEqual({ routeId: far.id, reason: "outside-detour-budget" });
    expect(judge.requests[0]!.candidates.every((c) => c.addedTimePct <= 0.35)).toBe(true);
    expect(result.bundle.selectedRouteId).not.toBe(far.id);
  });

  it("on: any non-preferred outcome keeps the deterministic winner", async () => {
    const baseline = await plan({}, null);
    const result = await plan({ OGV_JEV_FUN_JUDGE: "on" }, fallbackJudge());
    expect(fp(result, result.bundle.selectedRouteId)).toBe(fp(baseline, baseline.bundle.selectedRouteId));
    expect(roleFingerprints(result)).toEqual(roleFingerprints(baseline));
    expect(result.diagnostics.funJudge).toMatchObject({ outcome: "low-confidence", applied: false });
  });

  it("on: a throwing judge or a missing key keeps the plan deterministic", async () => {
    const baseline = await plan({}, null);
    const throwing = await plan({ OGV_JEV_FUN_JUDGE: "on" }, {
      judge: async () => {
        throw new Error("boom");
      },
    });
    expect(fp(throwing, throwing.bundle.selectedRouteId)).toBe(fp(baseline, baseline.bundle.selectedRouteId));
    expect(throwing.diagnostics.funJudge).toBeUndefined();
    const keyless = await plan({ OGV_JEV_FUN_JUDGE: "on" }, null);
    expect(fp(keyless, keyless.bundle.selectedRouteId)).toBe(fp(baseline, baseline.bundle.selectedRouteId));
    expect(keyless.diagnostics.funJudge).toMatchObject({ outcome: "unavailable", applied: false, calls: 0 });
  });
});
