import type { JevFrontierState } from "@/application/planner/jev-frontier-shadow";

/** Synthetic compact facts; no rider history or route geometry. */
export function frontierState(count = 3): JevFrontierState {
  return {
    schemaVersion: 1,
    intent: {
      roadCharacter: "curvy",
      surfacePreference: "mostly-pavement",
      terrainLevel: "moderate",
      noveltyPreference: "balanced",
      avoidHighways: true,
      tollPolicy: "avoid",
      timeboxSatisfied: null,
    },
    rider: null,
    deterministicBaselineId: "route-1",
    candidates: Array.from({ length: count }, (_, i) => ({
      id: `route-${i + 1}`,
      canonicalRank: i + 1,
      canonicalScore: 80 - i,
      distanceMeters: 40_000 + i * 1000,
      durationSeconds: 3600 + i * 60,
      evidenceCoverage: 0.8,
      riderPreferenceUtility: null,
      frontier: {
        timeEfficiency: 0.9 - i * 0.1,
        curvature: 0.5 + i * 0.1,
        flow: null,
        backroad: 0.8,
        surfaceFit: 0.9,
        gravelAffinity: null,
        trafficFlow: null,
        junctionFlow: null,
        novelty: null,
      },
      coherence: {
        explicitUTurns: 0,
        geometryReversals: 0,
        maneuverDensityPer10Miles: null,
        immediateBacktrackingShare: null,
        selfOverlapShare: null,
      },
    })),
  };
}

export function remoteAnswer(slots = ["A", "B", "C"], chosen = "A") {
  return {
    model: "typesafe/jev-1.13-20260917",
    answers: {
      choose: {
        type: "choice",
        choice: chosen,
        probabilities: Object.fromEntries(
          [...slots, "NONE"].map((s) => [
            s,
            s === chosen ? 0.85 : 0.15 / slots.length,
          ]),
        ),
        confidence: 0.8,
      },
      ...Object.fromEntries(
        slots.map((s) => [
          `fit_${s}`,
          {
            type: "score",
            score: 2.2,
            probabilities: { "0": 0, "1": 0, "2": 0.8, "3": 0.2 },
            confidence: 0.7,
            legend: {
              "0": "poor",
              "1": "acceptable",
              "2": "strong",
              "3": "exceptional",
            },
          },
        ]),
      ),
      improvement: { type: "noul", noul: 0.72 },
    },
    usage: { input_tokens: 41, output_tokens: 9, cost: 0.0001 },
  };
}

export const policy = {
  minimumChoiceConfidence: 0.7,
  minimumChosenProbability: 0.55,
  minimumChoiceMargin: 0.15,
  minimumMeaningfulImprovementProbability: 0.65,
};
export function replayCase(count = 3) {
  const state = frontierState(count);
  return {
    schemaVersion: 1 as const,
    caseId: "synthetic-case",
    corridorKey: "synthetic-corridor",
    rideSessionKey: "session-1",
    selector: "exact-bounded-regret-v1" as const,
    state,
    fingerprints: Object.fromEntries(
      state.candidates.map((c) => [c.id, `fingerprint-${c.id}`]),
    ),
    control: {
      source: "deterministic-baseline" as const,
      choiceCandidateId: "route-1",
      probabilitiesByCandidateId: Object.fromEntries(
        state.candidates.map((c) => [c.id, c.id === "route-1" ? 1 : 0]),
      ),
    },
  };
}
