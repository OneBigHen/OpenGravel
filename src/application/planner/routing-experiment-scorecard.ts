/**
 * Common scorecard for routing experiments.
 *
 * Every candidate generator should be judged on the same rider-relevant facts.
 * This module deliberately does not calculate another route score. It compares
 * measurements that other OpenGravel authorities already produced:
 *
 * - provider-call budget / latency;
 * - hard eligibility;
 * - canonical deterministic RouteScore;
 * - worthwhile/core-riding share;
 * - curve continuity;
 * - maneuver/repetition coherence;
 * - timebox accuracy;
 * - corridor/rejoin adherence when the experiment claimed one;
 * - blinded rider preference when available.
 *
 * Unknown stays null. A missing metric never becomes neutral or "good enough".
 */

export type ExperimentArmId = "control" | "treatment";

export interface RoutingExperimentCandidateMetrics {
  readonly id: string;
  readonly eligible: boolean;
  /** Canonical OpenGravel RouteScore.total, when the pipeline produced one. */
  readonly canonicalScore: number | null;
  readonly distanceMeters: number;
  readonly durationSeconds: number;

  /** Estimated share of total riding time spent in worthwhile/core sections. */
  readonly worthwhileMinuteRatio?: number | null;

  /** Share of distance in sustained bend runs rather than isolated corners. */
  readonly sustainedBendShare?: number | null;

  /** Instruction workload, when provider instructions were available. */
  readonly maneuversPer10Miles?: number | null;
  readonly backtrackingShare?: number | null;
  readonly selfOverlapShare?: number | null;
  readonly geometryReversalCount?: number | null;
  readonly alternatingShortTurnPairs?: number | null;

  /** Absolute miss from a requested loop/timebox, in seconds. */
  readonly timeboxErrorSeconds?: number | null;

  /** Generator-specific proof that the promised source corridor was recovered. */
  readonly corridorAdherenceShare?: number | null;

  /**
   * Departure/rejoin experiments: share of the baseline outside the replaced
   * middle that survived the treatment.
   */
  readonly preservedBaselineShare?: number | null;
}

export interface RoutingExperimentArm {
  readonly id: ExperimentArmId;
  /** Total provider calls consumed by this arm. */
  readonly providerCalls: number;
  /** Wall-clock planning latency for the arm, when measured. */
  readonly planningLatencyMs?: number | null;
  readonly candidates: readonly RoutingExperimentCandidateMetrics[];
  /** Candidate selected by the arm's normal downstream selection path. */
  readonly selectedCandidateId: string | null;
}

export type BlindedRiderPreference =
  | "control"
  | "treatment"
  | "tie"
  | "not-rated";

export interface RoutingExperimentTrial {
  readonly caseId: string;
  readonly generator: string;
  readonly control: RoutingExperimentArm;
  readonly treatment: RoutingExperimentArm;
  readonly riderPreference?: BlindedRiderPreference;
}

export interface RoutingExperimentDelta {
  /** treatment - control; positive means the treatment took longer. */
  readonly durationSeconds: number;
  readonly distanceMeters: number;
  readonly canonicalScore: number | null;
  readonly worthwhileMinuteRatio: number | null;
  readonly sustainedBendShare: number | null;
  readonly maneuversPer10Miles: number | null;
  readonly backtrackingShare: number | null;
  readonly selfOverlapShare: number | null;
  readonly timeboxErrorSeconds: number | null;
  readonly planningLatencyMs: number | null;
}

export type RoutingExperimentValidityReason =
  | "valid"
  | "call-budget-mismatch"
  | "control-selection-missing"
  | "treatment-selection-missing"
  | "control-ineligible"
  | "treatment-ineligible";

export interface RoutingExperimentScorecard {
  readonly caseId: string;
  readonly generator: string;
  readonly equalProviderCallBudget: boolean;
  readonly validity: RoutingExperimentValidityReason;
  readonly control: RoutingExperimentCandidateMetrics | null;
  readonly treatment: RoutingExperimentCandidateMetrics | null;
  readonly delta: RoutingExperimentDelta | null;
  readonly treatmentCorridorAdherenceShare: number | null;
  readonly treatmentPreservedBaselineShare: number | null;
  readonly riderPreference: BlindedRiderPreference;
}

function finite(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value)
    ? value
    : null;
}

function unit(value: number | null | undefined): number | null {
  const numeric = finite(value);
  return numeric !== null && numeric >= 0 && numeric <= 1
    ? numeric
    : null;
}

