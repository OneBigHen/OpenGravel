import { describe, expect, it } from "vitest";

import {
  JEV_FRONTIER_NONE,
  jevFrontierCounterfactual,
  validateJevFrontierJudgment,
  validateJevFrontierState,
  type JevFrontierCandidateState,
  type JevFrontierJudgment,
  type JevFrontierState,
} from "@/application/planner/jev-frontier-shadow";
import type { FrontierQualityVector } from "@/application/planner/frontier-routing";

function frontier(
  overrides: Partial<FrontierQualityVector> = {},
): FrontierQualityVector {
  return {
    timeEfficiency: 0.7,
    curvature: 0.7,
    flow: 0.7,
    backroad: 0.7,
    surfaceFit: 0.9,
    gravelAffinity: 0.2,
    trafficFlow: 0.6,
    junctionFlow: 0.6,
    novelty: 0.5,
    ...overrides,
  };
}

function candidate(
  id: string,
  rank: number,
  overrides: Partial<JevFrontierCandidateState> = {},
): JevFrontierCandidateState {
  return {
    id,
    frontier: frontier(),
    canonicalScore: 78 - rank,
    canonicalRank: rank,
    distanceMeters: 55_000,
    durationSeconds: 4_200,
    evidenceCoverage: 0.92,
    riderPreferenceUtility: 0.4,
    coherence: {
      explicitUTurns: 0,
      geometryReversals: 0,
      maneuverDensityPer10Miles: 5,
      immediateBacktrackingShare: 0.02,
      selfOverlapShare: 0.04,
    },
    ...overrides,
  };
}

function state(): JevFrontierState {
  return {
    schemaVersion: 1,
    intent: {
      roadCharacter: "curvy",
      surfacePreference: "mostly-pavement",
      terrainLevel: "moderate",
      noveltyPreference: "prefer-new-to-me",
      avoidHighways: true,
      tollPolicy: "avoid",
      timeboxSatisfied: true,
    },
    rider: {
      weights: { curvature: 1.2, novelty: 0.7, timeEfficiency: -0.1 },
      evidence: { curvature: 3.1, novelty: 1.8, timeEfficiency: 2.2 },
      explicitComparisons: 6,
      implicitComparisons: 3,
    },
    deterministicBaselineId: "route-a",
    candidates: [
      candidate("route-a", 1),
      candidate("route-b", 2, {
        frontier: frontier({ curvature: 0.92, novelty: 0.8, timeEfficiency: 0.58 }),
      }),
      candidate("route-c", 3, {
        frontier: frontier({ backroad: 0.92, flow: 0.86 }),
      }),
    ],
  };
}

function score(
  value: number,
  confidence = 0.8,
): JevFrontierJudgment["fitByCandidateId"][string] {
  return {
    type: "score",
    score: value,
    probabilities: {
      "0": 0.05,
      "1": 0.1,
      "2": 0.25,
      "3": 0.6,
    },
    confidence,
  };
}

function judgment(
  choice = "route-b",
  options: {
    readonly choiceConfidence?: number;
    readonly probabilities?: Readonly<Record<string, number>>;
    readonly improvement?: number;
  } = {},
): JevFrontierJudgment {
  return {
    model: "typesafe/jev-1.13-20260917",
    choice: {
      type: "choice",
      choice,
      probabilities: options.probabilities ?? {
        "route-a": 0.18,
        "route-b": 0.68,
        "route-c": 0.09,
        [JEV_FRONTIER_NONE]: 0.05,
      },
      confidence: options.choiceConfidence ?? 0.8,
    },
    fitByCandidateId: {
      "route-a": score(2.2),
      "route-b": score(2.6),
      "route-c": score(1.9),
    },
    meaningfulImprovement: {
      type: "noul",
      noul: options.improvement ?? 0.74,
    },
  };
}

const policy = {
  minimumChoiceConfidence: 0.7,
  minimumChosenProbability: 0.55,
  minimumChoiceMargin: 0.15,
  minimumMeaningfulImprovementProbability: 0.65,
};

describe("Jev frontier shadow contract", () => {
  it("accepts a compact two-to-three candidate state", () => {
    expect(validateJevFrontierState(state())).toBeNull();
  });

  it("rejects a candidate set that exceeds the bounded experiment", () => {
    const value = state();
    expect(validateJevFrontierState({
      ...value,
      candidates: [...value.candidates, candidate("route-d", 4)],
    })).toBe("candidate-count");
  });

  it("requires the deterministic baseline to be present", () => {
    expect(validateJevFrontierState({
      ...state(),
      deterministicBaselineId: "missing",
    })).toBe("baseline-missing");
  });

  it("rejects malformed or invented candidate ids in the Jev choice", () => {
    expect(validateJevFrontierJudgment(state(), judgment("route-x"))).toEqual({
      ok: false,
      reason: "invalid-choice",
    });
  });

  it("rejects malformed choice probability distributions", () => {
    expect(validateJevFrontierJudgment(
      state(),
      judgment("route-b", {
        probabilities: {
          "route-a": 0.1,
          "route-b": 0.2,
          "route-c": 0.1,
          [JEV_FRONTIER_NONE]: 0.1,
        },
      }),
    )).toEqual({
      ok: false,
      reason: "invalid-choice-distribution",
    });
  });

  it("requires one fit score for every candidate and no invented ids", () => {
    const value = judgment();
    expect(validateJevFrontierJudgment(state(), {
      ...value,
      fitByCandidateId: {
        "route-a": score(2),
        "route-b": score(2),
      },
    })).toEqual({
      ok: false,
      reason: "invalid-fit",
    });
  });

  it("records a strong alternative only as a counterfactual", () => {
    expect(jevFrontierCounterfactual(state(), judgment(), policy)).toMatchObject({
      status: "alternative",
      candidateId: "route-b",
      choiceConfidence: 0.8,
      chosenProbability: 0.68,
      meaningfulImprovementProbability: 0.74,
    });
  });

  it("does not call a weak alternative a counterfactual winner", () => {
    expect(jevFrontierCounterfactual(
      state(),
      judgment("route-b", {
        choiceConfidence: 0.55,
        probabilities: {
          "route-a": 0.33,
          "route-b": 0.39,
          "route-c": 0.2,
          [JEV_FRONTIER_NONE]: 0.08,
        },
        improvement: 0.52,
      }),
      policy,
    )).toMatchObject({
      status: "below-threshold",
      candidateId: "route-b",
    });
  });

  it("preserves explicit Jev abstention", () => {
    expect(jevFrontierCounterfactual(
      state(),
      judgment(JEV_FRONTIER_NONE, {
        probabilities: {
          "route-a": 0.15,
          "route-b": 0.15,
          "route-c": 0.1,
          [JEV_FRONTIER_NONE]: 0.6,
        },
      }),
      policy,
    )).toMatchObject({
      status: "abstain",
      candidateId: null,
    });
  });

  it("records agreement with the deterministic baseline separately", () => {
    expect(jevFrontierCounterfactual(
      state(),
      judgment("route-a", {
        probabilities: {
          "route-a": 0.7,
          "route-b": 0.15,
          "route-c": 0.1,
          [JEV_FRONTIER_NONE]: 0.05,
        },
      }),
      policy,
    )).toMatchObject({
      status: "same-as-baseline",
      candidateId: "route-a",
    });
  });

  it("returns null for invalid experiment thresholds", () => {
    expect(jevFrontierCounterfactual(state(), judgment(), {
      ...policy,
      minimumChoiceConfidence: 2,
    })).toBeNull();
  });
});
