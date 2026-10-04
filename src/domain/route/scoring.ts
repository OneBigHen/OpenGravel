/**
 * Deterministic candidate scoring (Task 3.1, 03-DOMAIN-MODEL §19,
 * 06-ROUTING-AND-DECISION-ENGINE §9–§10).
 *
 * Ported from the legacy `src/lib/recommendation/route-score.ts`
 * (`OneBigHen/switchback@06785c00e2ad9b51d12b1a4bb6c655ebb0f606c7`), keeping
 * the utility math that maps onto VNext (the piecewise detour penalty, the
 * contiguous/aggregate utility idea, the uncertainty penalty) and the §19
 * component set. Two rules are absolute:
 *
 * 1. **No AI, no clock, no randomness.** The same `(candidate, intent, policy,
 *    evidence)` always produces an identical `RouteScore`, so a score is
 *    reproducible and explainable rather than plausible.
 * 2. **Absence is never a value.** A component whose evidence is missing or
 *    unusable is `input: null`, `evidenceStatus: "unknown"`. Policy blends
 *    quality towards neutral and costs towards caution without inventing a
 *    measurement (03 §18, integrity rule 2).
 *
 * ## Geometry-proxy substitutions (`OGV-D-1xx`)
 *
 * The legacy math read per-road features (curvature, surface, road class,
 * traffic, elevation, novelty) from mapped segments. VNext has no road
 * intelligence yet, so:
 *
 * - `curvature` is measured from the returned line (`smoothedRouteMetrics`,
 *   status `estimated`, provenance recorded by `explanationKey`) — the legacy
 *   `route-candidate.ts` did the same for unscored routes;
 * - `timeCost` is computed from the provider's own durations against the
 *   fastest candidate, a direct port of the legacy piecewise penalty;
 * - `traffic`, `closureRisk`, `backroad`, `surfaceFit`, `elevation`,
 *   `junctionFriction` and `novelty` stay honestly unknown until an evidence
 *   source lands (Wave 7). Since M3 the engine's road attributes supply
 *   `surfaceMix`, `roadClassMix` and `curvature` (OGV-D-263). A usable scalar evidence value switches a component
 *   on without changing this module; the provisional Wave-3 scalar contract is
 *   documented below.
 */

import { isUsableEvidence, type EvidenceStatus } from "../evidence/types";
import { smoothedRouteMetrics } from "../geometry/analysis";
import type { Coordinate, RoadCharacterIntent } from "../ride/types";
import type { PipelineIntent } from "./intent";
import {
  isRoutePolicy,
  PA_NJ_ROUTE_POLICY_VNEXT_1,
  type RoutePolicy,
  type RouteScoreComponentKey,
  type RouteScoreWeights,
} from "./policy";
import {
  type RouteEvidence,
  type RouteEvidenceKey,
  type RouteScore,
  type ScoreComponent,
} from "./types";

/** The candidate facts scoring reads. */
export interface ScorableCandidate {
  readonly geometry: readonly Coordinate[];
  readonly distanceMeters: number;
  readonly durationSeconds: number;
}

export interface CandidateScoringInput {
  readonly candidate: ScorableCandidate;
  readonly intent: PipelineIntent;
  readonly policy: RoutePolicy;
  /**
   * Candidate evidence. Wave 3 supplies only keyed-unknown entries, so components
   * without evidence stay unknown; the parameter exists so a later evidence
   * source changes the input, not this function's shape.
   */
  readonly evidence?: RouteEvidence;
  /**
   * Duration of the fastest eligible candidate, for the detour penalty. Absent
   * means "this candidate is its own baseline" (detour 0), the legacy behavior
   * when no reference was known.
   */
  readonly baselineDurationSeconds?: number;
  /** Optional Protect the Ride term; absent traffic remains unknown, not zero. */
  readonly trafficCost?: TrafficCostSignal | null;
}

export interface TrafficCostSignal {
  readonly normalizedCost: number | null;
  readonly status: EvidenceStatus;
  readonly explanationKey?: string;
  readonly label?: string;
  readonly coverage?: number;
  readonly confidence?: number | null;
}

/** The character used when the rider did not state one (`06 §6`). */
const NEUTRAL_CHARACTER: RoadCharacterIntent = "balanced";

/**
 * Maximum uncertainty penalty, in points. The legacy penalty was bounded at 15;
 * the port keeps the bound and applies it to the declared evidence coverage.
 */
const MAX_UNCERTAINTY_PENALTY = 15;

