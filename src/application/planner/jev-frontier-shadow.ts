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

import {
  FRONTIER_QUALITY_KEYS,
  type FrontierQualityVector,
} from "@/application/planner/frontier-routing";
import {
  RIDER_PREFERENCE_FEATURES,
  type RiderPreferenceFeature,
} from "@/domain/personalization/rider-preference";

export const JEV_FRONTIER_MAX_CANDIDATES = 3;
export const JEV_FRONTIER_NONE = "NONE";
export const JEV_FRONTIER_PINNED_MODEL = "typesafe/jev-1.13";
export const JEV_FRONTIER_SLOTS = ["A", "B", "C"] as const;

export type JevFrontierSlot = (typeof JEV_FRONTIER_SLOTS)[number];

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UNSAFE_RECORD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SCORE_LEVELS = ["0", "1", "2", "3"] as const;
const SCORE_TOLERANCE = 0.02;
const PROBABILITY_SUM_TOLERANCE = 0.02;
const PROBABILITY_TIE_EPSILON = 1e-9;

const ROAD_CHARACTERS = new Set(["efficient", "balanced", "curvy", "backroads"]);
const SURFACE_PREFERENCES = new Set([
  "pavement",
  "mostly-pavement",
  "mixed",
  "dirt-preferred",
]);
const TERRAIN_LEVELS = new Set([
  "known-easy-only",
  "moderate",
  "any-supported",
]);
const NOVELTY_PREFERENCES = new Set([
  "prefer-new-to-me",
  "balanced",
  "prefer-familiar",
]);
const TOLL_POLICIES = new Set(["avoid", "allow-with-warning"]);
const RIDER_FEATURE_KEYS = new Set<string>(RIDER_PREFERENCE_FEATURES);
const FRONTIER_KEYS = new Set<string>(FRONTIER_QUALITY_KEYS);

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
   * Compact posterior summary only. Raw ride history, raw GPS, saved routes and
   * imported GPX are never Jev input.
   */
  readonly mean: Readonly<Partial<Record<RiderPreferenceFeature, number>>>;
  /** Precision is required because equal means can carry very different uncertainty. */
  readonly precision: Readonly<Partial<Record<RiderPreferenceFeature, number>>>;
  readonly evidence: Readonly<Partial<Record<RiderPreferenceFeature, number>>>;
  readonly explicitComparisons: number;
  readonly implicitComparisons: number;
}

export interface JevFrontierCandidateState {
  readonly id: string;
  readonly frontier: FrontierQualityVector;
  readonly canonicalScore: number;
  /** Rank within this frozen shortlist; ranks must be unique and contiguous. */
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
  /** Expected value implied by the 0..3 probability distribution. */
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

export type JevFrontierValidationFailure =
  | "candidate-count"
  | "duplicate-candidate"
  | "unsafe-candidate-id"
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

export type JevFrontierJudgeResult =
  | {
      readonly status: "ok";
      readonly judgment: JevFrontierJudgment;
      readonly latencyMs: number;
    }
  | {
      readonly status: "skipped";
      readonly reason: "disabled" | "invalid-state" | "cancelled";
      readonly latencyMs: number;
    }
  | {
      readonly status: "failed";
      readonly reason: "timeout" | "transport-error" | "aborted";
      readonly latencyMs: number;
    }
  | {
      readonly status: "invalid";
      readonly reason: JevFrontierValidationFailure | "malformed-response";
      readonly latencyMs: number;
    };

/**
 * Application-owned port. Infrastructure may implement this with TypeSafe's
 * SDK, OpenRouter's Decisions API, or a replay fixture without changing routing
 * or domain code. Failure is structured because experiment telemetry must
 * distinguish disabled, timeout, transport failure and malformed output.
 */
export interface JevFrontierJudge {
  judge(
    state: JevFrontierState,
    signal: AbortSignal,
  ): Promise<JevFrontierJudgeResult>;
}

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

export interface JevFrontierPermutation {
  readonly id: string;
  readonly slots: readonly {
    readonly slot: JevFrontierSlot;
    readonly candidateId: string;
  }[];
}

export interface JevFrontierOrderOutcome {
  readonly permutationId: string;
  /** Stable candidate id after the adapter maps A/B/C back; null means NONE. */
  readonly choiceCandidateId: string | null;
  readonly probabilitiesByCandidateId: Readonly<Record<string, number>>;
  readonly noneProbability: number;
}

export interface JevFrontierOrderAudit {
  readonly runs: number;
  /** Pairwise fraction of permutation verdicts that disagree. */
  readonly flipRate: number;
  readonly orderDependent: boolean;
  /** Only populated when every permutation returns the same stable verdict. */
  readonly stableChoiceCandidateId: string | null;
  readonly meanProbabilityByCandidateId: Readonly<Record<string, number>>;
  readonly meanNoneProbability: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}

function unit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function safeCandidateId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    SAFE_ID.test(value) &&
    value !== JEV_FRONTIER_NONE &&
    !UNSAFE_RECORD_KEYS.has(value)
  );
}

