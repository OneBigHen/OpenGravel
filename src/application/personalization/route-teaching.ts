/**
 * Real-route teaching adapter for the local rider preference model.
 *
 * The preference learner should never ask abstract questions like
 * "curvy or scenic?" when OpenGravel already has real eligible alternatives.
 * This adapter projects those measured route candidates into the existing
 * active-learning model and records an explicit A/B answer.
 *
 * It does not fetch, route, render maps or persist state.
 */

import {
  RIDER_PREFERENCE_FEATURES,
  observePairwisePreference,
  selectPreferenceTeachingStep,
  type PreferenceTeachingPolicy,
  type PreferenceTeachingStep,
  type RiderPreferenceModel,
  type RiderPreferenceVector,
} from "@/domain/personalization/rider-preference";
import type {
  RouteEvidence,
  RouteScore,
} from "@/domain/route/types";

import { preferenceVectorFromRoute } from "./route-features";

export interface RouteTeachingCandidate<T = unknown> {
  readonly id: string;
  readonly score: RouteScore;
  readonly evidence?: RouteEvidence;
  /** Caller-owned payload, normally the route candidate/preview itself. */
  readonly item: T;
}

export interface RouteTeachingItem<T = unknown> {
  readonly id: string;
  readonly item: T;
  readonly features: RiderPreferenceVector;
  readonly knownDimensions: number;
}

export type RoutePreferenceTeachingStep<T = unknown> =
  PreferenceTeachingStep<RouteTeachingItem<T>>;

function knownDimensions(vector: RiderPreferenceVector): number {
  return RIDER_PREFERENCE_FEATURES.reduce(
    (count, feature) =>
      vector[feature] !== null ? count + 1 : count,
    0,
  );
}

function teachingItem<T>(
  candidate: RouteTeachingCandidate<T>,
): RouteTeachingItem<T> | null {
  if (candidate.id.trim().length === 0) return null;
  const features = preferenceVectorFromRoute(
    candidate.score,
    candidate.evidence,
  );
  const dimensions = knownDimensions(features);

  // One known scalar cannot teach a useful rider character. Requiring at least
  // two known dimensions keeps cold-start questions about real trade-offs.
  if (dimensions < 2) return null;

  return {
    id: candidate.id,
    item: candidate.item,
    features,
    knownDimensions: dimensions,
  };
}

/**
 * Chooses the next deliberate teaching comparison from real planned routes.
 *
 * The active learner still owns pair selection and the question budget. This
 * adapter only ensures the pool contains route-grounded, sufficiently measured
 * candidates instead of synthetic preference cards.
 */
export function selectRoutePreferenceTeachingStep<T>(
  model: RiderPreferenceModel,
  candidates: readonly RouteTeachingCandidate<T>[],
  policy: PreferenceTeachingPolicy = {},
): RoutePreferenceTeachingStep<T> {
  const items = candidates
    .map(teachingItem)
    .filter(
      (item): item is RouteTeachingItem<T> => item !== null,
    );

  return selectPreferenceTeachingStep(
    model,
    items.map((item) => ({
      id: item.id,
      item,
      features: item.features,
    })),
    policy,
  );
}

/**
 * Applies one explicit answer from a route-grounded teaching question.
 *
 * Strength is fixed to 1 because this is an intentional A/B answer, unlike
 * weak behavioral observations such as merely selecting a route.
 */
export function observeRoutePreferenceTeachingChoice<T>(
  model: RiderPreferenceModel,
  question: Extract<
    RoutePreferenceTeachingStep<T>,
    { readonly status: "ask" }
  >["question"],
  preferred: "left" | "right",
): RiderPreferenceModel {
  return observePairwisePreference(model, {
    left: question.left.features,
    right: question.right.features,
    preferred,
    source: "explicit-pair",
    strength: 1,
  });
}
