/**
 * Deterministic recreational-route ("fun") assessment.
 *
 * This module is intentionally separate from hard eligibility and the primary
 * RouteScore. It answers a narrower question: given already-normalized route
 * evidence, how much recreational ride character does a candidate appear to
 * have? It never makes access/safety decisions and it never calls an AI model.
 *
 * The first policy is explicitly experimental. Missing evidence stays missing:
 * absent features are removed from the weighted numerator/denominator and
 * reduce coverage. A candidate cannot be classified as fun until enough of the
 * weighted feature space is measured.
 */

import { isUsableEvidence } from "../evidence/types";
import { deepFreeze } from "../util/freeze";
import type { RouteEvidence, RouteScore } from "./types";

export const FUN_FEATURE_KEYS = [
  "curvature",
  "backroad",
  "surfaceFit",
  "elevation",
  "trafficFlow",
  "junctionFlow",
  "novelty",
  "speedCharacterFit",
  "signalFlow",
  "mappedGravelAffinity",
] as const;

export type FunFeatureKey = (typeof FUN_FEATURE_KEYS)[number];

export type FunFeatureVector = Readonly<Record<FunFeatureKey, number | null>>;

export type FunClassification = "fun" | "mixed" | "not-fun" | "unknown";

export interface FunSignalOverrides {
  /**
   * How closely the route's expected/legal speed character matches the selected
   * recreational policy. This is not "higher speed is better".
   */
  readonly speedCharacterFit?: number | null;
  /** 1 means free-flowing; 0 means dominated by signals/stops. */
  readonly signalFlow?: number | null;
  /**
   * Affinity with mapped/known gravel-route evidence. This is an attraction
   * prior, never proof of access or surface.
   */
  readonly mappedGravelAffinity?: number | null;
}

export interface FunPolicy {
  readonly version: string;
  readonly weights: Readonly<Record<FunFeatureKey, number>>;
  /** Minimum share of weighted features required for a semantic classification. */
  readonly minimumCoverage: number;
  readonly mixedThreshold: number;
  readonly funThreshold: number;
  /** Maximum proportional reduction for low-confidence evidence. */
  readonly uncertaintyScale: number;
}

/**
 * Seed policy for shadow evaluation in PA/NJ. These weights are hypotheses, not
 * learned truths; change them only by creating a new version and running the
 * regression corpus.
 */
export const PA_NJ_FUN_POLICY_VNEXT_1: FunPolicy = deepFreeze({
  version: "PA_NJ_FUN_POLICY_VNEXT_1",
  weights: {
    curvature: 0.30,
    backroad: 0.16,
    surfaceFit: 0.14,
    elevation: 0.02,
    trafficFlow: 0.10,
    junctionFlow: 0.10,
    novelty: 0.01,
    speedCharacterFit: 0.07,
    signalFlow: 0.05,
    mappedGravelAffinity: 0.05,
  },
  minimumCoverage: 0.35,
  mixedThreshold: 0.52,
  funThreshold: 0.66,
  uncertaintyScale: 0.25,
});

export interface FunReason {
  readonly key: string;
  readonly impact: "positive" | "negative";
  readonly magnitude: number;
}

export interface FunAssessment {
  readonly policyVersion: string;
  /** Confidence-adjusted 0..1 score used for comparison. */
  readonly score: number;
  /** Weighted 0..1 score before the confidence penalty. */
  readonly rawScore: number;
  /** Share of the policy's weighted feature space that was measured. */
  readonly coverage: number;
  readonly classification: FunClassification;
  readonly features: FunFeatureVector;
  readonly reasons: readonly FunReason[];
}

export interface FunCandidate<Id extends string | number = string> {
  readonly id: Id;
  readonly durationSeconds: number;
  readonly distanceMeters: number;
  readonly score: RouteScore;
  readonly funSignals?: FunSignalOverrides;
}

export interface FunSelection<Id extends string | number = string> {
  readonly id: Id;
  readonly assessment: FunAssessment;
  readonly detourPct: number;
}

