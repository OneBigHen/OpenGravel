import { describe, expect, it } from "vitest";

import {
  measureExperimentCandidate,
  scoreExperimentCase,
  type ExperimentCandidateInput,
} from "@/application/planner/routing-experiment-measure";
import type { Coordinate } from "@/domain/ride/types";

function wiggle(points: number): readonly Coordinate[] {
  return Array.from({ length: points }, (_, index) => ({
    lon: -75.5 + index * 0.002,
    lat: 40 + (index % 2 === 0 ? 0 : 0.0006),
  }));
}

function candidate(
  id: string,
  overrides: Partial<ExperimentCandidateInput> = {},
): ExperimentCandidateInput {
  return {
    id,
    eligible: true,
    canonicalScore: 0.6,
    distanceMeters: 10_000,
    durationSeconds: 900,
    geometry: wiggle(40),
    instructions: [
      { text: "Depart", distanceMeters: 5_000, durationSeconds: 450, type: "depart" },
      { text: "Turn left", distanceMeters: 5_000, durationSeconds: 450, type: "turn", maneuver: "left" },
    ],
    ...overrides,
  };
}

describe("routing experiment measurement", () => {
  it("measures a candidate with unknowns left null", () => {
    const measured = measureExperimentCandidate(candidate("a"));
    expect(measured.metrics.maneuversPer10Miles).toBeGreaterThan(0);
    expect(measured.metrics.backtrackingShare).toBeTypeOf("number");
    expect(measured.metrics.sustainedBendShare).toBeTypeOf("number");
    // No ordered evidence / worthwhile policy: no invented worthwhile minutes.
    expect(measured.metrics.worthwhileMinuteRatio).toBeNull();
    expect(measured.diagnostics.arcUnavailable).toBe("no-ordered-evidence");
    // Destination ride: no timebox to miss.
    expect(measured.metrics.timeboxErrorSeconds).toBeNull();
  });

  it("treats missing instructions as unknown workload", () => {
    const { instructions: _unused, ...rest } = candidate("a");
    const measured = measureExperimentCandidate(rest);
    expect(measured.metrics.maneuversPer10Miles).toBeNull();
    expect(measured.metrics.alternatingShortTurnPairs).toBeNull();
  });

  it("measures loop timebox error when a timebox exists", () => {
    const measured = measureExperimentCandidate(candidate("a", { timeboxSeconds: 1_200 }));
    expect(measured.metrics.timeboxErrorSeconds).toBe(300);
  });

  it("scores a fair case and rejects an unequal provider budget", () => {
    const fair = scoreExperimentCase({
      caseId: "case",
      generator: "test",
      control: { providerCalls: 3, candidates: [candidate("c")], selectedCandidateId: "c" },
      treatment: {
        providerCalls: 3,
        candidates: [candidate("t", { durationSeconds: 1_000, canonicalScore: 0.7 })],
        selectedCandidateId: "t",
      },
    });
    expect(fair.scorecard.validity).toBe("valid");
    expect(fair.scorecard.delta?.durationSeconds).toBe(100);
    expect(fair.scorecard.delta?.canonicalScore).toBeCloseTo(0.1);
    expect(fair.scorecard.delta?.worthwhileMinuteRatio).toBeNull();

    const bought = scoreExperimentCase({
      caseId: "case",
      generator: "test",
      control: { providerCalls: 3, candidates: [candidate("c")], selectedCandidateId: "c" },
      treatment: { providerCalls: 4, candidates: [candidate("t")], selectedCandidateId: "t" },
    });
    expect(bought.scorecard.validity).toBe("call-budget-mismatch");
    expect(bought.scorecard.delta).toBeNull();
  });
});