function validKnownFeatureRecord(
  value: unknown,
  options: { readonly positive?: boolean; readonly nonNegative?: boolean } = {},
): boolean {
  if (!isRecord(value)) return false;
  for (const [key, raw] of Object.entries(value)) {
    if (!RIDER_FEATURE_KEYS.has(key)) return false;
    if (typeof raw !== "number" || !Number.isFinite(raw)) return false;
    if (options.positive === true && raw <= 0) return false;
    if (options.nonNegative === true && raw < 0) return false;
  }
  return true;
}

function validFrontierVector(value: unknown): value is FrontierQualityVector {
  if (!isRecord(value) || !hasExactKeys(value, FRONTIER_KEYS)) return false;
  return FRONTIER_QUALITY_KEYS.every((key) => value[key] === null || unit(value[key]));
}

function validIntent(value: unknown): value is JevFrontierIntentState {
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, new Set([
    "roadCharacter",
    "surfacePreference",
    "terrainLevel",
    "noveltyPreference",
    "avoidHighways",
    "tollPolicy",
    "timeboxSatisfied",
  ]))) return false;

  return (
    typeof value["roadCharacter"] === "string" &&
    ROAD_CHARACTERS.has(value["roadCharacter"]) &&
    typeof value["surfacePreference"] === "string" &&
    SURFACE_PREFERENCES.has(value["surfacePreference"]) &&
    typeof value["terrainLevel"] === "string" &&
    TERRAIN_LEVELS.has(value["terrainLevel"]) &&
    typeof value["noveltyPreference"] === "string" &&
    NOVELTY_PREFERENCES.has(value["noveltyPreference"]) &&
    typeof value["avoidHighways"] === "boolean" &&
    typeof value["tollPolicy"] === "string" &&
    TOLL_POLICIES.has(value["tollPolicy"]) &&
    (value["timeboxSatisfied"] === null ||
      typeof value["timeboxSatisfied"] === "boolean")
  );
}

function validRider(value: unknown): value is JevFrontierRiderState {
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, new Set([
    "mean",
    "precision",
    "evidence",
    "explicitComparisons",
    "implicitComparisons",
  ]))) return false;

  return (
    validKnownFeatureRecord(value["mean"]) &&
    validKnownFeatureRecord(value["precision"], { positive: true }) &&
    validKnownFeatureRecord(value["evidence"], { nonNegative: true }) &&
    Number.isSafeInteger(value["explicitComparisons"]) &&
    Number(value["explicitComparisons"]) >= 0 &&
    Number.isSafeInteger(value["implicitComparisons"]) &&
    Number(value["implicitComparisons"]) >= 0
  );
}

function validCoherence(
  value: unknown,
): value is JevFrontierCandidateState["coherence"] {
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, new Set([
    "explicitUTurns",
    "geometryReversals",
    "maneuverDensityPer10Miles",
    "immediateBacktrackingShare",
    "selfOverlapShare",
  ]))) return false;

  return (
    Number.isSafeInteger(value["explicitUTurns"]) &&
    Number(value["explicitUTurns"]) >= 0 &&
    Number.isSafeInteger(value["geometryReversals"]) &&
    Number(value["geometryReversals"]) >= 0 &&
    (value["maneuverDensityPer10Miles"] === null ||
      finiteNonNegative(value["maneuverDensityPer10Miles"])) &&
    (value["immediateBacktrackingShare"] === null ||
      unit(value["immediateBacktrackingShare"])) &&
    (value["selfOverlapShare"] === null || unit(value["selfOverlapShare"]))
  );
}

