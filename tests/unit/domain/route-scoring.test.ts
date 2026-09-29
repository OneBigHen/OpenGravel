/**
 * Deterministic candidate scoring.
 *
 * Two contracts are pinned here: the score is a pure function of
 * (candidate, intent, policy, evidence) — same input, identical output — and a
 * component whose evidence is absent is `input: null` / `unknown` / `0`, never a
 * fabricated positive or negative (03-DOMAIN-MODEL §19, integrity rule 2).
 */

import { describe, expect, it } from "vitest";

import { knownEvidence } from "@/domain/evidence/types";
import type { Coordinate } from "@/domain/ride/types";
import { PA_NJ_ROUTE_POLICY_VNEXT_1 } from "@/domain/route/policy";
import {
  piecewiseDetourPenalty,
  scoreCandidate,
  uncertaintyPenalty,
} from "@/domain/route/scoring";
import { ROUTE_EVIDENCE_KEYS, type RouteEvidence } from "@/domain/route/types";

const POLICY = PA_NJ_ROUTE_POLICY_VNEXT_1;

const CURVY: readonly Coordinate[] = [
  { lon: -77.1, lat: 40.1 },
  { lon: -77.09, lat: 40.11 },
  { lon: -77.1, lat: 40.12 },
  { lon: -77.09, lat: 40.13 },
];

const STRAIGHT: readonly Coordinate[] = [
  { lon: -77.1, lat: 40.1 },
  { lon: -77.1, lat: 40.11 },
  { lon: -77.1, lat: 40.12 },
];

function candidate(overrides: Partial<{
  geometry: readonly Coordinate[];
  distanceMeters: number;
  durationSeconds: number;
}> = {}) {
  return {
    geometry: CURVY,
    distanceMeters: 5_000,
    durationSeconds: 900,
    ...overrides,
  };
}

function score(overrides: {
  readonly evidence?: RouteEvidence;
  readonly baselineDurationSeconds?: number;
  readonly durationSeconds?: number;
  readonly geometry?: readonly Coordinate[];
} = {}) {
  return scoreCandidate({
    candidate: candidate({
      durationSeconds: overrides.durationSeconds ?? 900,
      ...(overrides.geometry === undefined ? {} : { geometry: overrides.geometry }),
    }),
    intent: {},
    policy: POLICY,
    ...(overrides.evidence === undefined ? {} : { evidence: overrides.evidence }),
    ...(overrides.baselineDurationSeconds === undefined
      ? {}
      : { baselineDurationSeconds: overrides.baselineDurationSeconds }),
  });
}

describe("piecewiseDetourPenalty", () => {
  it("is free inside the preferred band and ramps quadratically after it", () => {
    expect(piecewiseDetourPenalty(0, 0.25, 0.08)).toBe(0);
    expect(piecewiseDetourPenalty(0.04, 0.25, 0.08)).toBeCloseTo(0.8, 6);
    expect(piecewiseDetourPenalty(0.08, 0.25, 0.08)).toBeCloseTo(1.6, 6);
    // Past the band the ramp is quadratic, so the penalty accelerates.
    const mid = piecewiseDetourPenalty(0.15, 0.25, 0.08);
    const far = piecewiseDetourPenalty(0.25, 0.25, 0.08);
    expect(mid).toBeGreaterThan(1.6);
    expect(far).toBeGreaterThan(mid);
    expect(far).toBeCloseTo(49.6, 6);
  });

  it("never decreases as the detour grows", () => {
    const samples = [0, 0.05, 0.08, 0.1, 0.15, 0.2, 0.25, 0.4];
    for (let index = 1; index < samples.length; index += 1) {
      expect(piecewiseDetourPenalty(samples[index] ?? 0, 0.25, 0.08)).toBeGreaterThanOrEqual(
        piecewiseDetourPenalty(samples[index - 1] ?? 0, 0.25, 0.08),
      );
    }
  });
});

