import { describe, expect, it } from "vitest";

import {
  RIDE_FORMULA_VERSION,
  scoreRideFormula,
  type RideFormulaInput,
} from "@/domain/route/ride-formula";

function measurement(value: number | null, unit = "share") {
  return {
    value,
    unit,
    confidence: value === null ? null : 1,
    source: "test",
  } as const;
}

function input(overrides: Partial<RideFormulaInput> = {}): RideFormulaInput {
  return {
    preference: "gravel",
    canonicalEligible: true,
    hardFailureCodes: [],
    variables: {
      surfaceTargetFit: measurement(1),
      continuousDirtMeters: measurement(4_000, "m"),
      dirtCorridorQuality: measurement(1),
      francoTotalCurvature: measurement(1_000, "curvature-m"),
      curvatureContinuity: measurement(0.8),
      sustainedRunMeters: measurement(2_000, "m"),
      routeCoherence: measurement(0.9),
      coreQualityShare: measurement(0.8),
      busyRoadShare: measurement(0.1),
      timeCost: measurement(1, "ratio"),
      trust: measurement(1),
    },
    ...overrides,
  };
}

describe("ride formula v1", () => {
  it("is deterministic, versioned, and exposes normalized variables and weights", () => {
    const result = scoreRideFormula(input());

    expect(result.version).toBe(RIDE_FORMULA_VERSION);
    expect(result.value).toBeGreaterThan(0);
    expect(result.value).toBeLessThanOrEqual(100);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.variables.continuousDirtMeters?.normalized).toBeGreaterThan(0);
    expect(result.weights.continuousDirtMeters).toBeGreaterThan(0);
    expect(scoreRideFormula(input())).toEqual(result);
  });

  it("gives continuous legal dirt more weight for gravel than missing dirt evidence", () => {
    const dirt = scoreRideFormula(input());
    const unknown = scoreRideFormula(input({
      variables: { ...input().variables, continuousDirtMeters: measurement(null, "m") },
    }));

    expect(dirt.value).toBeGreaterThan(unknown.value);
    expect(dirt.confidence).toBeGreaterThan(unknown.confidence);
    expect(dirt.weights.continuousDirtMeters).toBeGreaterThanOrEqual(dirt.weights.francoTotalCurvature);
  });

  it("keeps canonical hard failures ineligible regardless of the numeric score", () => {
    const result = scoreRideFormula(input({
      canonicalEligible: false,
      hardFailureCodes: ["private-road"],
    }));

    expect(result.eligible).toBe(false);
    expect(result.value).toBeGreaterThan(0);
  });

  it("does not manufacture confidence from absent measurements", () => {
    const result = scoreRideFormula({
      preference: "dual-sport",
      canonicalEligible: true,
      hardFailureCodes: [],
      variables: {
        continuousDirtMeters: measurement(null, "m"),
        trust: measurement(null),
      },
    });

    expect(result.value).toBe(0);
    expect(result.confidence).toBe(0);
    expect(result.variables.continuousDirtMeters?.value).toBeNull();
  });

  it("bounds signed personalization and preserves explicit dirt intent", () => {
    const base = scoreRideFormula(input());
    const adjusted = scoreRideFormula(input({
      personalization: {
        weightAdjustments: { continuousDirtMeters: -100, busyRoadShare: 100 },
        confidence: 1,
      },
    }));

    expect(adjusted.weights.continuousDirtMeters).toBeGreaterThan(0);
    expect(adjusted.weights.busyRoadShare).toBeGreaterThan(0);
    expect(adjusted.weights.continuousDirtMeters).toBeGreaterThan(adjusted.weights.busyRoadShare);
    expect(adjusted.value).not.toBe(base.value);
  });

  it("rewards unpaved road for a dirt rider and pavement for everyone else", () => {
    const unpaved = (value: number) => ({ unpavedShare: measurement(value) });
    const dirtLow = scoreRideFormula(input({ variables: unpaved(0.05) }));
    const dirtHigh = scoreRideFormula(input({ variables: unpaved(0.6) }));
    expect(dirtHigh.value).toBeGreaterThan(dirtLow.value);
    const roadLow = scoreRideFormula(input({ preference: "curvy", variables: unpaved(0.05) }));
    const roadHigh = scoreRideFormula(input({ preference: "curvy", variables: unpaved(0.6) }));
    expect(roadLow.value).toBeGreaterThan(roadHigh.value);
  });

  it("treats dirt continuity as not applicable to a rider who did not ask for dirt", () => {
    const result = scoreRideFormula(input({ preference: "curvy" }));
    expect(result.variables.continuousDirtMeters.normalized).toBeNull();
    expect(result.variables.dirtCorridorQuality.normalized).toBeNull();
    expect(scoreRideFormula(input()).variables.continuousDirtMeters.normalized).toBe(1);
  });
});
