/**
 * Shadow-only Jev decision seam for frontier routing.
 *
 * This module deliberately knows nothing about TypeSafe/OpenRouter transport.
 * It accepts only compact, already-computed OpenGravel facts and validates a
 * returned typed judgment. It cannot alter eligibility, RouteScore, geometry,
 * roles, or the selected route.
 *
 * Runtime wiring must remain downstream of:
 * provider candidates -> hard eligibility -> canonical evidence/score ->
 * Pareto/low-regret selection -> geometry diversity -> rider preference.
 */

import type {
  FrontierQualityVector,
} from "@/application/planner/frontier-routing";
import type {
  RiderPreferenceFeature,
} from "@/domain/personalization/rider-preference";

export const JEV_FRONTIER_MAX_CANDIDATES = 3;
export const JEV_FRONTIER_NONE = "NONE";

export interface JevFrontierIntentState {
  readonly roadCharacter: string;
  readonly surfacePreference: string;
  readonly terrainLevel: string;
  readonly noveltyPreference: string;
  readonly avoidHighways: boolean;
  readonly tollPolicy: string;
  /** Precomputed by OpenGravel. Jev must never do time arithmetic. */
  readonly timeboxSatisfied: boolean | null;
}

export interface JevFrontierRiderState {
  /**
   * Only compact posterior summaries are allowed here. Raw ride history,
   * raw GPS, saved routes and imported GPX are not Jev input.
   */
  readonly weights: Readonly<Partial<Record<RiderPreferenceFeature, number>>>;
  readonly evidence: Readonly<Partial<Record<RiderPreferenceFeature, number>>>;
  readonly explicitComparisons: number;
  readonly implicitComparisons: number;
}

export interface JevFrontierCandidateState {
  readonly id: string;
  readonly frontier: FrontierQualityVector;
  readonly canonicalScore: number;
  readonly canonicalRank: number;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly evidenceCoverage: number;
  readonly riderPreferenceUtility: number | null;
  readonly coherence: {
    readonly explicitUTurns: number;
    readonly geometryReversals: number;
    readonly maneuverDensityPer10Miles: number | null;
    readonly immediateBacktrackingShare: number | null;
    readonly selfOverlapShare: number | null;
  };
}

export interface JevFrontierState {
  readonly schemaVersion: 1;
  readonly intent: JevFrontierIntentState;
  readonly rider: JevFrontierRiderState | null;
  readonly deterministicBaselineId: string;
  readonly candidates: readonly JevFrontierCandidateState[];
}

export interface JevChoiceAnswer {
  readonly type: "choice";
  readonly choice: string;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence: number;
}

export interface JevScoreAnswer {
  readonly type: "score";
  readonly score: number;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence: number;
}

export interface JevNoulAnswer {
  readonly type: "noul";
  /** Probability that the proposition is true. */
  readonly noul: number;
}

export interface JevFrontierJudgment {
  readonly model: string;
  readonly choice: JevChoiceAnswer;
  readonly fitByCandidateId: Readonly<Record<string, JevScoreAnswer>>;
  readonly meaningfulImprovement: JevNoulAnswer;
}

/**
 * Application-owned port. Infrastructure may implement this with TypeSafe's
 * SDK, OpenRouter's Decisions API, or a replay fixture without changing the
 * routing domain.
 */
export interface JevFrontierJudge {
  judge(
    state: JevFrontierState,
    signal: AbortSignal,
  ): Promise<JevFrontierJudgment | null>;
}

export type JevFrontierValidationFailure =
  | "candidate-count"
  | "duplicate-candidate"
  | "baseline-missing"
  | "invalid-state"
  | "invalid-model"
  | "invalid-choice"
  | "invalid-choice-distribution"
  | "invalid-choice-confidence"
  | "invalid-fit"
  | "invalid-improvement-probability";

export type JevFrontierValidationResult =
  | { readonly ok: true; readonly judgment: JevFrontierJudgment }
  | { readonly ok: false; readonly reason: JevFrontierValidationFailure };

export interface JevFrontierCounterfactualPolicy {
  /**
   * Experiment-only thresholds. These MUST be tuned from labeled/blinded data
   * before any rider-visible use; they are intentionally caller supplied.
   */
  readonly minimumChoiceConfidence: number;
  readonly minimumChosenProbability: number;
  readonly minimumChoiceMargin: number;
  readonly minimumMeaningfulImprovementProbability: number;
}