describe("uncertaintyPenalty", () => {
  it("charges the maximum when nothing is known", () => {
    expect(uncertaintyPenalty({})).toBe(15);
    expect(ROUTE_EVIDENCE_KEYS).toHaveLength(15);
  });

  it("decreases monotonically as evidence becomes usable", () => {
    const source = { id: "test", label: "test", category: "derived" } as const;
    const oneKnown: RouteEvidence = {
      curvature: knownEvidence(0.5, source),
    };
    const twoKnown: RouteEvidence = {
      ...oneKnown,
      elevation: knownEvidence(0.5, source),
    };
    const nothingKnown = uncertaintyPenalty({});
    const one = uncertaintyPenalty(oneKnown);
    const two = uncertaintyPenalty(twoKnown);
    expect(one).toBeLessThan(nothingKnown);
    expect(two).toBeLessThan(one);
    expect(two).toBeGreaterThanOrEqual(0);
  });
});

describe("scoreCandidate", () => {
  it("names the policy that produced the score", () => {
    expect(score().policyVersion).toBe(POLICY.version);
  });

  it("is deterministic: the same input produces an identical score", () => {
    expect(score()).toEqual(score());
  });

  it("marks every component with no evidence as unknown with zero contribution", () => {
    const components = score().components;
    const unknownKeys = [
      "backroad",
      "surfaceFit",
      "elevation",
      "traffic",
      "junctionFriction",
      "novelty",
      "closureRisk",
      "confidence",
    ] as const;
    for (const key of unknownKeys) {
      const component = components[key];
      expect(component.input).toBeNull();
      expect(component.evidenceStatus).toBe("unknown");
      expect(component.contribution).toBe(0);
      expect(component.weight).toBe(POLICY.characterWeights.balanced[key]);
    }
  });

  it("derives curvature from smoothed geometry as an explicit estimate", () => {
    const curvy = score().components.curvature;
    expect(curvy.evidenceStatus).toBe("estimated");
    expect(curvy.input).toBeGreaterThan(0);
    expect(curvy.contribution).toBeGreaterThan(0);
    expect(curvy.explanationKey).toContain("proxy");

    const straight = score({ geometry: STRAIGHT }).components.curvature;
    expect(straight.input).toBe(0);
    expect(straight.contribution).toBe(0);
  });

  it("charges the time cost from the detour against the baseline", () => {
    const direct = score({
      durationSeconds: 600,
      baselineDurationSeconds: 600,
    }).components.timeCost;
    expect(direct.input).toBe(0);
    expect(direct.contribution).toBeCloseTo(direct.weight * 100, 6);

    const detour = score({
      durationSeconds: 900,
      baselineDurationSeconds: 600,
    }).components.timeCost;
    expect(detour.input).toBeGreaterThan(0);
    expect(detour.contribution).toBeLessThan(direct.contribution);
    expect(detour.evidenceStatus).toBe("estimated");
  });

  it("uses usable evidence instead of the unknown placeholder", () => {
    const source = { id: "test", label: "test", category: "traffic" } as const;
    const scored = score({
      evidence: { traffic: knownEvidence(0.25, source, 0.9) },
    });
    const traffic = scored.components.traffic;
    expect(traffic.input).toBe(0.25);
    expect(traffic.evidenceStatus).toBe("known");
    expect(traffic.contribution).toBeCloseTo(traffic.weight * (1 - 0.25) * 100, 6);
  });

  it("uses the Protect the Ride traffic term only when traffic data is available", () => {
    const withTraffic = scoreCandidate({
      candidate: candidate(),
      intent: {},
      policy: POLICY,
      trafficCost: {
        normalizedCost: 0.75,
        status: "known",
        explanationKey: "score.traffic.protect-the-ride-band",
      },
    });

    expect(withTraffic.components.traffic).toMatchObject({
      input: 0.75,
      evidenceStatus: "known",
      explanationKey: "score.traffic.protect-the-ride-band",
    });

    const withoutTraffic = score();
    expect(withoutTraffic.components.traffic).toMatchObject({
      input: null,
      evidenceStatus: "unknown",
      contribution: 0,
    });
  });

  it("ignores a malformed evidence scalar rather than trusting it", () => {
    const source = { id: "test", label: "test", category: "traffic" } as const;
    const scored = score({
      evidence: { traffic: knownEvidence(42, source) },
    });
    expect(scored.components.traffic.input).toBeNull();
    expect(scored.components.traffic.evidenceStatus).toBe("unknown");
  });
});