const EPSILON = 1e-9;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function unitOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function inverseCost(value: number | null): number | null {
  return value === null ? null : 1 - value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Converts OpenGravel's existing verifiedGravel evidence into the fun model's
 * mapped-gravel affinity. The signal is deliberately conservative: it is the
 * verified share of the route multiplied by the corridor evidence confidence.
 *
 * No evidence, unusable evidence, missing confidence, or invalid distances stay
 * unknown rather than becoming a zero-quality route.
 */
export function mappedGravelAffinityFromEvidence(
  evidence: RouteEvidence,
  routeDistanceMeters: number,
): number | null {
  if (!Number.isFinite(routeDistanceMeters) || routeDistanceMeters <= 0) return null;
  const gravel = evidence["verifiedGravel"];
  if (gravel === undefined || !isUsableEvidence(gravel)) return null;
  if (!isRecord(gravel.value)) return null;

  const meters = gravel.value["meters"];
  if (typeof meters !== "number" || !Number.isFinite(meters) || meters < 0) return null;
  const confidence = unitOrNull(gravel.confidence);
  if (confidence === null) return null;

  const verifiedShare = clamp01(meters / routeDistanceMeters);
  return Number((verifiedShare * confidence).toFixed(4));
}

/**
 * Projects the existing deterministic RouteScore into fun-oriented qualities.
 * Cost axes become quality axes (low traffic cost -> high traffic flow).
 */
export function funFeaturesFromRouteScore(
  score: RouteScore,
  overrides: FunSignalOverrides = {},
): FunFeatureVector {
  const components = score.components;
  return {
    curvature: unitOrNull(components.curvature.input),
    backroad: unitOrNull(components.backroad.input),
    surfaceFit: unitOrNull(components.surfaceFit.input),
    elevation: unitOrNull(components.elevation.input),
    trafficFlow: inverseCost(unitOrNull(components.traffic.input)),
    junctionFlow: inverseCost(unitOrNull(components.junctionFriction.input)),
    novelty: unitOrNull(components.novelty.input),
    speedCharacterFit: unitOrNull(overrides.speedCharacterFit),
    signalFlow: unitOrNull(overrides.signalFlow),
    mappedGravelAffinity: unitOrNull(overrides.mappedGravelAffinity),
  };
}

function weightTotal(policy: FunPolicy): number {
  return FUN_FEATURE_KEYS.reduce((sum, key) => sum + policy.weights[key], 0);
}

function explanationReasons(
  features: FunFeatureVector,
  policy: FunPolicy,
): readonly FunReason[] {
  const reasons: FunReason[] = [];

  const positive = (
    feature: FunFeatureKey,
    key: string,
    minimum = 0.6,
  ): void => {
    const value = features[feature];
    if (value === null || value < minimum) return;
    reasons.push({
      key,
      impact: "positive",
      magnitude: policy.weights[feature] * value,
    });
  };

  const negative = (
    feature: FunFeatureKey,
    key: string,
    maximum = 0.4,
  ): void => {
    const value = features[feature];
    if (value === null || value > maximum) return;
    reasons.push({
      key,
      impact: "negative",
      magnitude: policy.weights[feature] * (1 - value),
    });
  };

  positive("curvature", "fun.curvature");
  positive("backroad", "fun.backroads");
  positive("surfaceFit", "fun.surface-fit", 0.5);
  positive("speedCharacterFit", "fun.speed-character");
  positive("mappedGravelAffinity", "fun.mapped-gravel", 0.5);
  positive("elevation", "fun.terrain", 0.65);
  positive("novelty", "fun.novelty", 0.65);

  negative("trafficFlow", "fun.traffic-friction");
  negative("junctionFlow", "fun.junction-friction");
  negative("signalFlow", "fun.signal-friction");

  return reasons
    .sort((left, right) => {
      if (left.magnitude !== right.magnitude) return right.magnitude - left.magnitude;
      return compareStableText(left.key, right.key);
    });
}

export function assessRouteFun(
  score: RouteScore,
  overrides: FunSignalOverrides = {},
  policy: FunPolicy = PA_NJ_FUN_POLICY_VNEXT_1,
): FunAssessment {
  const features = funFeaturesFromRouteScore(score, overrides);
  const totalWeight = weightTotal(policy);
  let knownWeight = 0;
  let weighted = 0;

  for (const key of FUN_FEATURE_KEYS) {
    const value = features[key];
    if (value === null) continue;
    const weight = policy.weights[key];
    knownWeight += weight;
    weighted += weight * value;
  }

  const coverage = totalWeight > 0 ? clamp01(knownWeight / totalWeight) : 0;
  const rawScore = knownWeight > 0 ? clamp01(weighted / knownWeight) : 0;

  // RouteScore.confidence is evidence coverage over the wider route model. When
  // it is absent, this fun-specific coverage is the most honest fallback.
  const routeConfidence = unitOrNull(score.components.confidence.input);
  const confidence = routeConfidence ?? coverage;
  const penalty = policy.uncertaintyScale * (1 - confidence);
  const adjusted = clamp01(rawScore * (1 - penalty));

  let classification: FunClassification = "unknown";
  if (coverage + EPSILON >= policy.minimumCoverage) {
    classification = adjusted >= policy.funThreshold
      ? "fun"
      : adjusted >= policy.mixedThreshold
        ? "mixed"
        : "not-fun";
  }

  return {
    policyVersion: policy.version,
    score: Number(adjusted.toFixed(4)),
    rawScore: Number(rawScore.toFixed(4)),
    coverage: Number(coverage.toFixed(4)),
    classification,
    features,
    reasons: explanationReasons(features, policy),
  };
}

/** Binary adapter for consumers that truly need yes/no; null means unknown. */
export function isFunRoute(assessment: FunAssessment): boolean | null {
  if (assessment.classification === "unknown") return null;
  return assessment.classification === "fun";
}

function compareStableText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableId(left: string | number, right: string | number): number {
  return compareStableText(String(left), String(right));
}

/**
 * Selects the highest fun score inside a hard time-detour envelope. This is the
 * intended first-generation decision rule: time is a constraint, not another
 * hidden term inside the fun score.
 *
 * Unknown and not-fun candidates do not win by default. That keeps sparse
 * evidence from being interpreted as positive evidence.
 */
export function selectFunWithinDetour<Id extends string | number>(
  candidates: readonly FunCandidate<Id>[],
  maximumDetourPct: number,
  policy: FunPolicy = PA_NJ_FUN_POLICY_VNEXT_1,
): FunSelection<Id> | null {
  if (candidates.length === 0) return null;
  if (!Number.isFinite(maximumDetourPct) || maximumDetourPct < 0) return null;

  const measurable = candidates.filter(
    (candidate) => Number.isFinite(candidate.durationSeconds) && candidate.durationSeconds > 0,
  );
  if (measurable.length === 0) return null;

  const fastest = measurable.reduce((best, candidate) => {
    if (candidate.durationSeconds !== best.durationSeconds) {
      return candidate.durationSeconds < best.durationSeconds ? candidate : best;
    }
    if (candidate.distanceMeters !== best.distanceMeters) {
      return candidate.distanceMeters < best.distanceMeters ? candidate : best;
    }
    return stableId(candidate.id, best.id) < 0 ? candidate : best;
  });

  const eligible: Array<{
    readonly candidate: FunCandidate<Id>;
    readonly assessment: FunAssessment;
    readonly detourPct: number;
  }> = [];

  for (const candidate of measurable) {
    const detourPct =
      (candidate.durationSeconds - fastest.durationSeconds) / fastest.durationSeconds;
    if (detourPct > maximumDetourPct + EPSILON) continue;

    const assessment = assessRouteFun(candidate.score, candidate.funSignals, policy);
    if (
      assessment.classification === "unknown" ||
      assessment.classification === "not-fun"
    ) {
      continue;
    }
    eligible.push({ candidate, assessment, detourPct });
  }

  eligible.sort((left, right) => {
    if (left.assessment.score !== right.assessment.score) {
      return right.assessment.score - left.assessment.score;
    }
    if (left.assessment.coverage !== right.assessment.coverage) {
      return right.assessment.coverage - left.assessment.coverage;
    }
    if (left.candidate.durationSeconds !== right.candidate.durationSeconds) {
      return left.candidate.durationSeconds - right.candidate.durationSeconds;
    }
    if (left.candidate.distanceMeters !== right.candidate.distanceMeters) {
      return left.candidate.distanceMeters - right.candidate.distanceMeters;
    }
    return stableId(left.candidate.id, right.candidate.id);
  });

  const winner = eligible[0];
  return winner === undefined
    ? null
    : {
        id: winner.candidate.id,
        assessment: winner.assessment,
        detourPct: Number(winner.detourPct.toFixed(4)),
      };
}
