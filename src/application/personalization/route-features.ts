import type { RouteEvidence, RouteScore } from "@/domain/route/types";
import { isUsableEvidence } from "@/domain/evidence/types";
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

function usableComponentInput(
  component: RouteScore["components"][keyof RouteScore["components"]],
): number | null {
  if (component.evidenceStatus !== "known" && component.evidenceStatus !== "estimated") {
    return null;
  }
  return unit(component.input);
}

function unpavedShare(evidence: RouteEvidence | undefined): number | null {
  const surfaceMix = evidence?.surfaceMix;
  if (surfaceMix === undefined || !isUsableEvidence(surfaceMix)) return null;

  const value = surfaceMix.value;
  if (typeof value !== "object" || value === null) return null;
  const mix = value as Record<string, unknown>;
  const paved = mix["pavedMeters"];
  const gravel = mix["gravelMeters"];
  const dirt = mix["dirtMeters"];
  const unknown = mix["unknownMeters"];
  if (
    typeof paved !== "number" || !Number.isFinite(paved) || paved < 0 ||
    typeof gravel !== "number" || !Number.isFinite(gravel) || gravel < 0 ||
    typeof dirt !== "number" || !Number.isFinite(dirt) || dirt < 0 ||
    typeof unknown !== "number" || !Number.isFinite(unknown) || unknown !== 0
  ) return null;
  if (
    surfaceMix.coverage !== undefined &&
    (typeof surfaceMix.coverage !== "number" || !Number.isFinite(surfaceMix.coverage) || surfaceMix.coverage !== 1)
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
    curvature: usableComponentInput(score.components.curvature),
    backroad: usableComponentInput(score.components.backroad),
    unpaved: unpavedShare(evidence),
    elevation: usableComponentInput(score.components.elevation),
    trafficCalm: inverse(usableComponentInput(score.components.traffic)),
    junctionFlow: inverse(usableComponentInput(score.components.junctionFriction)),
    novelty: usableComponentInput(score.components.novelty),
    timeEfficiency: inverse(usableComponentInput(score.components.timeCost)),
  };
}
