import { describe, expect, it } from "vitest";

import {
  aggregateRoutingExperimentScorecards,
  routingExperimentScorecard,
  type RoutingExperimentArm,
  type RoutingExperimentCandidateMetrics,
} from "@/application/planner/routing-experiment-scorecard";

function candidate(
  id: string,
  overrides: Partial<RoutingExperimentCandidateMetrics> = {},
): RoutingExperimentCandidateMetrics {
  return {
    id,
    eligible: true,
    canonicalScore: 70,
    distanceMeters: 40_000,
    durationSeconds: 3_600,
    worthwhileMinuteRatio: 0.55,
    sustainedBendShare: 0.35,
    maneuversPer10Miles: 8,
    backtrackingShare: 0.03,
    selfOverlapShare: 0.05,
    timeboxErrorSeconds: 180,
    ...overrides,
  };
}

function arm(
  id: "control" | "treatment",
  selected: RoutingExperimentCandidateMetrics,
  overrides: Partial<RoutingExperimentArm> = {},
): RoutingExperimentArm {
  return {
    id,
    providerCalls: 3,
    planningLatencyMs: 1_500,
    candidates: [selected],
    selectedCandidateId: selected.id,
    ...overrides,
  };
}

describe("routing experiment scorecard", () => {
  it("compares an equal-budget eligible treatment without collapsing metrics into one score", () => {
    const control = candidate("control", {
      canonicalScore: 70,
      durationSeconds: 3_600,
      worthwhileMinuteRatio: 0.55,
      sustainedBendShare: 0.35,
      maneuversPer10Miles: 9,
      backtrackingShare: 0.06,
      selfOverlapShare: 0.08,
      timeboxErrorSeconds: 240,
    });
    const treatment = candidate("treatment", {
      canonicalScore: 74,
      durationSeconds: 3_900,
      worthwhileMinuteRatio: 0.72,
      sustainedBendShare: 0.54,
      maneuversPer10Miles: 7,
      backtrackingShare: 0.03,
      selfOverlapShare: 0.04,
      timeboxErrorSeconds: 120,
      corridorAdherenceShare: 0.88,
      preservedBaselineShare: 0.93,
    });

    const scorecard = routingExperimentScorecard({
      caseId: "case-1",
      generator: "departure-rejoin",
      control: arm("control", control, { planningLatencyMs: 1_400 }),
      treatment: arm("treatment", treatment, { planningLatencyMs: 1_700 }),
      riderPreference: "treatment",
    });

    expect(scorecard.validity).toBe("valid");
    expect(scorecard.equalProviderCallBudget).toBe(true);
    expect(scorecard.delta).not.toBeNull();
    expect(scorecard.delta!.durationSeconds).toBe(300);
    expect(scorecard.delta!.canonicalScore).toBe(4);
    expect(scorecard.delta!.worthwhileMinuteRatio).toBeCloseTo(0.17);
    expect(scorecard.delta!.sustainedBendShare).toBeCloseTo(0.19);
    expect(scorecard.delta!.maneuversPer10Miles).toBe(-2);
    expect(scorecard.delta!.backtrackingShare).toBeCloseTo(-0.03);
    expect(scorecard.delta!.selfOverlapShare).toBeCloseTo(-0.04);
    expect(scorecard.delta!.timeboxErrorSeconds).toBe(-120);
    expect(scorecard.delta!.planningLatencyMs).toBe(300);
    expect(scorecard.treatmentCorridorAdherenceShare).toBe(0.88);
    expect(scorecard.treatmentPreservedBaselineShare).toBe(0.93);
    expect(scorecard.riderPreference).toBe("treatment");
  });

  it("refuses to compare a treatment that bought an extra provider call", () => {
    const scorecard = routingExperimentScorecard({
      caseId: "case-2",
      generator: "library-corridor",
      control: arm("control", candidate("c"), { providerCalls: 3 }),
      treatment: arm("treatment", candidate("t"), { providerCalls: 4 }),
    });

    expect(scorecard.equalProviderCallBudget).toBe(false);
    expect(scorecard.validity).toBe("call-budget-mismatch");
    expect(scorecard.delta).toBeNull();
  });

  it("requires each arm to have a real selected candidate", () => {
    const controlCandidate = candidate("c");
    const treatmentCandidate = candidate("t");

    const missingControl = routingExperimentScorecard({
      caseId: "case-3",
      generator: "x",
      control: arm("control", controlCandidate, {
        selectedCandidateId: null,
      }),
      treatment: arm("treatment", treatmentCandidate),
    });
    expect(missingControl.validity).toBe("control-selection-missing");

    const missingTreatment = routingExperimentScorecard({
      caseId: "case-4",
      generator: "x",
      control: arm("control", controlCandidate),
      treatment: arm("treatment", treatmentCandidate, {
        selectedCandidateId: "not-there",
      }),
    });
    expect(missingTreatment.validity).toBe("treatment-selection-missing");
  });

  it("keeps hard eligibility outside any numeric tradeoff", () => {
    const scorecard = routingExperimentScorecard({
      caseId: "case-5",
      generator: "missing-link",
      control: arm("control", candidate("c")),
      treatment: arm(
        "treatment",
        candidate("t", {
          eligible: false,
          canonicalScore: 99,
          worthwhileMinuteRatio: 0.95,
        }),
      ),
    });

    expect(scorecard.validity).toBe("treatment-ineligible");
    expect(scorecard.delta).toBeNull();
  });

  it("keeps unknown optional metrics unknown instead of treating them as zero", () => {
    const scorecard = routingExperimentScorecard({
      caseId: "case-6",
      generator: "library-corridor",
      control: arm(
        "control",
        candidate("c", {
          worthwhileMinuteRatio: null,
          sustainedBendShare: null,
          canonicalScore: null,
        }),
      ),
      treatment: arm(
        "treatment",
        candidate("t", {
          worthwhileMinuteRatio: 0.7,
          sustainedBendShare: 0.5,
          canonicalScore: null,
        }),
      ),
    });

    expect(scorecard.validity).toBe("valid");
    expect(scorecard.delta!.worthwhileMinuteRatio).toBeNull();
    expect(scorecard.delta!.sustainedBendShare).toBeNull();
    expect(scorecard.delta!.canonicalScore).toBeNull();
  });

  it("aggregates valid trials while keeping rider choice and system metrics separate", () => {
    const scorecards = [
      routingExperimentScorecard({
        caseId: "a",
        generator: "library-corridor",
        control: arm("control", candidate("ca", { canonicalScore: 70 })),
        treatment: arm(
          "treatment",
          candidate("ta", {
            canonicalScore: 74,
            corridorAdherenceShare: 0.9,
          }),
        ),
        riderPreference: "treatment",
      }),
      routingExperimentScorecard({
        caseId: "b",
        generator: "library-corridor",
        control: arm("control", candidate("cb", { canonicalScore: 72 })),
        treatment: arm(
          "treatment",
          candidate("tb", {
            canonicalScore: 71,
            corridorAdherenceShare: 0.8,
          }),
        ),
        riderPreference: "control",
      }),
      routingExperimentScorecard({
        caseId: "invalid",
        generator: "library-corridor",
        control: arm("control", candidate("cc"), { providerCalls: 3 }),
        treatment: arm("treatment", candidate("tc"), { providerCalls: 4 }),
        riderPreference: "tie",
      }),
      routingExperimentScorecard({
        caseId: "other",
        generator: "other-generator",
        control: arm("control", candidate("co")),
        treatment: arm("treatment", candidate("to")),
        riderPreference: "treatment",
      }),
    ];

    const aggregate = aggregateRoutingExperimentScorecards(
      "library-corridor",
      scorecards,
    );

    expect(aggregate.trials).toBe(3);
    expect(aggregate.validTrials).toBe(2);
    expect(aggregate.equalBudgetTrials).toBe(2);
    expect(aggregate.riderRatedTrials).toBe(3);
    expect(aggregate.riderPreference).toEqual({
      treatment: 1,
      control: 1,
      tie: 1,
    });
    expect(aggregate.meanDelta.canonicalScore).toBeCloseTo(1.5);
    expect(aggregate.meanTreatmentCorridorAdherenceShare).toBeCloseTo(0.85);
  });

  it("ignores malformed optional numbers rather than allowing NaN into reports", () => {
    const scorecard = routingExperimentScorecard({
      caseId: "case-7",
      generator: "x",
      control: arm(
        "control",
        candidate("c", {
          worthwhileMinuteRatio: Number.NaN,
          maneuversPer10Miles: -1,
        }),
      ),
      treatment: arm(
        "treatment",
        candidate("t", {
          worthwhileMinuteRatio: 0.8,
          maneuversPer10Miles: 8,
        }),
      ),
    });

    expect(scorecard.validity).toBe("valid");
    expect(scorecard.delta!.worthwhileMinuteRatio).toBeNull();
    expect(scorecard.delta!.maneuversPer10Miles).toBeNull();
  });
});
