/**
 * Provider-neutral FUN JUDGE port.
 *
 * A judge compares two or three routes that OpenGravel has ALREADY made
 * eligible, scored and bounded (time/detour budget, legality, closures,
 * access). It sees only aggregate, OpenGravel-computed evidence and answers a
 * preference distribution. It never sees geometry, never decides legality,
 * access, closures or eligibility, and never does time arithmetic: every
 * duration/detour figure is precomputed here.
 *
 * Infrastructure implements this with the Jev model today; a replay fixture or
 * another model can implement it without touching routing or domain code.
 */

import type { RoadCharacterIntent, SurfaceIntent } from "@/domain/ride/types";

/** A judge compares at most three routes per request (product shows three). */
export const FUN_JUDGE_MAX_CANDIDATES = 3;
export const FUN_JUDGE_MIN_CANDIDATES = 2;

export interface FunJudgeIntent {
  readonly roadCharacter: RoadCharacterIntent;
  readonly surfacePreference: SurfaceIntent["preference"];
  readonly avoidHighways: boolean;
}

/**
 * Escape → Core Ride → Return summary. Supplied by the Ride Arc analyzer once
 * it lands (foundations lane, PR #49); `null` until then. Shares are 0..1 of
 * route distance; `coreQuality` is the analyzer's own 0..1 core score.
 */
export interface FunJudgeRideArcSummary {
  readonly escapeShare: number;
  readonly coreShare: number;
  readonly returnShare: number;
  readonly coreQuality: number | null;
}

/**
 * Aggregate evidence for ONE already-eligible candidate. Every 0..1 value is
 * "more of this quality is larger"; `null` means unmeasured and is never a
 * zero. `key` is a local opaque handle (it is never sent to the model).
 */
export interface FunJudgeCandidateEvidence {
  readonly key: string;
  readonly durationMinutes: number;
  readonly distanceMiles: number;
  /** Added time versus the fastest eligible candidate, 0.12 = 12% longer. */
  readonly addedTimePct: number;
  readonly curvature: number | null;
  /** Sustained-curve continuity (foundations lane, PR #38); `null` until supplied. */
  readonly curvatureContinuity: number | null;
  readonly backroadShare: number | null;
  readonly surfaceFit: number | null;
  readonly elevation: number | null;
  /** 1 = free-flowing; inverse of traffic friction. */
  readonly trafficFlow: number | null;
  /** 1 = few junction interruptions; inverse of junction friction. */
  readonly junctionFlow: number | null;
  readonly novelty: number | null;
  readonly mappedGravelAffinity: number | null;
  readonly maneuversPer10Miles: number | null;
  readonly rideArc: FunJudgeRideArcSummary | null;
  /** Share of the fun feature space that was measured (0..1). */
  readonly evidenceCoverage: number;
}

export interface FunJudgeRequest {
  readonly intent: FunJudgeIntent;
  /** 2..3 candidates, in the order the judge should present them. */
  readonly candidates: readonly FunJudgeCandidateEvidence[];
}

export type FunJudgeUnavailableReason =
  | "disabled"
  | "invalid-request"
  | "timeout"
  | "aborted"
  | "transport-error"
  | "invalid-response";

export type FunJudgeAnswer =
  | {
      readonly status: "ok";
      /** Candidate key → probability that it is the most fun fit; keys of the request only. */
      readonly probabilities: Readonly<Record<string, number>>;
      /** Probability that the evidence supports no meaningful preference. */
      readonly noneProbability: number;
      /** The judge's own argmax: a request key, or `null` for "no preference". */
      readonly choiceKey: string | null;
      readonly confidence: number;
      /** The provider-reported model identity, already checked against the pin. */
      readonly model: string;
      readonly latencyMs: number;
    }
  | {
      readonly status: "unavailable";
      readonly reason: FunJudgeUnavailableReason;
      readonly latencyMs: number;
      /** Sanitized numeric HTTP status only; provider bodies never leave the adapter. */
      readonly httpStatus?: number;
    };

export interface FunJudgePort {
  /** The pinned model identity this port requests; part of every cache key. */
  readonly modelId: string;
  rank(request: FunJudgeRequest, signal: AbortSignal): Promise<FunJudgeAnswer>;
}

/** What a judge may send for one candidate: rounded aggregates, never the key. */
export interface FunJudgeProjectedEvidence {
  readonly durationMinutes: number;
  readonly distanceMiles: number;
  readonly addedTimePct: number;
  readonly curvature: number | null;
  readonly curvatureContinuity: number | null;
  readonly backroadShare: number | null;
  readonly surfaceFit: number | null;
  readonly elevation: number | null;
  readonly trafficFlow: number | null;
  readonly junctionFlow: number | null;
  readonly novelty: number | null;
  readonly mappedGravelAffinity: number | null;
  readonly maneuversPer10Miles: number | null;
  readonly rideArc: FunJudgeRideArcSummary | null;
  readonly evidenceCoverage: number;
}

function fixed(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}
function fixedOrNull(value: number | null, digits: number): number | null {
  return value === null ? null : fixed(value, digits);
}

/**
 * The single projection every adapter uses, at the same precision as the
 * service's evidence fingerprint, so a cache hit always means "the model
 * would have seen exactly this".
 */
export function projectFunJudgeEvidence(
  candidate: FunJudgeCandidateEvidence,
): FunJudgeProjectedEvidence {
  return {
    durationMinutes: fixed(candidate.durationMinutes, 1),
    distanceMiles: fixed(candidate.distanceMiles, 1),
    addedTimePct: fixed(candidate.addedTimePct, 3),
    curvature: fixedOrNull(candidate.curvature, 3),
    curvatureContinuity: fixedOrNull(candidate.curvatureContinuity, 3),
    backroadShare: fixedOrNull(candidate.backroadShare, 3),
    surfaceFit: fixedOrNull(candidate.surfaceFit, 3),
    elevation: fixedOrNull(candidate.elevation, 3),
    trafficFlow: fixedOrNull(candidate.trafficFlow, 3),
    junctionFlow: fixedOrNull(candidate.junctionFlow, 3),
    novelty: fixedOrNull(candidate.novelty, 3),
    mappedGravelAffinity: fixedOrNull(candidate.mappedGravelAffinity, 3),
    maneuversPer10Miles: fixedOrNull(candidate.maneuversPer10Miles, 1),
    rideArc: candidate.rideArc === null
      ? null
      : {
          escapeShare: fixed(candidate.rideArc.escapeShare, 3),
          coreShare: fixed(candidate.rideArc.coreShare, 3),
          returnShare: fixed(candidate.rideArc.returnShare, 3),
          coreQuality: fixedOrNull(candidate.rideArc.coreQuality, 3),
        },
    evidenceCoverage: fixed(candidate.evidenceCoverage, 3),
  };
}