function validCandidate(value: unknown): value is JevFrontierCandidateState {
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, new Set([
    "id",
    "frontier",
    "canonicalScore",
    "canonicalRank",
    "distanceMeters",
    "durationSeconds",
    "evidenceCoverage",
    "riderPreferenceUtility",
    "coherence",
  ]))) return false;

  return (
    safeCandidateId(value["id"]) &&
    validFrontierVector(value["frontier"]) &&
    typeof value["canonicalScore"] === "number" &&
    Number.isFinite(value["canonicalScore"]) &&
    Number.isSafeInteger(value["canonicalRank"]) &&
    Number(value["canonicalRank"]) >= 1 &&
    finitePositive(value["distanceMeters"]) &&
    finitePositive(value["durationSeconds"]) &&
    unit(value["evidenceCoverage"]) &&
    (value["riderPreferenceUtility"] === null ||
      (typeof value["riderPreferenceUtility"] === "number" &&
        Number.isFinite(value["riderPreferenceUtility"]))) &&
    validCoherence(value["coherence"])
  );
}

function contiguousRanks(candidates: readonly JevFrontierCandidateState[]): boolean {
  const ranks = candidates.map((candidate) => candidate.canonicalRank).sort((a, b) => a - b);
  return ranks.every((rank, index) => rank === index + 1);
}

/**
 * Fail-closed runtime validator for the exact compact state permitted to leave
 * OpenGravel's deterministic routing domain.
 */
export function validateJevFrontierState(
  state: unknown,
): JevFrontierValidationFailure | null {
  if (!isRecord(state)) return "invalid-state";
  if (!hasExactKeys(state, new Set([
    "schemaVersion",
    "intent",
    "rider",
    "deterministicBaselineId",
    "candidates",
  ]))) return "invalid-state";
  if (state["schemaVersion"] !== 1) return "invalid-state";
  if (!Array.isArray(state["candidates"])) return "invalid-state";
  if (
    state["candidates"].length < 2 ||
    state["candidates"].length > JEV_FRONTIER_MAX_CANDIDATES
  ) return "candidate-count";
  if (!validIntent(state["intent"])) return "invalid-state";
  if (state["rider"] !== null && !validRider(state["rider"])) return "invalid-state";
  if (!state["candidates"].every(validCandidate)) {
    const ids = state["candidates"]
      .filter(isRecord)
      .map((candidate) => candidate["id"]);
    if (ids.some((id) => typeof id === "string" && !safeCandidateId(id))) {
      return "unsafe-candidate-id";
    }
    return "invalid-state";
  }

  const candidates = state["candidates"] as JevFrontierCandidateState[];
  const ids = candidates.map((candidate) => candidate.id);
  if (new Set(ids).size !== ids.length) return "duplicate-candidate";
  if (!contiguousRanks(candidates)) return "invalid-state";
  if (!safeCandidateId(state["deterministicBaselineId"])) {
    return "unsafe-candidate-id";
  }
  if (!ids.includes(state["deterministicBaselineId"])) return "baseline-missing";
  return null;
}

function validDistribution(
  probabilities: unknown,
  allowed: ReadonlySet<string>,
): probabilities is Readonly<Record<string, number>> {
  if (!isRecord(probabilities)) return false;
  const entries = Object.entries(probabilities);
  if (entries.length !== allowed.size) return false;
  let total = 0;
  for (const [key, value] of entries) {
    if (!allowed.has(key) || !unit(value)) return false;
    total += value;
  }
  return Math.abs(total - 1) <= PROBABILITY_SUM_TOLERANCE;
}