export interface JevFrontierCounterfactual {
  readonly status:
    | "same-as-baseline"
    | "abstain"
    | "below-threshold"
    | "alternative";
  readonly candidateId: string | null;
  readonly choiceConfidence: number;
  readonly chosenProbability: number;
  readonly runnerUpProbability: number;
  readonly meaningfulImprovementProbability: number;
}

function unit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validFrontierVector(vector: FrontierQualityVector): boolean {
  return Object.values(vector).every((value) => value === null || unit(value));
}

function validCandidate(candidate: JevFrontierCandidateState): boolean {
  const coherence = candidate.coherence;
  return (
    candidate.id.trim().length > 0 &&
    validFrontierVector(candidate.frontier) &&
    Number.isFinite(candidate.canonicalScore) &&
    Number.isSafeInteger(candidate.canonicalRank) &&
    candidate.canonicalRank >= 1 &&
    finiteNonNegative(candidate.distanceMeters) &&
    finiteNonNegative(candidate.durationSeconds) &&
    unit(candidate.evidenceCoverage) &&
    (candidate.riderPreferenceUtility === null ||
      Number.isFinite(candidate.riderPreferenceUtility)) &&
    Number.isSafeInteger(coherence.explicitUTurns) &&
    coherence.explicitUTurns >= 0 &&
    Number.isSafeInteger(coherence.geometryReversals) &&
    coherence.geometryReversals >= 0 &&
    (coherence.maneuverDensityPer10Miles === null ||
      finiteNonNegative(coherence.maneuverDensityPer10Miles)) &&
    (coherence.immediateBacktrackingShare === null ||
      unit(coherence.immediateBacktrackingShare)) &&
    (coherence.selfOverlapShare === null || unit(coherence.selfOverlapShare))
  );
}

/**
 * Fail-closed validator for the exact compact state permitted to leave
 * OpenGravel's deterministic routing domain.
 */
export function validateJevFrontierState(
  state: JevFrontierState,
): JevFrontierValidationFailure | null {
  if (state.schemaVersion !== 1) return "invalid-state";
  if (
    state.candidates.length < 2 ||
    state.candidates.length > JEV_FRONTIER_MAX_CANDIDATES
  ) return "candidate-count";

  const ids = state.candidates.map((candidate) => candidate.id);
  if (new Set(ids).size !== ids.length) return "duplicate-candidate";
  if (!ids.includes(state.deterministicBaselineId)) return "baseline-missing";

  if (
    state.intent.roadCharacter.trim().length === 0 ||
    state.intent.surfacePreference.trim().length === 0 ||
    state.intent.terrainLevel.trim().length === 0 ||
    state.intent.noveltyPreference.trim().length === 0 ||
    state.intent.tollPolicy.trim().length === 0 ||
    (state.intent.timeboxSatisfied !== null &&
      typeof state.intent.timeboxSatisfied !== "boolean") ||
    !state.candidates.every(validCandidate)
  ) return "invalid-state";

  if (state.rider !== null) {
    if (
      !Number.isSafeInteger(state.rider.explicitComparisons) ||
      state.rider.explicitComparisons < 0 ||
      !Number.isSafeInteger(state.rider.implicitComparisons) ||
      state.rider.implicitComparisons < 0 ||
      Object.values(state.rider.weights).some(
        (value) => value !== undefined && !Number.isFinite(value),
      ) ||
      Object.values(state.rider.evidence).some(
        (value) => value !== undefined && !finiteNonNegative(value),
      )
    ) return "invalid-state";
  }

  return null;
}

function validDistribution(
  probabilities: Readonly<Record<string, number>>,
  allowed: ReadonlySet<string>,
): boolean {
  const entries = Object.entries(probabilities);
  if (entries.length !== allowed.size) return false;
  let total = 0;
  for (const [key, value] of entries) {
    if (!allowed.has(key) || !unit(value)) return false;
    total += value;
  }
  // Provider values may be rounded; tolerate a small presentation error.
  return Math.abs(total - 1) <= 0.02;
}

const JEV_FIT_LEVELS = new Set(["0", "1", "2", "3"]);