/** Clamp into `[minimum, maximum]`. */
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** One decimal place, the legacy score rounding. */
function round1(value: number): number {
  return Number(value.toFixed(1));
}

/**
 * Piecewise detour penalty in points (0–100). A detour inside the preferred
 * band costs `detour × 20`; past it the cost ramps quadratically to 48 points,
 * so a small detour stays cheap and a large one dominates (legacy semantics).
 */
export function piecewiseDetourPenalty(
  detourPct: number,
  maximumPct: number,
  preferredDetourPct: number,
): number {
  if (!Number.isFinite(detourPct) || detourPct <= 0) return 0;
  const preferredBand = Math.min(preferredDetourPct, maximumPct);
  if (detourPct <= preferredBand) return clamp(detourPct * 20, 0, 100);
  const ramp = Math.max(0.05, maximumPct - preferredBand);
  const progress = clamp((detourPct - preferredBand) / ramp, 0, 1);
  return clamp(preferredBand * 20 + progress ** 2 * 48, 0, 100);
}

/** Scored evidence axes only; unrelated metadata cannot increase confidence. */
const SCORED_EVIDENCE = {
  curvature: "curvature",
  backroad: "roadClassMix",
  surfaceFit: "surfaceMix",
  elevation: "elevation",
  traffic: "traffic",
  junctionFriction: "urbanFriction",
  novelty: "novelty",
  closureRisk: "closures",
} as const satisfies Partial<Record<RouteScoreComponentKey, RouteEvidenceKey>>;

/** Unknown metres and untrusted observations both leave uncertainty, bounded at 15. */
export function uncertaintyPenalty(
  evidence: RouteEvidence,
  weights: RouteScoreWeights = PA_NJ_ROUTE_POLICY_VNEXT_1.characterWeights.balanced,
): number {
  return (1 - evidenceCoverage(evidence, weights)) * MAX_UNCERTAINTY_PENALTY;
}

/** Mean measured-and-trusted route share, weighted by the active scored axes. */
function evidenceCoverage(
  evidence: RouteEvidence,
  weights: RouteScoreWeights,
  trafficCost?: TrafficCostSignal | null,
): number {
  let measured = 0;
  let total = 0;
  for (const [axis, key] of Object.entries(SCORED_EVIDENCE)) {
    const weight = weights[axis as keyof typeof SCORED_EVIDENCE];
    total += weight;
    const scalar = axis === "traffic" && trafficCost !== undefined && trafficCost !== null
      ? readTrafficSignal(trafficCost) : readUnitScalar(evidence, key);
    measured += weight * scalar.reliability;
  }
  return total > 0 ? measured / total : 0;
}

/** Omitted coverage means route-wide; explicitly unknown trust fails closed. */
function evidenceFraction(value: number | null | undefined): number {
  if (value === undefined) return 1;
  if (value === null || !Number.isFinite(value) || value < 0 || value > 1) return 0;
  return value;
}

/**
 * Provisional Wave-3 scalar evidence contract: a usable `EvidenceValue` whose
 * `value` is a finite number in `[0, 1]` is a normalized measurement. Anything
 * else — a non-numeric value, an out-of-range number — is **not** a
 * measurement, so the component stays unknown. Wave 7 pins richer per-key
 * shapes and replaces this reader.
 */
interface ScalarEvidence {
  readonly value: number | null;
  readonly status: EvidenceStatus;
  readonly reliability: number;
}

function readUnitScalar(
  evidence: RouteEvidence,
  key: RouteEvidenceKey,
): ScalarEvidence {
  const entry = evidence[key];
  if (entry === undefined || !isUsableEvidence(entry)) {
    return { value: null, status: "unknown", reliability: 0 };
  }
  // A structured value (a surface mix, a curvature tally) carries its own
  // normalized reading as `unit`, so the rider-facing detail and the scored
  // number travel together (OGV-D-263).
  const value =
    typeof entry.value === "object" && entry.value !== null && "unit" in entry.value
      ? (entry.value as { readonly unit: unknown }).unit
      : entry.value;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    return { value: null, status: "unknown", reliability: 0 };
  }
  // The reading covers only the measured metres; coverage × confidence then
  // blends it towards the policy prior, so a small gravel patch on a mostly
  // unknown route cannot claim a whole-route match.
  return {
    value,
    status: entry.status,
    reliability: evidenceFraction(entry.coverage) * evidenceFraction(entry.confidence),
  };
}

