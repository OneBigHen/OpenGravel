import type { RouteEvidence, RouteScore } from "@/domain/route/types";
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

function unpavedShare(evidence: RouteEvidence | undefined): number | null {
  const value = evidence?.surfaceMix?.value;
  if (typeof value !== "object" || value === null) return null;
  const mix = value as Record<string, unknown>;
  const paved = mix["pavedMeters"];
  const gravel = mix["gravelMeters"];
  const dirt = mix["dirtMeters"];
  if (
    typeof paved !== "number" || !Number.isFinite(paved) || paved < 0 ||
    typeof gravel !== "number" || !Number.isFinite(gravel) || gravel < 0 ||
    typeof dirt !== "number" || !Number.isFinite(dirt) || dirt < 0
  ) return null;
  const known = paved + gravel + dirt;
  return known > 0 ? unit((gravel + dirt) / known) : null;
}

/**
 * Project existing deterministic route facts into rider-learning features.
 *
 * Prefer intrinsic measurements over policy-fit values. In particular surface
 * learning uses measured unpaved share from RouteEvidence, NOT the
 * RouteScore.surfaceFit input (which already depends on today's authored
 * surface preference and would create a feedback loop).
 *
 * The model learns relative weighting over evidence OpenGravel already trusts.
 * It does not invent road facts or replace RoutePolicy. Cost axes are inverted
 * so larger always means "more of this potentially desirable characteristic".
 */
export function preferenceVectorFromRoute(
  score: RouteScore,
  evidence?: RouteEvidence,
): RiderPreferenceVector {
  const vector = emptyPreferenceVector();
  return {
    ...vector,
    curvature: unit(score.components.curvature.input),
    backroad: unit(score.components.backroad.input),
    unpaved: unpavedShare(evidence),
    elevation: unit(score.components.elevation.input),
    trafficCalm: inverse(score.components.traffic.input),
    junctionFlow: inverse(score.components.junctionFriction.input),
    novelty: unit(score.components.novelty.input),
    timeEfficiency: inverse(score.components.timeCost.input),
  };
}
