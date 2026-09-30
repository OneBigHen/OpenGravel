/**
 * Fast rider-preference learning from pairwise choices.
 *
 * The model intentionally stays small and interpretable: eight bounded route
 * features, a diagonal Gaussian posterior over their latent utility weights,
 * and a Bradley-Terry likelihood for "A or B?" choices. The posterior update is
 * an online diagonal Laplace/Newton step, so one explicit comparison updates
 * only the dimensions that actually differed between the two roads.
 *
 * No clock, network, AI model or storage is used here. The same model and
 * observation always produce the same posterior.
 */

export const RIDER_PREFERENCE_FEATURES = [
  "curvature",
  "backroad",
  "unpaved",
  "elevation",
  "trafficCalm",
  "junctionFlow",
  "novelty",
  "timeEfficiency",
] as const;

export type RiderPreferenceFeature = (typeof RIDER_PREFERENCE_FEATURES)[number];

export type RiderPreferenceVector = Readonly<
  Record<RiderPreferenceFeature, number | null>
>;

export interface RiderPreferenceModel {
  readonly version: 1;
  readonly mean: Readonly<Record<RiderPreferenceFeature, number>>;
  readonly precision: Readonly<Record<RiderPreferenceFeature, number>>;
  readonly evidence: Readonly<Record<RiderPreferenceFeature, number>>;
  readonly explicitComparisons: number;
  readonly implicitComparisons: number;
}

export type PreferenceObservationSource =
  | "explicit-pair"
  | "explicit-like"
  | "route-selected"
  | "free-ride-take";

export interface PairwisePreferenceObservation {
  readonly left: RiderPreferenceVector;
  readonly right: RiderPreferenceVector;
  readonly preferred: "left" | "right";
  readonly source: PreferenceObservationSource;
  /**
   * Relative evidentiary weight. Explicit A/B choices should normally be 1.
   * Behavioral signals should be smaller because accepting a route can be
   * driven by destination, timing or convenience rather than road preference.
   */
  readonly strength?: number;
}

export interface PreferencePrediction {
  /** Probability that the rider prefers left over right. */
  readonly leftProbability: number;
  /** 0 at an even/uncertain choice, 1 near a decisive prediction. */
  readonly confidence: number;
  /** Posterior variance along the pair's differentiating feature direction. */
  readonly uncertainty: number;
  /** How many usable feature dimensions actually distinguish the pair. */
  readonly dimensions: number;
}

export interface PreferenceQuestion<T> {
  readonly left: T;
  readonly right: T;
  readonly prediction: PreferencePrediction;
  /**
   * Higher means the answer is expected to be more informative: uncertain
   * today, but with enough feature separation to teach the model something.
   */
  readonly informationValue: number;
}

export interface PreferenceCandidate<T> {
  readonly item: T;
  readonly features: RiderPreferenceVector;
  /** Stable id used only to break exact ties deterministically. */
  readonly id: string;
}

const DEFAULT_PRIOR_PRECISION = 0.75;
const MIN_PRECISION = 0.05;
const MAX_ABS_WEIGHT = 6;
const MAX_STRENGTH = 2;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteUnit(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const exp = Math.exp(-value);
    return 1 / (1 + exp);
  }
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

function blankNumberRecord(value: number): Record<RiderPreferenceFeature, number> {
  return Object.fromEntries(
    RIDER_PREFERENCE_FEATURES.map((feature) => [feature, value]),
  ) as Record<RiderPreferenceFeature, number>;
}

export function emptyPreferenceVector(): RiderPreferenceVector {
  return Object.fromEntries(
    RIDER_PREFERENCE_FEATURES.map((feature) => [feature, null]),
  ) as Record<RiderPreferenceFeature, null>;
}