function nonNegative(value: number | null | undefined): number | null {
  const numeric = finite(value);
  return numeric !== null && numeric >= 0 ? numeric : null;
}

function selectedCandidate(
  arm: RoutingExperimentArm,
): RoutingExperimentCandidateMetrics | null {
  if (arm.selectedCandidateId === null) return null;
  return (
    arm.candidates.find(
      (candidate) => candidate.id === arm.selectedCandidateId,
    ) ?? null
  );
}

function nullableDelta(
  treatment: number | null,
  control: number | null,
): number | null {
  return treatment === null || control === null
    ? null
    : treatment - control;
}

function candidateMetricValidity(
  candidate: RoutingExperimentCandidateMetrics,
): boolean {
  return (
    candidate.id.trim().length > 0 &&
    Number.isFinite(candidate.distanceMeters) &&
    candidate.distanceMeters > 0 &&
    Number.isFinite(candidate.durationSeconds) &&
    candidate.durationSeconds > 0 &&
    (
      candidate.canonicalScore === null ||
      Number.isFinite(candidate.canonicalScore)
    )
  );
}

function metric(
  value: number | null | undefined,
  kind: "unit" | "non-negative",
): number | null {
  return kind === "unit" ? unit(value) : nonNegative(value);
}

function armLatency(arm: RoutingExperimentArm): number | null {
  return nonNegative(arm.planningLatencyMs);
}

function validityOf(
  trial: RoutingExperimentTrial,
  control: RoutingExperimentCandidateMetrics | null,
  treatment: RoutingExperimentCandidateMetrics | null,
): RoutingExperimentValidityReason {
  if (
    !Number.isSafeInteger(trial.control.providerCalls) ||
    trial.control.providerCalls < 0 ||
    !Number.isSafeInteger(trial.treatment.providerCalls) ||
    trial.treatment.providerCalls < 0 ||
    trial.control.providerCalls !== trial.treatment.providerCalls
  ) {
    return "call-budget-mismatch";
  }
  if (control === null || !candidateMetricValidity(control)) {
    return "control-selection-missing";
  }
  if (treatment === null || !candidateMetricValidity(treatment)) {
    return "treatment-selection-missing";
  }
  if (!control.eligible) return "control-ineligible";
  if (!treatment.eligible) return "treatment-ineligible";
  return "valid";
}

/**
 * Builds one apples-to-apples routing experiment scorecard.
 *
 * A scorecard is valid only when both arms selected an eligible candidate and
 * consumed the same provider-call budget. This prevents "the new method won"
 * conclusions that were actually bought with an extra route call.
 */
export function routingExperimentScorecard(
  trial: RoutingExperimentTrial,
): RoutingExperimentScorecard {
  const control = selectedCandidate(trial.control);
  const treatment = selectedCandidate(trial.treatment);
  const validity = validityOf(trial, control, treatment);
  const equalProviderCallBudget =
    Number.isSafeInteger(trial.control.providerCalls) &&
    Number.isSafeInteger(trial.treatment.providerCalls) &&
    trial.control.providerCalls === trial.treatment.providerCalls;

  const delta =
    validity !== "valid" || control === null || treatment === null
      ? null
      : {
          durationSeconds:
            treatment.durationSeconds - control.durationSeconds,
          distanceMeters:
            treatment.distanceMeters - control.distanceMeters,
          canonicalScore: nullableDelta(
            finite(treatment.canonicalScore),
            finite(control.canonicalScore),
          ),
          worthwhileMinuteRatio: nullableDelta(
            metric(treatment.worthwhileMinuteRatio, "unit"),
            metric(control.worthwhileMinuteRatio, "unit"),
          ),
          sustainedBendShare: nullableDelta(
            metric(treatment.sustainedBendShare, "unit"),
            metric(control.sustainedBendShare, "unit"),
          ),
          maneuversPer10Miles: nullableDelta(
            metric(treatment.maneuversPer10Miles, "non-negative"),
            metric(control.maneuversPer10Miles, "non-negative"),
          ),
          backtrackingShare: nullableDelta(
            metric(treatment.backtrackingShare, "unit"),
            metric(control.backtrackingShare, "unit"),
          ),
          selfOverlapShare: nullableDelta(
            metric(treatment.selfOverlapShare, "unit"),
            metric(control.selfOverlapShare, "unit"),
          ),
          timeboxErrorSeconds: nullableDelta(
            metric(treatment.timeboxErrorSeconds, "non-negative"),
            metric(control.timeboxErrorSeconds, "non-negative"),
          ),
          planningLatencyMs: nullableDelta(
            armLatency(trial.treatment),
            armLatency(trial.control),
          ),
        };

  return {
    caseId: trial.caseId,
    generator: trial.generator,
    equalProviderCallBudget,
    validity,
    control,
    treatment,
    delta,
    treatmentCorridorAdherenceShare:
      treatment === null
        ? null
        : unit(treatment.corridorAdherenceShare),
    treatmentPreservedBaselineShare:
      treatment === null
        ? null
        : unit(treatment.preservedBaselineShare),
    riderPreference: trial.riderPreference ?? "not-rated",
  };
}