function expectedScore(probabilities: Readonly<Record<string, number>>): number {
  return SCORE_LEVELS.reduce(
    (sum, level) => sum + Number(level) * (probabilities[level] ?? 0),
    0,
  );
}

function validFit(value: unknown): value is JevScoreAnswer {
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, new Set(["type", "score", "probabilities", "confidence"]))) {
    return false;
  }
  if (
    value["type"] !== "score" ||
    typeof value["score"] !== "number" ||
    !Number.isFinite(value["score"]) ||
    value["score"] < 0 ||
    value["score"] > 3 ||
    !unit(value["confidence"]) ||
    !validDistribution(value["probabilities"], new Set(SCORE_LEVELS))
  ) return false;

  const probabilities = value["probabilities"] as Readonly<Record<string, number>>;
  return Math.abs(value["score"] - expectedScore(probabilities)) <= SCORE_TOLERANCE;
}

function validPinnedModel(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^(?:typesafe\/)?jev-1\.13(?:-\d{8})?$/.test(value);
}

function uniqueArgmax(
  probabilities: Readonly<Record<string, number>>,
): string | null {
  const entries = Object.entries(probabilities);
  if (entries.length === 0) return null;
  const maximum = Math.max(...entries.map(([, probability]) => probability));
  const winners = entries
    .filter(([, probability]) => Math.abs(probability - maximum) <= PROBABILITY_TIE_EPSILON)
    .map(([id]) => id);
  return winners.length === 1 ? winners[0] ?? null : null;
}

/**
 * Validates remote Jev JSON against the exact candidate set that was sent.
 *
 * The input is unknown intentionally: TypeScript types do not validate network
 * data. No property is read before its containing object has been guarded.
 */