interface ComponentSpec {
  readonly weight: number;
  readonly input: number | null;
  readonly status: EvidenceStatus;
  readonly explanationKey: string;
  /** A cost axis contributes `weight × (1 - input)`; a quality axis `weight × input`. */
  readonly costAxis: boolean;
  readonly reliability?: number;
}

/**
 * Scores only the novelty component with the active policy math. This is kept
 * separate from `scoreCandidate` so a later local evidence source can update
 * novelty on a server-scored candidate without rebuilding its baseline,
 * traffic, time-cost, eligibility, or any other stored component.
 */
export function scoreNoveltyComponent(input: {
  readonly intent: Pick<PipelineIntent, "roadCharacter" | "noveltyPreference">;
  readonly policy: RoutePolicy;
  readonly evidence: RouteEvidence;
}): ScoreComponent {
  const weights = weightsFor(input.intent, input.policy);
  return input.intent.noveltyPreference === "prefer-familiar"
    ? costComponent("novelty", input.evidence, "novelty", weights)
    : qualityComponent("novelty", input.evidence, "novelty", weights);
}

/**
 * Applies a new novelty measurement to an already-scored candidate. Every
 * unrelated component is retained by identity, and the policy version remains
 * the version that produced the original score.
 */
export function replaceNoveltyScore(input: {
  readonly score: RouteScore;
  readonly evidence: RouteEvidence;
  readonly intent: Pick<PipelineIntent, "roadCharacter" | "noveltyPreference">;
  readonly policy: RoutePolicy;
}): RouteScore {
  if (input.score.policyVersion !== input.policy.version) return input.score;
  const novelty = scoreNoveltyComponent({
    intent: input.intent,
    policy: input.policy,
    evidence: input.evidence,
  });
  return {
    ...input.score,
    total: round1(
      input.score.total - input.score.components.novelty.contribution + novelty.contribution,
    ),
    components: {
      ...input.score.components,
      novelty,
    },
  };
}

function component(spec: ComponentSpec): ScoreComponent {
  // Policy priors affect utility only; input remains the actual measurement.
  // Unknown quality is neutral; unknown cost is maximally cautious, never safe.
  const prior = spec.costAxis ? 1 : 0.5;
  const reliability = spec.input === null ? 0 : spec.reliability ?? 1;
  const effective = prior + reliability * ((spec.input ?? prior) - prior);
  const contribution = spec.weight * (spec.costAxis ? 1 - effective : effective) * 100;
  return {
    input: spec.input,
    weight: spec.weight,
    contribution,
    explanationKey: spec.explanationKey,
    evidenceStatus: spec.status,
  };
}

/** A quality component: usable scalar evidence, else unknown. */
function qualityComponent(
  key: RouteScoreComponentKey,
  evidence: RouteEvidence,
  evidenceKey: RouteEvidenceKey,
  weights: RouteScoreWeights,
): ScoreComponent {
  const scalar = readUnitScalar(evidence, evidenceKey);
  return component({
    weight: weights[key],
    input: scalar.value,
    reliability: scalar.reliability,
    status: scalar.status,
    explanationKey:
      scalar.value === null ? `score.${key}.no-evidence` : `score.${key}.evidence`,
    costAxis: false,
  });
}

/** A cost component: usable scalar evidence is a cost, so it lowers the score. */
function costComponent(
  key: RouteScoreComponentKey,
  evidence: RouteEvidence,
  evidenceKey: RouteEvidenceKey,
  weights: RouteScoreWeights,
): ScoreComponent {
  const scalar = readUnitScalar(evidence, evidenceKey);
  return component({
    weight: weights[key],
    input: scalar.value,
    reliability: scalar.reliability,
    status: scalar.status,
    explanationKey:
      scalar.value === null ? `score.${key}.no-evidence` : `score.${key}.evidence`,
    costAxis: true,
  });
}

/** The traffic override is the scored observation, so confidence uses it too. */
function readTrafficSignal(trafficCost: TrafficCostSignal): ScalarEvidence {
  const normalizedCost = trafficCost.normalizedCost;
  const usable = normalizedCost !== null
    && Number.isFinite(normalizedCost)
    && normalizedCost >= 0
    && normalizedCost <= 1
    && (trafficCost.status === "known" || trafficCost.status === "estimated");
  return {
    value: usable ? normalizedCost : null,
    status: usable ? trafficCost.status : "unknown",
    reliability: usable
      ? evidenceFraction(trafficCost.coverage) * evidenceFraction(trafficCost.confidence) : 0,
  };
}