export function createRiderPreferenceModel(
  prior: Partial<
    Readonly<Record<RiderPreferenceFeature, { readonly mean?: number; readonly precision?: number }>>
  > = {},
): RiderPreferenceModel {
  const mean = blankNumberRecord(0);
  const precision = blankNumberRecord(DEFAULT_PRIOR_PRECISION);
  const evidence = blankNumberRecord(0);
  for (const feature of RIDER_PREFERENCE_FEATURES) {
    const entry = prior[feature];
    if (entry?.mean !== undefined && Number.isFinite(entry.mean)) {
      mean[feature] = clamp(entry.mean, -MAX_ABS_WEIGHT, MAX_ABS_WEIGHT);
    }
    if (
      entry?.precision !== undefined &&
      Number.isFinite(entry.precision) &&
      entry.precision >= MIN_PRECISION
    ) {
      precision[feature] = entry.precision;
    }
  }
  return {
    version: 1,
    mean,
    precision,
    evidence,
    explicitComparisons: 0,
    implicitComparisons: 0,
  };
}

function deltaFor(
  left: RiderPreferenceVector,
  right: RiderPreferenceVector,
): {
  readonly delta: Record<RiderPreferenceFeature, number>;
  readonly dimensions: number;
} {
  const delta = blankNumberRecord(0);
  let dimensions = 0;
  for (const feature of RIDER_PREFERENCE_FEATURES) {
    const a = finiteUnit(left[feature]);
    const b = finiteUnit(right[feature]);
    // Missing versus known is not a preference difference. Learn only from
    // dimensions that were observed on both roads.
    if (a === null || b === null) continue;
    const difference = a - b;
    if (Math.abs(difference) < 1e-9) continue;
    delta[feature] = difference;
    dimensions += 1;
  }
  return { delta, dimensions };
}

export function predictPairPreference(
  model: RiderPreferenceModel,
  left: RiderPreferenceVector,
  right: RiderPreferenceVector,
): PreferencePrediction {
  const { delta, dimensions } = deltaFor(left, right);
  if (dimensions === 0) {
    return {
      leftProbability: 0.5,
      confidence: 0,
      uncertainty: 0,
      dimensions: 0,
    };
  }

  let latentMean = 0;
  let latentVariance = 0;
  for (const feature of RIDER_PREFERENCE_FEATURES) {
    const d = delta[feature];
    if (d === 0) continue;
    latentMean += model.mean[feature] * d;
    latentVariance += (d * d) / Math.max(MIN_PRECISION, model.precision[feature]);
  }

  // Logistic-Gaussian moment approximation. Posterior uncertainty pulls a
  // prediction back toward 50/50 until the rider has supplied evidence.
  const denominator = Math.sqrt(1 + (Math.PI * latentVariance) / 8);
  const leftProbability = sigmoid(latentMean / denominator);
  return {
    leftProbability,
    confidence: clamp(Math.abs(leftProbability - 0.5) * 2, 0, 1),
    uncertainty: Math.max(0, latentVariance),
    dimensions,
  };
}

function observationStrength(
  source: PreferenceObservationSource,
  requested: number | undefined,
): number {
  const base =
    source === "explicit-pair"
      ? 1
      : source === "explicit-like"
        ? 0.8
        : source === "route-selected"
          ? 0.35
          : 0.25;
  if (requested === undefined || !Number.isFinite(requested)) return base;
  return clamp(requested, 0, MAX_STRENGTH);
}

export function observePairwisePreference(
  model: RiderPreferenceModel,
  observation: PairwisePreferenceObservation,
): RiderPreferenceModel {
  const { delta, dimensions } = deltaFor(observation.left, observation.right);
  if (dimensions === 0) return model;

  const prediction = predictPairPreference(model, observation.left, observation.right);
  const y = observation.preferred === "left" ? 1 : 0;
  const strength = observationStrength(observation.source, observation.strength);
  if (strength <= 0) return model;

  const mean = { ...model.mean };
  const precision = { ...model.precision };
  const evidence = { ...model.evidence };
  const curvature = prediction.leftProbability * (1 - prediction.leftProbability);

  for (const feature of RIDER_PREFERENCE_FEATURES) {
    const d = delta[feature];
    if (d === 0) continue;
    const oldPrecision = Math.max(MIN_PRECISION, precision[feature]);
    const hessian = strength * curvature * d * d;
    const newPrecision = oldPrecision + hessian;
    const gradient = strength * (y - prediction.leftProbability) * d;
    mean[feature] = clamp(
      mean[feature] + gradient / newPrecision,
      -MAX_ABS_WEIGHT,
      MAX_ABS_WEIGHT,
    );
    precision[feature] = newPrecision;
    evidence[feature] += strength * Math.abs(d);
  }

  const explicit =
    observation.source === "explicit-pair" || observation.source === "explicit-like";

  return {
    version: 1,
    mean,
    precision,
    evidence,
    explicitComparisons: model.explicitComparisons + (explicit ? 1 : 0),
    implicitComparisons: model.implicitComparisons + (explicit ? 0 : 1),
  };
}