export function validateJevFrontierJudgment(
  state: JevFrontierState,
  judgment: unknown,
): JevFrontierValidationResult {
  const stateFailure = validateJevFrontierState(state);
  if (stateFailure !== null) return { ok: false, reason: stateFailure };
  if (!isRecord(judgment)) {
    return { ok: false, reason: "invalid-state" };
  }
  if (!hasExactKeys(judgment, new Set([
    "model",
    "choice",
    "fitByCandidateId",
    "meaningfulImprovement",
  ]))) return { ok: false, reason: "invalid-state" };
  if (!validPinnedModel(judgment["model"])) {
    return { ok: false, reason: "invalid-model" };
  }

  const candidateIds = new Set(state.candidates.map((candidate) => candidate.id));
  const choiceIds = new Set([...candidateIds, JEV_FRONTIER_NONE]);
  const choice = judgment["choice"];
  if (!isRecord(choice)) return { ok: false, reason: "invalid-choice" };
  if (!hasExactKeys(choice, new Set(["type", "choice", "probabilities", "confidence"]))) {
    return { ok: false, reason: "invalid-choice" };
  }
  if (
    choice["type"] !== "choice" ||
    typeof choice["choice"] !== "string" ||
    !choiceIds.has(choice["choice"])
  ) return { ok: false, reason: "invalid-choice" };
  if (!unit(choice["confidence"])) {
    return { ok: false, reason: "invalid-choice-confidence" };
  }
  if (!validDistribution(choice["probabilities"], choiceIds)) {
    return { ok: false, reason: "invalid-choice-distribution" };
  }
  const probabilities = choice["probabilities"] as Readonly<Record<string, number>>;
  if (uniqueArgmax(probabilities) !== choice["choice"]) {
    return { ok: false, reason: "invalid-choice" };
  }

  const fits = judgment["fitByCandidateId"];
  if (!isRecord(fits)) return { ok: false, reason: "invalid-fit" };
  const fitIds = Object.keys(fits);
  if (
    fitIds.length !== candidateIds.size ||
    fitIds.some((id) => !candidateIds.has(id)) ||
    [...candidateIds].some((id) => !validFit(fits[id]))
  ) return { ok: false, reason: "invalid-fit" };

  const improvement = judgment["meaningfulImprovement"];
  if (
    !isRecord(improvement) ||
    !hasExactKeys(improvement, new Set(["type", "noul"])) ||
    improvement["type"] !== "noul" ||
    !unit(improvement["noul"])
  ) return { ok: false, reason: "invalid-improvement-probability" };

  return {
    ok: true,
    judgment: judgment as unknown as JevFrontierJudgment,
  };
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
 * Produces telemetry-only counterfactual output from one validated judgment.
 *
 * Order-dependent multi-run verdicts must be rejected by the order audit before
 * a caller treats this as a meaningful counterfactual.
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

function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Builds a reproducible balanced order audit.
 *
 * Two candidates produce AB and BA. Three candidates produce three cyclic
 * permutations so every stable candidate occupies A, B and C exactly once.
 * The seed should include a stable experiment/corpus id; changing it changes
 * the starting assignment without destroying replayability.
 */
export function buildBalancedJevFrontierPermutations(
  state: JevFrontierState,
  seed: string,
): readonly JevFrontierPermutation[] {
  if (validateJevFrontierState(state) !== null || seed.length === 0) return [];
  const ordered = [...state.candidates]
    .map((candidate) => candidate.id)
    .sort((left, right) => {
      const delta = hash32(`${seed}|${left}`) - hash32(`${seed}|${right}`);
      return delta !== 0 ? delta : left.localeCompare(right);
    });

  return ordered.map((_, shift) => ({
    id: `balanced-${ordered.length}-${shift}`,
    slots: ordered.map((candidateId, index) => ({
      slot: JEV_FRONTIER_SLOTS[index]!,
      candidateId: ordered[(index + shift) % ordered.length]!,
    })),
  }));
}

/**
 * Measures Choice-order sensitivity after each A/B/C result has been remapped
 * to stable candidate ids. Any flip is order dependence and therefore an
 * abstention for P0 promotion purposes.
 */
export function auditJevFrontierOrder(
  state: JevFrontierState,
  outcomes: readonly JevFrontierOrderOutcome[],
): JevFrontierOrderAudit | null {
  if (validateJevFrontierState(state) !== null || outcomes.length < 2) return null;
  const candidateIds = state.candidates.map((candidate) => candidate.id);
  const allowedIds = new Set(candidateIds);
  const seenPermutations = new Set<string>();
  const sums = Object.fromEntries(candidateIds.map((id) => [id, 0])) as Record<string, number>;
  let noneSum = 0;

  for (const outcome of outcomes) {
    if (
      outcome.permutationId.length === 0 ||
      seenPermutations.has(outcome.permutationId) ||
      (outcome.choiceCandidateId !== null && !allowedIds.has(outcome.choiceCandidateId)) ||
      !validDistribution(outcome.probabilitiesByCandidateId, allowedIds) ||
      !unit(outcome.noneProbability)
    ) return null;
    seenPermutations.add(outcome.permutationId);

    const candidateTotal = Object.values(outcome.probabilitiesByCandidateId)
      .reduce((sum, probability) => sum + probability, 0);
    if (Math.abs(candidateTotal + outcome.noneProbability - 1) > PROBABILITY_SUM_TOLERANCE) {
      return null;
    }
    for (const id of candidateIds) sums[id] += outcome.probabilitiesByCandidateId[id] ?? 0;
    noneSum += outcome.noneProbability;
  }

  let disagreements = 0;
  let pairs = 0;
  for (let left = 0; left < outcomes.length; left += 1) {
    for (let right = left + 1; right < outcomes.length; right += 1) {
      pairs += 1;
      if (outcomes[left]!.choiceCandidateId !== outcomes[right]!.choiceCandidateId) {
        disagreements += 1;
      }
    }
  }

  const flipRate = pairs === 0 ? 0 : disagreements / pairs;
  const stableChoice = flipRate === 0 ? outcomes[0]!.choiceCandidateId : null;
  const means = Object.fromEntries(
    candidateIds.map((id) => [id, sums[id]! / outcomes.length]),
  ) as Record<string, number>;

  return {
    runs: outcomes.length,
    flipRate,
    orderDependent: flipRate > 0,
    stableChoiceCandidateId: stableChoice,
    meanProbabilityByCandidateId: means,
    meanNoneProbability: noneSum / outcomes.length,
  };
}