export interface RoutingExperimentAggregate {
  readonly generator: string;
  readonly trials: number;
  readonly validTrials: number;
  readonly equalBudgetTrials: number;
  readonly riderRatedTrials: number;
  readonly riderPreference: {
    readonly treatment: number;
    readonly control: number;
    readonly tie: number;
  };
  /** Means over known valid deltas only. Unknown metrics stay absent. */
  readonly meanDelta: {
    readonly durationSeconds: number | null;
    readonly canonicalScore: number | null;
    readonly worthwhileMinuteRatio: number | null;
    readonly sustainedBendShare: number | null;
    readonly maneuversPer10Miles: number | null;
    readonly backtrackingShare: number | null;
    readonly selfOverlapShare: number | null;
    readonly timeboxErrorSeconds: number | null;
    readonly planningLatencyMs: number | null;
  };
  readonly meanTreatmentCorridorAdherenceShare: number | null;
  readonly meanTreatmentPreservedBaselineShare: number | null;
}

function mean(values: readonly (number | null)[]): number | null {
  const known = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  return known.length === 0
    ? null
    : known.reduce((sum, value) => sum + value, 0) / known.length;
}

/**
 * Aggregates repeated trials without declaring a synthetic "winner."
 *
 * The report keeps rider choice, route metrics and system cost visible
 * separately so experiment review can see *why* a treatment helped or hurt.
 */
export function aggregateRoutingExperimentScorecards(
  generator: string,
  scorecards: readonly RoutingExperimentScorecard[],
): RoutingExperimentAggregate {
  const relevant = scorecards.filter(
    (scorecard) => scorecard.generator === generator,
  );
  const valid = relevant.filter(
    (scorecard) =>
      scorecard.validity === "valid" && scorecard.delta !== null,
  );
  const rated = relevant.filter(
    (scorecard) => scorecard.riderPreference !== "not-rated",
  );

  return {
    generator,
    trials: relevant.length,
    validTrials: valid.length,
    equalBudgetTrials: relevant.filter(
      (scorecard) => scorecard.equalProviderCallBudget,
    ).length,
    riderRatedTrials: rated.length,
    riderPreference: {
      treatment: rated.filter(
        (scorecard) => scorecard.riderPreference === "treatment",
      ).length,
      control: rated.filter(
        (scorecard) => scorecard.riderPreference === "control",
      ).length,
      tie: rated.filter(
        (scorecard) => scorecard.riderPreference === "tie",
      ).length,
    },
    meanDelta: {
      durationSeconds: mean(
        valid.map((scorecard) => scorecard.delta!.durationSeconds),
      ),
      canonicalScore: mean(
        valid.map((scorecard) => scorecard.delta!.canonicalScore),
      ),
      worthwhileMinuteRatio: mean(
        valid.map((scorecard) => scorecard.delta!.worthwhileMinuteRatio),
      ),
      sustainedBendShare: mean(
        valid.map((scorecard) => scorecard.delta!.sustainedBendShare),
      ),
      maneuversPer10Miles: mean(
        valid.map((scorecard) => scorecard.delta!.maneuversPer10Miles),
      ),
      backtrackingShare: mean(
        valid.map((scorecard) => scorecard.delta!.backtrackingShare),
      ),
      selfOverlapShare: mean(
        valid.map((scorecard) => scorecard.delta!.selfOverlapShare),
      ),
      timeboxErrorSeconds: mean(
        valid.map((scorecard) => scorecard.delta!.timeboxErrorSeconds),
      ),
      planningLatencyMs: mean(
        valid.map((scorecard) => scorecard.delta!.planningLatencyMs),
      ),
    },
    meanTreatmentCorridorAdherenceShare: mean(
      valid.map((scorecard) => scorecard.treatmentCorridorAdherenceShare),
    ),
    meanTreatmentPreservedBaselineShare: mean(
      valid.map((scorecard) => scorecard.treatmentPreservedBaselineShare),
    ),
  };
}