/** Expected latent utility. Use this only to compare candidates for one rider. */
export function riderPreferenceUtility(
  model: RiderPreferenceModel,
  vector: RiderPreferenceVector,
): number {
  let total = 0;
  for (const feature of RIDER_PREFERENCE_FEATURES) {
    const value = finiteUnit(vector[feature]);
    if (value === null) continue;
    total += model.mean[feature] * value;
  }
  return total;
}

/**
 * Pick the next A/B question by active learning rather than random swiping.
 *
 * Good questions are both uncertain under the current posterior and separated
 * along features whose weights are still uncertain. Obvious or nearly
 * identical pairs are intentionally de-prioritized.
 */
export function selectPreferenceQuestion<T>(
  model: RiderPreferenceModel,
  candidates: readonly PreferenceCandidate<T>[],
): PreferenceQuestion<T> | null {
  let best:
    | {
        readonly left: PreferenceCandidate<T>;
        readonly right: PreferenceCandidate<T>;
        readonly prediction: PreferencePrediction;
        readonly informationValue: number;
      }
    | null = null;

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const left = candidates[i];
      const right = candidates[j];
      if (left === undefined || right === undefined) continue;
      const prediction = predictPairPreference(model, left.features, right.features);
      if (prediction.dimensions === 0 || prediction.uncertainty <= 0) continue;

      // Bernoulli uncertainty peaks at 50/50. Multiplying by posterior variance
      // favors comparisons that can reduce uncertainty on under-learned axes.
      const ambiguity =
        4 * prediction.leftProbability * (1 - prediction.leftProbability);
      const informationValue = ambiguity * Math.sqrt(prediction.uncertainty);
      if (
        best === null ||
        informationValue > best.informationValue + 1e-12 ||
        (
          Math.abs(informationValue - best.informationValue) <= 1e-12 &&
          `${left.id}|${right.id}` < `${best.left.id}|${best.right.id}`
        )
      ) {
        best = { left, right, prediction, informationValue };
      }
    }
  }

  return best === null
    ? null
    : {
        left: best.left.item,
        right: best.right.item,
        prediction: best.prediction,
        informationValue: best.informationValue,
      };
}

export interface PreferenceTeachingPolicy {
  /** Ask at least this many explicit comparisons unless no useful pair exists. */
  readonly minimumQuestions?: number;
  /** Hard cap: preference setup is not an endless swipe feed. */
  readonly maximumQuestions?: number;
  /**
   * After the minimum question count, stop when the best remaining pair falls
   * below this information value.
   */
  readonly minimumInformationValue?: number;
}

export type PreferenceTeachingStep<T> =
  | {
      readonly status: "ask";
      readonly question: PreferenceQuestion<T>;
      readonly questionNumber: number;
      readonly remainingBudget: number;
    }
  | {
      readonly status: "stop";
      readonly reason:
        | "question-budget"
        | "no-informative-pair"
        | "diminishing-information";
    };

const DEFAULT_TEACHING_MINIMUM_QUESTIONS = 4;
const DEFAULT_TEACHING_MAXIMUM_QUESTIONS = 8;
const DEFAULT_TEACHING_MINIMUM_INFORMATION_VALUE = 0.35;

