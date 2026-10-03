/**
 * Measures candidate sets into the common routing experiment scorecard.
 *
 * This is the one entry point every candidate-generator experiment uses:
 *
 *   scoreExperimentCase({ caseId, generator, control, treatment })
 *
 * Each arm is a candidate set plus the id its normal selection path picked and
 * the provider calls it spent. Every candidate is measured the same way:
 * distance/time and the canonical RouteScore as given, sustained bends from the
 * geometry bend detector, and coherence/Ride Arc through the canonical
 * `analyzeRideCoherence()` contract. Unknown stays null.
 *
 * Measurement only: nothing here changes which route production selects.
 */

import { analyzeBends } from "@/domain/geometry/bends";
import type { Coordinate } from "@/domain/ride/types";
import type { RouteInstruction } from "@/domain/route/types";

import {
  analyzeRideCoherence,
  type RideArcWorthwhileJudge,
  type RideCoherenceDiagnostics,
} from "./ride-coherence";
import type { RideArcAnalysisOptions } from "./ride-arc-analysis";
import type { ProviderRoadSummary } from "./route-provider";
import {
  routingExperimentScorecard,
  type BlindedRiderPreference,
  type ExperimentArmId,
  type RoutingExperimentArm,
  type RoutingExperimentCandidateMetrics,
  type RoutingExperimentScorecard,
} from "./routing-experiment-scorecard";

export interface ExperimentCandidateInput {
  readonly id: string;
  /** Hard eligibility from the canonical pipeline. */
  readonly eligible: boolean;
  /** Canonical RouteScore.total, or null when the pipeline produced none. */
  readonly canonicalScore: number | null;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly geometry: readonly Coordinate[];
  readonly instructions?: readonly RouteInstruction[];
  /** Provider road facts; `roadRuns` enable Ride Arc phases. */
  readonly roadSummary?: ProviderRoadSummary;
  /** Requested loop time in seconds; omit/null for destination rides. */
  readonly timeboxSeconds?: number | null;
  /** Canonical per-run worthwhile policy; absent → Ride Arc unavailable. */
  readonly worthwhile?: RideArcWorthwhileJudge;
  readonly arcOptions?: RideArcAnalysisOptions;
  /** Generator-specific proof, when the experiment claimed one. */
  readonly corridorAdherenceShare?: number | null;
  readonly preservedBaselineShare?: number | null;
}

export interface MeasuredExperimentCandidate {
  readonly metrics: RoutingExperimentCandidateMetrics;
  readonly diagnostics: RideCoherenceDiagnostics;
  /** Longest uninterrupted bend run (metres), from the same detector. */
  readonly longestBendRunMeters: number | null;
}

export interface ExperimentArmInput {
  readonly providerCalls: number;
  readonly planningLatencyMs?: number | null;
  readonly candidates: readonly ExperimentCandidateInput[];
  /** Candidate chosen by the arm's normal downstream selection path. */
  readonly selectedCandidateId: string | null;
}

export interface MeasuredExperimentArm {
  readonly arm: RoutingExperimentArm;
  readonly measured: readonly MeasuredExperimentCandidate[];
}

export interface ExperimentCaseInput {
  readonly caseId: string;
  readonly generator: string;
  readonly control: ExperimentArmInput;
  readonly treatment: ExperimentArmInput;
  readonly riderPreference?: BlindedRiderPreference;
}

export interface ExperimentCaseResult {
  readonly scorecard: RoutingExperimentScorecard;
  readonly control: MeasuredExperimentArm;
  readonly treatment: MeasuredExperimentArm;
}

function bendFacts(
  input: ExperimentCandidateInput,
): { readonly share: number | null; readonly longest: number | null } {
  const summary = input.roadSummary;
  if (
    summary?.bendMeters !== undefined &&
    Number.isFinite(summary.bendMeters) &&
    summary.totalMeters > 0
  ) {
    const longest = summary.longestBendRunMeters;
    return {
      share: Math.min(1, Math.max(0, summary.bendMeters) / summary.totalMeters),
      longest: longest !== undefined && Number.isFinite(longest) ? Math.max(0, longest) : null,
    };
  }
  if (input.geometry.length < 3 || !(input.distanceMeters > 0)) {
    return { share: null, longest: null };
  }
  const bends = analyzeBends(input.geometry);
  return {
    share: Math.min(1, bends.bendMeters / input.distanceMeters),
    longest: bends.longestRunMeters,
  };
}

/** Measures one candidate into scorecard metrics plus its full diagnostics. */
export function measureExperimentCandidate(
  input: ExperimentCandidateInput,
): MeasuredExperimentCandidate {
  const diagnostics = analyzeRideCoherence({
    geometry: input.geometry,
    ...(input.instructions === undefined ? {} : { instructions: input.instructions }),
    ...(input.roadSummary === undefined ? {} : { roadSummary: input.roadSummary }),
    ...(input.worthwhile === undefined ? {} : { worthwhile: input.worthwhile }),
    ...(input.arcOptions === undefined ? {} : { arcOptions: input.arcOptions }),
  });
  const bends = bendFacts(input);
  const path = diagnostics.path;
  const timebox =
    input.timeboxSeconds !== undefined &&
    input.timeboxSeconds !== null &&
    Number.isFinite(input.timeboxSeconds) &&
    input.timeboxSeconds > 0
      ? Math.abs(input.durationSeconds - input.timeboxSeconds)
      : null;

  return {
    metrics: {
      id: input.id,
      eligible: input.eligible,
      canonicalScore: input.canonicalScore,
      distanceMeters: input.distanceMeters,
      durationSeconds: input.durationSeconds,
      worthwhileMinuteRatio: diagnostics.arc?.worthwhileMinuteRatio ?? null,
      sustainedBendShare: bends.share,
      maneuversPer10Miles: path?.maneuversPer10Miles ?? null,
      backtrackingShare: path?.backtrackingShare ?? null,
      selfOverlapShare: path?.selfOverlapShare ?? null,
      geometryReversalCount: path?.geometryReversalCount ?? null,
      alternatingShortTurnPairs: path?.alternatingShortTurnPairs ?? null,
      timeboxErrorSeconds: timebox,
      corridorAdherenceShare: input.corridorAdherenceShare ?? null,
      preservedBaselineShare: input.preservedBaselineShare ?? null,
    },
    diagnostics,
    longestBendRunMeters: bends.longest,
  };
}

/** Measures every candidate of one arm. */
export function measureExperimentArm(
  id: ExperimentArmId,
  input: ExperimentArmInput,
): MeasuredExperimentArm {
  const measured = input.candidates.map(measureExperimentCandidate);
  return {
    arm: {
      id,
      providerCalls: input.providerCalls,
      planningLatencyMs: input.planningLatencyMs ?? null,
      candidates: measured.map((candidate) => candidate.metrics),
      selectedCandidateId: input.selectedCandidateId,
    },
    measured,
  };
}

/**
 * Scores one corpus case: control vs treatment candidate sets, same metrics,
 * fairness gate (equal provider calls, eligible selections) from the scorecard.
 */
export function scoreExperimentCase(
  input: ExperimentCaseInput,
): ExperimentCaseResult {
  const control = measureExperimentArm("control", input.control);
  const treatment = measureExperimentArm("treatment", input.treatment);
  return {
    scorecard: routingExperimentScorecard({
      caseId: input.caseId,
      generator: input.generator,
      control: control.arm,
      treatment: treatment.arm,
      ...(input.riderPreference === undefined
        ? {}
        : { riderPreference: input.riderPreference }),
    }),
    control,
    treatment,
  };
}
