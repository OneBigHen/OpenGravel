/**
 * Ride coherence diagnostics: the ONE canonical Ride Arc / coherence contract.
 *
 *   ESCAPE -> CORE RIDE -> RETURN / ARRIVAL
 *
 * Two measurements answer two different questions and are reported side by
 * side, never blended into a score:
 *
 * - `path` (domain/route/coherence.ts, from PR #35): does the line itself ride
 *   like a route? U-turns, reversals, doglegs, maneuver density, immediate
 *   backtracking and self-overlap, from geometry and provider instructions.
 * - `arc` (ride-arc-analysis.ts, from PR #49): where are the escape, the
 *   sustained core and the terminal leg, measured from ORDERED road evidence
 *   (ProviderRoadSummary.roadRuns with GraphHopper edge time, PR #50).
 *
 * Boundaries that make this trustworthy:
 * - The caller supplies the per-run "worthwhile for this ride" judgement from
 *   canonical road policy. This module never decides that a road is good; with
 *   no judge, the arc is reported unavailable rather than guessed.
 * - Unknown stays unknown: missing ordered evidence, missing edge time or a
 *   null judgement are explicit reasons/nulls, never zero or neutral.
 * - Diagnostics only. Nothing here feeds RouteScore, eligibility, roles or the
 *   production winner; experiments read it through the routing scorecard.
 */

import {
  analyzeRouteCoherence,
  type RouteCoherenceMetrics,
} from "@/domain/route/coherence";
import type { Coordinate } from "@/domain/ride/types";
import type { RouteInstruction } from "@/domain/route/types";

import {
  analyzeRideArc,
  type RideArcAnalysis,
  type RideArcAnalysisOptions,
  type RideArcSegment,
} from "./ride-arc-analysis";
import type { ProviderRoadRun, ProviderRoadSummary } from "./route-provider";

export const RIDE_COHERENCE_SCHEMA_VERSION = 1;

/**
 * Canonical-policy judgement of one ordered raw road run for the current ride
 * intent: 0..1, or null when the run's fit cannot be established.
 */
export type RideArcWorthwhileJudge = (
  run: ProviderRoadRun,
  index: number,
) => number | null;

export type RideArcUnavailableReason =
  /** The provider returned no ordered road runs (degraded answer or over cap). */
  | "no-ordered-evidence"
  /** At least one run has no provider edge time, so phase minutes are unknown. */
  | "no-edge-time"
  /** No canonical worthwhile policy was supplied by the caller. */
  | "no-worthwhile-policy"
  /** The analyzer rejected the segments or options. */
  | "malformed";

export interface OrderedEvidenceCoverage {
  readonly runCount: number;
  readonly meters: number;
  /** Metres whose provider edge time is known. */
  readonly timedMeters: number;
  /** timedMeters / meters, 0..1. */
  readonly timedShare: number;
}

export interface RideCoherenceDiagnostics {
  readonly schemaVersion: typeof RIDE_COHERENCE_SCHEMA_VERSION;
  /** Null only for malformed geometry. */
  readonly path: RouteCoherenceMetrics | null;
  /** Null when the provider sent no ordered runs. */
  readonly orderedEvidence: OrderedEvidenceCoverage | null;
  /** Null exactly when `arcUnavailable` names why. */
  readonly arc: RideArcAnalysis | null;
  readonly arcUnavailable: RideArcUnavailableReason | null;
}

export interface RideCoherenceInput {
  readonly geometry: readonly Coordinate[];
  readonly instructions?: readonly RouteInstruction[];
  readonly roadSummary?: ProviderRoadSummary;
  readonly worthwhile?: RideArcWorthwhileJudge;
  readonly arcOptions?: RideArcAnalysisOptions;
}

function orderedEvidenceCoverage(
  runs: readonly ProviderRoadRun[],
): OrderedEvidenceCoverage {
  let meters = 0;
  let timedMeters = 0;
  for (const run of runs) {
    const runMeters = Number.isFinite(run.meters) && run.meters > 0 ? run.meters : 0;
    meters += runMeters;
    if (run.durationSeconds !== null && Number.isFinite(run.durationSeconds)) {
      timedMeters += runMeters;
    }
  }
  return {
    runCount: runs.length,
    meters,
    timedMeters,
    timedShare: meters > 0 ? timedMeters / meters : 0,
  };
}

/**
 * Projects ordered raw road runs into Ride Arc segments with the caller's
 * canonical worthwhile judgement.
 *
 * Returns null when any run lacks provider edge time: phase minutes cannot be
 * honest with a hole in the clock. Runs with zero metres and zero time carry
 * no ride time and are skipped.
 */
export function rideArcSegmentsFromRoadRuns(
  runs: readonly ProviderRoadRun[],
  worthwhile: RideArcWorthwhileJudge,
): readonly RideArcSegment[] | null {
  const segments: RideArcSegment[] = [];
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index]!;
    if (run.durationSeconds === null || !Number.isFinite(run.durationSeconds)) {
      return null;
    }
    if (!(run.durationSeconds > 0)) continue;
    const judged = worthwhile(run, index);
    segments.push({
      id: `run-${index}`,
      distanceMeters: Number.isFinite(run.meters) && run.meters > 0 ? run.meters : 0,
      durationSeconds: run.durationSeconds,
      worthwhile:
        judged === null || !Number.isFinite(judged) || judged < 0 || judged > 1
          ? null
          : judged,
    });
  }
  return segments;
}

/**
 * The canonical diagnostic for one route candidate. Pure and deterministic.
 */
export function analyzeRideCoherence(
  input: RideCoherenceInput,
): RideCoherenceDiagnostics {
  const path = analyzeRouteCoherence({
    geometry: input.geometry,
    ...(input.instructions === undefined ? {} : { instructions: input.instructions }),
  });
  const runs = input.roadSummary?.roadRuns;
  const orderedEvidence =
    runs === undefined || runs.length === 0 ? null : orderedEvidenceCoverage(runs);

  const unavailable = (
    reason: RideArcUnavailableReason,
  ): RideCoherenceDiagnostics => ({
    schemaVersion: RIDE_COHERENCE_SCHEMA_VERSION,
    path,
    orderedEvidence,
    arc: null,
    arcUnavailable: reason,
  });

  if (runs === undefined || runs.length === 0) return unavailable("no-ordered-evidence");
  if (input.worthwhile === undefined) return unavailable("no-worthwhile-policy");
  const segments = rideArcSegmentsFromRoadRuns(runs, input.worthwhile);
  if (segments === null) return unavailable("no-edge-time");
  const arc = analyzeRideArc(segments, input.arcOptions);
  if (arc === null) return unavailable("malformed");
  return {
    schemaVersion: RIDE_COHERENCE_SCHEMA_VERSION,
    path,
    orderedEvidence,
    arc,
    arcUnavailable: null,
  };
}
