import { describe, expect, it } from "vitest";

import {
  JEV_FRONTIER_NONE,
  auditJevFrontierOrder,
  buildBalancedJevFrontierPermutations,
  jevFrontierCounterfactual,
  projectJevFrontierTransportState,
  validateJevFrontierJudgment,
  validateJevFrontierState,
  type JevFrontierCandidateState,
  type JevFrontierJudgment,
  type JevFrontierOrderOutcome,
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
      mean: { curvature: 1.2, novelty: 0.7, timeEfficiency: -0.1 },
      precision: { curvature: 2.3, novelty: 1.4, timeEfficiency: 3.1 },
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
  const probabilities: Record<string, number> = {
    "0": 0,
    "1": 0,
    "2": 0,
    "3": 0,
  };
  const lower = Math.floor(value);
  const upper = Math.ceil(value);
  if (lower === upper) {
    probabilities[String(lower)] = 1;
  } else {
    probabilities[String(lower)] = upper - value;
    probabilities[String(upper)] = value - lower;
  }
  return {
    type: "score",
    score: value,
    probabilities,
    confidence,
  };
}

function judgment(
  choice = "route-b",
  options: {
    readonly model?: string;
    readonly choiceConfidence?: number;
    readonly probabilities?: Readonly<Record<string, number>>;
    readonly improvement?: number;
  } = {},
): JevFrontierJudgment {
  return {
    model: options.model ?? "typesafe/jev-1.13-20260917",
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

  it("treats malformed runtime JSON as invalid instead of throwing", () => {
    expect(() => validateJevFrontierState({
      schemaVersion: 1,
      intent: null,
      rider: null,
      deterministicBaselineId: "route-a",
      candidates: [{ id: 7 }, null],
    })).not.toThrow();
    expect(validateJevFrontierState({
      schemaVersion: 1,
      intent: null,
      rider: null,
      deterministicBaselineId: "route-a",
      candidates: [{ id: 7 }, null],
    })).toBe("invalid-state");
  });

  it("rejects a candidate set that exceeds the bounded experiment", () => {
    const value = state();
    expect(validateJevFrontierState({
      ...value,
      candidates: [...value.candidates, candidate("route-d", 4)],
    })).toBe("candidate-count");
  });

  it("rejects dangerous record-key candidate ids", () => {
    const value = state();
    expect(validateJevFrontierState({
      ...value,
      deterministicBaselineId: "__proto__",
      candidates: [
        candidate("__proto__", 1),
        candidate("route-b", 2),
      ],
    })).toBe("unsafe-candidate-id");
  });

  it("requires shortlist ranks to be unique and contiguous", () => {
    const value = state();
    expect(validateJevFrontierState({
      ...value,
      candidates: [
        candidate("route-a", 1),
        candidate("route-b", 3),
        candidate("route-c", 3),
      ],
    })).toBe("invalid-state");
  });

  it("validates canonical intent values at runtime", () => {
    const value = state();
    expect(validateJevFrontierState({
      ...value,
      intent: { ...value.intent, roadCharacter: "magic" },
    })).toBe("invalid-state");
  });

  it("requires posterior precision so uncertainty is preserved", () => {
    const value = state() as unknown as Record<string, unknown>;
    const rider = { ...(value["rider"] as Record<string, unknown>) };
    delete rider["precision"];
    expect(validateJevFrontierState({ ...value, rider })).toBe("invalid-state");
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

  it("requires the named Choice to be the unique probability argmax", () => {
    expect(validateJevFrontierJudgment(
      state(),
      judgment("route-b", {
        probabilities: {
          "route-a": 0.7,
          "route-b": 0.15,
          "route-c": 0.1,
          [JEV_FRONTIER_NONE]: 0.05,
        },
      }),
    )).toEqual({
      ok: false,
      reason: "invalid-choice",
    });

    expect(validateJevFrontierJudgment(
      state(),
      judgment("route-b", {
        probabilities: {
          "route-a": 0.4,
          "route-b": 0.4,
          "route-c": 0.1,
          [JEV_FRONTIER_NONE]: 0.1,
        },
      }),
    )).toEqual({
      ok: false,
      reason: "invalid-choice",
    });
  });

  it("rejects moving aliases or unrelated model ids", () => {
    expect(validateJevFrontierJudgment(
      state(),
      judgment("route-b", { model: "jev-latest" }),
    )).toEqual({
      ok: false,
      reason: "invalid-model",
    });
  });

  it("rejects score distributions outside the fixed 0-3 rubric", () => {
    const value = judgment();
    expect(validateJevFrontierJudgment(state(), {
      ...value,
      fitByCandidateId: {
        ...value.fitByCandidateId,
        "route-b": {
          type: "score",
          score: 4,
          probabilities: { "0": 0, "1": 0, "2": 0, "4": 1 },
          confidence: 1,
        },
      },
    })).toEqual({
      ok: false,
      reason: "invalid-fit",
    });
  });

  it("rejects a score that disagrees with its probability distribution", () => {
    const value = judgment();
    expect(validateJevFrontierJudgment(state(), {
      ...value,
      fitByCandidateId: {
        ...value.fitByCandidateId,
        "route-b": {
          type: "score",
          score: 3,
          probabilities: { "0": 1, "1": 0, "2": 0, "3": 0 },
          confidence: 1,
        },
      },
    })).toEqual({
      ok: false,
      reason: "invalid-fit",
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
      runnerUpProbability: 0.18,
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


  it("projects ablations without leaking stable ids or baseline identity", () => {
    const value = state();
    const permutation = buildBalancedJevFrontierPermutations(value, "case-17")[0]!;
    const a = projectJevFrontierTransportState(value, permutation, "A");
    const b = projectJevFrontierTransportState(value, permutation, "B");
    const c = projectJevFrontierTransportState(value, permutation, "C");

    expect(a).not.toBeNull();
    expect(JSON.stringify(a)).not.toContain("deterministicBaselineId");
    expect(JSON.stringify(a)).not.toContain("route-a");
    expect(JSON.stringify(a)).not.toContain("canonicalScore");
    expect(JSON.stringify(a)).not.toContain("riderPreferenceUtility");

    expect(b).not.toBeNull();
    expect(JSON.stringify(b)).not.toContain("canonicalScore");
    expect(JSON.stringify(b)).toContain("precision");
    expect(JSON.stringify(b)).toContain("riderPreferenceUtility");

    expect(c).not.toBeNull();
    expect(JSON.stringify(c)).toContain("canonicalScore");
    expect(JSON.stringify(c)).toContain("canonicalRank");
  });

  it("builds balanced seeded permutations for the order-bias audit", () => {
    const permutations = buildBalancedJevFrontierPermutations(state(), "case-17");
    expect(permutations).toHaveLength(3);
    expect(new Set(permutations.flatMap((item) =>
      item.slots.filter((slot) => slot.slot === "A").map((slot) => slot.candidateId),
    ))).toEqual(new Set(["route-a", "route-b", "route-c"]));
    expect(new Set(permutations.flatMap((item) =>
      item.slots.filter((slot) => slot.slot === "B").map((slot) => slot.candidateId),
    ))).toEqual(new Set(["route-a", "route-b", "route-c"]));
    expect(new Set(permutations.flatMap((item) =>
      item.slots.filter((slot) => slot.slot === "C").map((slot) => slot.candidateId),
    ))).toEqual(new Set(["route-a", "route-b", "route-c"]));
    expect(buildBalancedJevFrontierPermutations(state(), "case-17")).toEqual(permutations);
  });

  it("measures order-dependent verdict flips and withholds a stable choice", () => {
    const outcomes: JevFrontierOrderOutcome[] = [
      {
        permutationId: "p0",
        choiceCandidateId: "route-b",
        probabilitiesByCandidateId: {
          "route-a": 0.2,
          "route-b": 0.6,
          "route-c": 0.1,
        },
        noneProbability: 0.1,
      },
      {
        permutationId: "p1",
        choiceCandidateId: "route-b",
        probabilitiesByCandidateId: {
          "route-a": 0.18,
          "route-b": 0.62,
          "route-c": 0.1,
        },
        noneProbability: 0.1,
      },
      {
        permutationId: "p2",
        choiceCandidateId: "route-c",
        probabilitiesByCandidateId: {
          "route-a": 0.2,
          "route-b": 0.3,
          "route-c": 0.4,
        },
        noneProbability: 0.1,
      },
    ];

    expect(auditJevFrontierOrder(state(), outcomes)).toMatchObject({
      runs: 3,
      flipRate: 2 / 3,
      orderDependent: true,
      stableChoiceCandidateId: null,
    });
  });

  it("retains a stable choice only when every permutation agrees", () => {
    const outcomes: JevFrontierOrderOutcome[] = ["p0", "p1", "p2"].map(
      (permutationId) => ({
        permutationId,
        choiceCandidateId: "route-b",
        probabilitiesByCandidateId: {
          "route-a": 0.2,
          "route-b": 0.6,
          "route-c": 0.1,
        },
        noneProbability: 0.1,
      }),
    );

    expect(auditJevFrontierOrder(state(), outcomes)).toMatchObject({
      flipRate: 0,
      orderDependent: false,
      stableChoiceCandidateId: "route-b",
      meanProbabilityByCandidateId: {
        "route-a": 0.2,
        "route-b": 0.6,
        "route-c": 0.1,
      },
      meanNoneProbability: 0.1,
    });
  });
});