function validFit(answer: JevScoreAnswer): boolean {
  return (
    answer.type === "score" &&
    Number.isFinite(answer.score) &&
    answer.score >= 0 &&
    answer.score <= 3 &&
    unit(answer.confidence) &&
    validDistribution(answer.probabilities, JEV_FIT_LEVELS)
  );
}

/**
 * Validates Jev output against the exact candidate set that was sent.
 *
 * Unknown candidate ids, malformed distributions, absent fit scores, invalid
 * confidence, or malformed noul output all become "no judgment". They never
 * become a planning error.
 */
export function validateJevFrontierJudgment(
  state: JevFrontierState,
  judgment: JevFrontierJudgment,
): JevFrontierValidationResult {
  const stateFailure = validateJevFrontierState(state);
  if (stateFailure !== null) return { ok: false, reason: stateFailure };
  if (judgment.model.trim().length === 0) {
    return { ok: false, reason: "invalid-model" };
  }

  const candidateIds = new Set(state.candidates.map((candidate) => candidate.id));
  const choiceIds = new Set([...candidateIds, JEV_FRONTIER_NONE]);
  if (
    judgment.choice.type !== "choice" ||
    !choiceIds.has(judgment.choice.choice)
  ) return { ok: false, reason: "invalid-choice" };
  if (!unit(judgment.choice.confidence)) {
    return { ok: false, reason: "invalid-choice-confidence" };
  }
  if (!validDistribution(judgment.choice.probabilities, choiceIds)) {
    return { ok: false, reason: "invalid-choice-distribution" };
  }

  const fitIds = Object.keys(judgment.fitByCandidateId);
  if (
    fitIds.length !== candidateIds.size ||
    fitIds.some((id) => !candidateIds.has(id)) ||
    [...candidateIds].some((id) => !validFit(judgment.fitByCandidateId[id]!))
  ) return { ok: false, reason: "invalid-fit" };

  if (
    judgment.meaningfulImprovement.type !== "noul" ||
    !unit(judgment.meaningfulImprovement.noul)
  ) return { ok: false, reason: "invalid-improvement-probability" };

  return { ok: true, judgment };
}

function validPolicy(policy: JevFrontierCounterfactualPolicy): boolean {
  return (
    unit(policy.minimumChoiceConfidence) &&
    unit(policy.minimumChosenProbability) &&
    unit(policy.minimumChoiceMargin) &&
    unit(policy.minimumMeaningfulImprovementProbability)
  );
}

/**
 * Produces telemetry-only counterfactual output.
 *
 * This function does NOT select a route. A future experiment can compare this
 * result with the deterministic winner and blinded rider outcomes. Making it
 * rider-visible requires a separate reviewed change and calibrated thresholds.
 */
export function jevFrontierCounterfactual(
  state: JevFrontierState,
  judgment: JevFrontierJudgment,
  policy: JevFrontierCounterfactualPolicy,
): JevFrontierCounterfactual | null {
  if (!validPolicy(policy)) return null;
  const validation = validateJevFrontierJudgment(state, judgment);
  if (!validation.ok) return null;

  const chosen = judgment.choice.choice;
  const chosenProbability = judgment.choice.probabilities[chosen] ?? 0;
  const runnerUpProbability = Math.max(
    0,
    ...Object.entries(judgment.choice.probabilities)
      .filter(([id]) => id !== chosen)
      .map(([, probability]) => probability),
  );
  const base = {
    choiceConfidence: judgment.choice.confidence,
    chosenProbability,
    runnerUpProbability,
    meaningfulImprovementProbability: judgment.meaningfulImprovement.noul,
  };

  if (chosen === JEV_FRONTIER_NONE) {
    return { ...base, status: "abstain", candidateId: null };
  }
  if (chosen === state.deterministicBaselineId) {
    return { ...base, status: "same-as-baseline", candidateId: chosen };
  }

  const passes =
    judgment.choice.confidence >= policy.minimumChoiceConfidence &&
    chosenProbability >= policy.minimumChosenProbability &&
    chosenProbability - runnerUpProbability >= policy.minimumChoiceMargin &&
    judgment.meaningfulImprovement.noul >=
      policy.minimumMeaningfulImprovementProbability;

  return {
    ...base,
    status: passes ? "alternative" : "below-threshold",
    candidateId: chosen,
  };
}