function teachingPolicy(
  policy: PreferenceTeachingPolicy,
): {
  readonly minimumQuestions: number;
  readonly maximumQuestions: number;
  readonly minimumInformationValue: number;
} | null {
  const minimumQuestions =
    policy.minimumQuestions ?? DEFAULT_TEACHING_MINIMUM_QUESTIONS;
  const maximumQuestions =
    policy.maximumQuestions ?? DEFAULT_TEACHING_MAXIMUM_QUESTIONS;
  const minimumInformationValue =
    policy.minimumInformationValue ??
    DEFAULT_TEACHING_MINIMUM_INFORMATION_VALUE;

  if (
    !Number.isSafeInteger(minimumQuestions) ||
    minimumQuestions < 0 ||
    !Number.isSafeInteger(maximumQuestions) ||
    maximumQuestions < 1 ||
    maximumQuestions < minimumQuestions ||
    maximumQuestions > 32 ||
    !Number.isFinite(minimumInformationValue) ||
    minimumInformationValue < 0
  ) {
    return null;
  }

  return {
    minimumQuestions,
    maximumQuestions,
    minimumInformationValue,
  };
}

/**
 * Decides whether Teach OpenGravel should ask another A/B question.
 *
 * The active learner still chooses the pair. This function owns the rider-time
 * budget around it:
 *
 * - never exceed a small hard cap;
 * - ask a short minimum set while cold-start information is available;
 * - after that, stop early when even the best remaining comparison has weak
 *   expected information value.
 *
 * The stop rule depends on explicit comparisons only. Weak behavioral signals
 * can refine the posterior, but accepting routes in normal use never "uses up"
 * the deliberate teaching budget.
 */
export function selectPreferenceTeachingStep<T>(
  model: RiderPreferenceModel,
  candidates: readonly PreferenceCandidate<T>[],
  policy: PreferenceTeachingPolicy = {},
): PreferenceTeachingStep<T> {
  const resolved = teachingPolicy(policy);
  if (resolved === null) {
    return { status: "stop", reason: "question-budget" };
  }

  if (model.explicitComparisons >= resolved.maximumQuestions) {
    return { status: "stop", reason: "question-budget" };
  }

  const question = selectPreferenceQuestion(model, candidates);
  if (question === null) {
    return { status: "stop", reason: "no-informative-pair" };
  }

  if (
    model.explicitComparisons >= resolved.minimumQuestions &&
    question.informationValue < resolved.minimumInformationValue
  ) {
    return { status: "stop", reason: "diminishing-information" };
  }

  return {
    status: "ask",
    question,
    questionNumber: model.explicitComparisons + 1,
    remainingBudget:
      resolved.maximumQuestions - model.explicitComparisons - 1,
  };
}

export function isRiderPreferenceModel(value: unknown): value is RiderPreferenceModel {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<RiderPreferenceModel>;
  if (candidate.version !== 1) return false;
  if (
    typeof candidate.explicitComparisons !== "number" ||
    !Number.isInteger(candidate.explicitComparisons) ||
    candidate.explicitComparisons < 0 ||
    typeof candidate.implicitComparisons !== "number" ||
    !Number.isInteger(candidate.implicitComparisons) ||
    candidate.implicitComparisons < 0
  ) return false;
  for (const record of [candidate.mean, candidate.precision, candidate.evidence]) {
    if (typeof record !== "object" || record === null) return false;
  }
  for (const feature of RIDER_PREFERENCE_FEATURES) {
    const mean = candidate.mean?.[feature];
    const precision = candidate.precision?.[feature];
    const evidence = candidate.evidence?.[feature];
    if (
      typeof mean !== "number" ||
      !Number.isFinite(mean) ||
      Math.abs(mean) > MAX_ABS_WEIGHT ||
      typeof precision !== "number" ||
      !Number.isFinite(precision) ||
      precision < MIN_PRECISION ||
      typeof evidence !== "number" ||
      !Number.isFinite(evidence) ||
      evidence < 0
    ) return false;
  }
  return true;
}
