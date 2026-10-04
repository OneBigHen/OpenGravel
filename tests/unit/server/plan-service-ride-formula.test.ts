/**
 * OGV_RIDE_FORMULA: off never scores, shadow reports without changing the
 * answer, on lets ride-formula-v1 choose Best Ride among eligible, in-budget
 * candidates. The router is a stub; pipeline, eligibility and roles are real.
 */
import { describe, expect, it } from "vitest";

import { parseRideFormulaMode } from "@/application/planner/ride-formula";
import type {
  ProviderCandidate,
  ProviderCandidateSet,
  ProviderRouteRequest,
  RouteCandidateProvider,
} from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";
import { planRide, type PlanRideInput } from "@/server/planning/plan-service";

const ORIGIN: Coordinate = { lon: -77.4, lat: 41.1 };
const DESTINATION: Coordinate = { lon: -77.0, lat: 41.3 };

const REQUEST: ProviderRouteRequest = {
  requestId: "req_formula",
  origin: ORIGIN,
  destination: DESTINATION,
  stops: [],
  shaping: [],
  profile: "motorcycle_adventure",
  avoidPolygons: [],
  options: {
    includeAlternatives: true,
    avoidHighways: false,
    tollPolicy: "avoid",
    vehicle: "motorcycle",
    surfacePreference: "dirt-preferred",
    roadCharacter: "balanced",
    targetUnpavedShare: 0.4,
  },
};
const INPUT: PlanRideInput = { identity: { rideId: "ride_formula", rideRevision: 1, planningGeneration: 1 }, request: REQUEST };

function candidate(fingerprint: string, via: Coordinate, durationSeconds: number, surface: string, roadClass: string): ProviderCandidate {
  return {
    providerId: "stub-router",
    profile: "motorcycle_adventure",
    geometry: [ORIGIN, via, DESTINATION],
    distanceMeters: 60_000,
    durationSeconds,
    providerMetadata: { fingerprint },
    roadSummary: {
      totalMeters: 60_000,
      surfaceByRoadClassMeters: { [`${surface}|${roadClass}`]: 60_000 },
      curvatureMeters: { "0.8": 60_000 },
      tollMeters: 0,
    },
  };
}

// Plain pavement on a busy road; the same trip mostly on gravel for +20% time.
const PAVED = candidate("fp_paved", { lon: -77.2, lat: 41.15 }, 3_600, "asphalt", "primary");
const GRAVEL = candidate("fp_gravel", { lon: -77.3, lat: 41.3 }, 4_320, "gravel", "unclassified");

function provider(candidates: readonly ProviderCandidate[]): RouteCandidateProvider {
  return {
    id: "stub-router",
    capabilities: () => ({ profiles: ["motorcycle_adventure"], supportsAlternatives: true, supportsAvoidPolygons: false }),
    async candidates(): Promise<ProviderCandidateSet> {
      return { candidates };
    },
  };
}

async function plan(env: Record<string, string>) {
  const result = await planRide(INPUT, {
    provider: provider([PAVED, GRAVEL]),
    env: { OGV_TRAFFIC_LIVE_AVOID: "off", OGV_ATLAS_GENERATORS: "off", ...env },
    funCharacterClassifier: null,
    funJudge: null,
    roadAuthority: null,
  });
  if (!result.ok) throw new Error(`plan failed: ${result.error.code}`);
  return result;
}

describe("OGV_RIDE_FORMULA", () => {
  it("parses conservatively: anything but shadow/on is off", () => {
    expect(parseRideFormulaMode(undefined)).toBe("off");
    expect(parseRideFormulaMode("true")).toBe("off");
    expect(parseRideFormulaMode(" Shadow ")).toBe("shadow");
    expect(parseRideFormulaMode("on")).toBe("on");
  });

  it("is off by default: no formula diagnostics", async () => {
    const result = await plan({});
    expect(result.diagnostics.rideFormula).toBeUndefined();
  });

  it("shadow reports every kept candidate and never changes roles or selection", async () => {
    const off = await plan({});
    const shadow = await plan({ OGV_RIDE_FORMULA: "shadow" });
    const fingerprintOf = (result: typeof off, id: string | null | undefined) => result.bundle.candidates.find((c) => c.id === id)?.fingerprint ?? null;
    expect(fingerprintOf(shadow, shadow.bundle.selectedRouteId)).toBe(fingerprintOf(off, off.bundle.selectedRouteId));
    const diagnostic = shadow.diagnostics.rideFormula!;
    expect(diagnostic.mode).toBe("shadow");
    expect(diagnostic.version).toBe("ride-formula-v1");
    expect(diagnostic.rows.length).toBe(shadow.bundle.candidates.length);
    expect(diagnostic.rows.every((row) => row.value >= 0 && row.value <= 100)).toBe(true);
  });

  it("on: the formula's own pick is Best Ride, and dirt scores higher for a dirt-preferred rider", async () => {
    const result = await plan({ OGV_RIDE_FORMULA: "on" });
    const diagnostic = result.diagnostics.rideFormula!;
    expect(diagnostic.mode).toBe("on");
    expect(diagnostic.pickIndex).not.toBeNull();
    const bestId = result.bundle.roles["best-ride"];
    const bestIndex = result.bundle.candidates.findIndex((c) => c.id === bestId);
    expect(bestIndex).toBe(diagnostic.pickIndex);
    const gravelRow = diagnostic.rows.find((row) => result.bundle.candidates[row.index]?.fingerprint === result.bundle.candidates.find((c) => c.geometry[1]?.lat === 41.3)?.fingerprint)!;
    const pavedRow = diagnostic.rows.find((row) => row.index !== gravelRow.index)!;
    expect(gravelRow.value).toBeGreaterThan(pavedRow.value);
    expect(gravelRow.variables["unpavedShare"]).toBeGreaterThan(pavedRow.variables["unpavedShare"] ?? 0);
  });
});