function trafficComponent(
  evidence: RouteEvidence,
  weights: RouteScoreWeights,
  trafficCost: TrafficCostSignal | null | undefined,
): ScoreComponent {
  if (trafficCost === undefined || trafficCost === null) {
    return costComponent("traffic", evidence, "traffic", weights);
  }
  const scalar = readTrafficSignal(trafficCost);
  return component({
    weight: weights.traffic,
    input: scalar.value,
    reliability: scalar.reliability,
    status: scalar.status,
    explanationKey: scalar.value !== null
      ? trafficCost.explanationKey ?? "score.traffic.evidence"
      : "score.traffic.no-evidence",
    costAxis: true,
  });
}

function weightsFor(intent: PipelineIntent, policy: RoutePolicy): RouteScoreWeights {
  return policy.characterWeights[intent.roadCharacter ?? NEUTRAL_CHARACTER];
}

/**
 * Scores one candidate. Throws a `TypeError` on a policy that is not a valid
 * `RoutePolicy`, so a malformed injected policy fails at the scoring boundary
 * rather than producing plausible numbers (legacy `scoreRoute` behavior).
 */
export function scoreCandidate(input: CandidateScoringInput): RouteScore {
  const policy = input.policy;
  if (!isRoutePolicy(policy)) {
    throw new TypeError("Invalid route policy");
  }
  const evidence = input.evidence ?? {};
  const weights = weightsFor(input.intent, policy);
  const smoothed = smoothedRouteMetrics(input.candidate.geometry);

  const curvatureEvidence = readUnitScalar(evidence, "curvature");
  const curvature = component({
    weight: weights.curvature,
    input:
      curvatureEvidence.value ??
      clamp(smoothed.twistiness / 100, 0, 1),
    reliability: curvatureEvidence.value === null ? 1 : curvatureEvidence.reliability,
    status: curvatureEvidence.value === null ? "estimated" : curvatureEvidence.status,
    explanationKey:
      curvatureEvidence.value === null
        ? "score.curvature.smoothed-geometry-proxy"
        : "score.curvature.evidence",
    costAxis: false,
  });

  const coverage = evidenceCoverage(evidence, weights, input.trafficCost);
  // Coverage is already a policy-weighted confidence metric, not a quality axis.
  const confidence: ScoreComponent = {
    weight: weights.confidence,
    input: coverage > 0 ? coverage : null,
    contribution: weights.confidence * coverage * 100,
    evidenceStatus: coverage > 0 ? "estimated" : "unknown",
    explanationKey:
      coverage > 0 ? "score.confidence.evidence-coverage" : "score.confidence.no-evidence",
  };

  const baseline =
    input.baselineDurationSeconds !== undefined &&
    Number.isFinite(input.baselineDurationSeconds) &&
    input.baselineDurationSeconds > 0
      ? input.baselineDurationSeconds
      : input.candidate.durationSeconds;
  const detourPct =
    baseline > 0
      ? Math.max(0, (input.candidate.durationSeconds - baseline) / baseline)
      : 0;
  // Roles are not assigned yet (Wave 3.3), so the moderate envelope is the
  // scoring reference; it becomes role-specific when roles land (06 §11).
  const maximumPct = policy.roleDetourEnvelopes["fast-and-fun"].maximumPct;
  const detourPenalty = piecewiseDetourPenalty(
    detourPct,
    maximumPct,
    policy.preferredDetourPct,
  );
  const timeCost = component({
    weight: weights.timeCost,
    input: clamp(detourPenalty / 100, 0, 1),
    status: "estimated",
    explanationKey: "score.timeCost.detour-penalty",
    costAxis: true,
  });
  const novelty = scoreNoveltyComponent({
    intent: input.intent,
    policy,
    evidence,
  });

  const components = {
    curvature,
    backroad: qualityComponent("backroad", evidence, "roadClassMix", weights),
    surfaceFit: qualityComponent("surfaceFit", evidence, "surfaceMix", weights),
    elevation: qualityComponent("elevation", evidence, "elevation", weights),
    traffic: trafficComponent(evidence, weights, input.trafficCost),
    junctionFriction: costComponent("junctionFriction", evidence, "urbanFriction", weights),
    novelty,
    closureRisk: costComponent("closureRisk", evidence, "closures", weights),
    timeCost,
    confidence,
  } satisfies RouteScore["components"];

  const total = round1(
    Object.values(components).reduce(
      (sum, entry) => sum + entry.contribution,
      0,
    ),
  );

  return { policyVersion: policy.version, total, components };
}
