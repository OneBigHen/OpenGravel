import type { RouteScore } from "@/domain/route/types";
import {
  emptyPreferenceVector,
  type RiderPreferenceVector,
} from "@/domain/personalization/rider-preference";

function unit(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function inverse(value: number | null | undefined): number | null {
  const normalized = unit(value);
  return normalized === null ? null : 1 - normalized;
}

/**
 * Project the existing deterministic RouteScore into rider-learning features.
 *
 * The model learns *relative weighting* over evidence OpenGravel already trusts.
 * It does not invent new road facts or replace RoutePolicy. Cost axes are
 * inverted so every feature has the same meaning: larger is "more of this
 * potentially desirable thing".
 */
export function preferenceVectorFromRouteScore(
  score: RouteScore,
): RiderPreferenceVector {
  const vector = emptyPreferenceVector();
  return {
    ...vector,
    curvature: unit(score.components.curvature.input),
    backroad: unit(score.components.backroad.input),
    surfaceFit: unit(score.components.surfaceFit.input),
    elevation: unit(score.components.elevation.input),
    trafficCalm: inverse(score.components.traffic.input),
    junctionFlow: inverse(score.components.junctionFriction.input),
    novelty: unit(score.components.novelty.input),
    timeEfficiency: inverse(score.components.timeCost.input),
  };
}
