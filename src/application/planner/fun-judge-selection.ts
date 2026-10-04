/**
 * Feature-flagged Best Ride promotion through the FUN JUDGE.
 *
 * Runs strictly downstream of the canonical pipeline (normalize → hard
 * eligibility → evidence/score → diversity → roles). It may only choose WHICH
 * of the already-eligible, rider-visible candidates earns "Best Ride", and only
 * among those inside the Best Ride detour envelope, inside a discovery timebox
 * when one applies, and carrying no rider-facing caution the deterministic
 * winner does not already carry. It never adds, drops or reshapes a candidate,
 * never touches eligibility, closures, access, warnings or scores.
 *
 * Modes (`OGV_JEV_FUN_JUDGE`):
 * - `off` (default): no model call, nothing reported.
 * - `shadow`: the judge runs and the diagnostic reports what it would pick;
 *   roles and selection stay deterministic.
 * - `on`: a confident, order-stable Jev preference becomes Best Ride (and so
 *   the automatic selection). Any other outcome keeps the deterministic winner.
 */

import {
  assessRouteFun,
  funFeaturesFromRouteScore,
  mappedGravelAffinityFromEvidence,
} from "@/domain/route/fun";
import { assignRoles, type RoleAssignment } from "@/domain/route/roles";
import type { RoutePolicy } from "@/domain/route/policy";
import type { PipelineIntent } from "@/domain/route/intent";
import {
  FUN_JUDGE_SHADOW_DEADLINE_MS,
  type FunJudge,
  type FunJudgeCallOptions,
  type FunJudgeOutcome,
} from "./fun-judge";
import type {
  FunJudgeCandidateEvidence,
  FunJudgeFormulaEvidence,
  FunJudgeIntent,
  FunJudgeRideArcSummary,
} from "./ports/fun-judge";
import {
  timeboxPreferredIndexes,
  type CandidatePipelineResult,
  type DiscoveryTimebox,
  type PipelineCandidate,
} from "./pipeline";
import { analyzeBends } from "@/domain/geometry/bends";

export type FunJudgeMode = "off" | "shadow" | "on";

/** Unknown or absent values are `off`: a typo can never turn promotion on. */
export function parseFunJudgeMode(value: string | undefined): FunJudgeMode {
  const normalized = value?.trim().toLowerCase();
  return normalized === "shadow" || normalized === "on" ? normalized : "off";
}

/**
 * Optional extra evidence another lane computes (curve continuity, Ride Arc).
 * Absent or `null` stays unknown; the judge is told so.
 */
export type FunJudgeEvidenceExtensions = (candidate: PipelineCandidate) => {
  readonly curvatureContinuity?: number | null;
  readonly rideArc?: FunJudgeRideArcSummary | null;
  readonly formulaEvidence?: FunJudgeFormulaEvidence;
};

/** A sustained bend run this long or longer reads as fully continuous (1.0). */
export const CONTINUOUS_BEND_RUN_METERS = 1_000;

/**
 * Curve continuity from the candidate's own line: its longest uninterrupted
 * multi-vertex bend run (`analyzeBends`, junction corners excluded), scaled so
 * 1 km of sustained curves is 1.0. A line too short to measure stays unknown.
 * Ride Arc stays unknown until a "worthwhile road" rule exists.
 */
export const geometryFunJudgeExtensions: FunJudgeEvidenceExtensions = (candidate) => {
  if (candidate.geometry.length < 3 || !(candidate.distanceMeters > 0)) return { curvatureContinuity: null };
  const { longestRunMeters } = analyzeBends(candidate.geometry);
  return { curvatureContinuity: Math.min(1, longestRunMeters / CONTINUOUS_BEND_RUN_METERS) };
};

export type FunJudgeExclusionReason = "outside-detour-budget" | "outside-timebox" | "extra-caution";

export interface FunJudgeEvidenceDelta {
  readonly feature: string;
  /** Jev's pick minus the deterministic winner (OpenGravel arithmetic, not model text). */
  readonly delta: number;
}

export interface FunJudgeSelectionDiagnostic {
  readonly mode: Exclude<FunJudgeMode, "off">;
  readonly outcome: FunJudgeOutcome | "too-few-candidates";
  /** True only when `on` and Jev's preference replaced the deterministic winner. */
  readonly applied: boolean;
  readonly deterministicIndex: number;
  /** Jev's preferred index (also in shadow), `null` when it did not prefer one. */
  readonly jevIndex: number | null;
  readonly selectedIndex: number;
  readonly shortlist: readonly number[];
  readonly excluded: readonly { readonly index: number; readonly reason: FunJudgeExclusionReason }[];
  readonly confidence: number | null;
  readonly margin: number | null;
  readonly orderAgreement: boolean | null;
  readonly model: string | null;
  readonly calls: number;
  readonly cached: boolean;
  readonly latencyMs: number;
  /** Why Jev's pick reads as the better ride, as measured evidence deltas. */
  readonly why: readonly FunJudgeEvidenceDelta[];
  readonly addedTimePct: number | null;
}

export interface FunJudgeSelection {
  readonly roles: RoleAssignment<number>;
  readonly selectedIndex: number | null;
  readonly diagnostic: FunJudgeSelectionDiagnostic | null;
  /** The evidence that was (or would have been) judged, for replay/evaluation. */
  readonly request: { readonly intent: FunJudgeIntent; readonly candidates: readonly FunJudgeCandidateEvidence[] } | null;
}

export interface FunJudgeSelectionInput {
  readonly pipeline: CandidatePipelineResult;
  readonly intent: PipelineIntent;
  readonly avoidHighways: boolean;
  readonly policy: RoutePolicy;
  readonly discoveryTimebox?: DiscoveryTimebox;
  readonly mode: FunJudgeMode;
  readonly judge: FunJudge | null;
  readonly signal: AbortSignal;
  readonly judgeOptions?: FunJudgeCallOptions;
  readonly extensions?: FunJudgeEvidenceExtensions;
}

/** Name used by callers that invoke the selection seam directly. */
export type SelectFunJudgeInput = FunJudgeSelectionInput;

const METERS_PER_MILE = 1609.344;
const WHY_MIN_DELTA = 0.05;
const WHY_FEATURES = [
  "curvature",
  "curvatureContinuity",
  "backroadShare",
  "surfaceFit",
  "elevation",
  "trafficFlow",
  "junctionFlow",
  "novelty",
  "mappedGravelAffinity",
] as const satisfies readonly (keyof FunJudgeCandidateEvidence)[];

function candidateKey(index: number): string {
  return `c${index}`;
}

/** Aggregate evidence for one kept candidate; arithmetic happens here, never in the model. */
export function funJudgeEvidenceFor(
  candidate: PipelineCandidate,
  index: number,
  fastestSeconds: number,
  extensions?: FunJudgeEvidenceExtensions,
): FunJudgeCandidateEvidence {
  const gravel = mappedGravelAffinityFromEvidence(candidate.evidence, candidate.distanceMeters);
  const features = funFeaturesFromRouteScore(candidate.score, { mappedGravelAffinity: gravel });
  const assessment = assessRouteFun(candidate.score, { mappedGravelAffinity: gravel });
  const miles = candidate.distanceMeters / METERS_PER_MILE;
  const maneuvers = candidate.instructions?.length;
  const extra = extensions?.(candidate) ?? {};
  return {
    key: candidateKey(index),
    durationMinutes: candidate.durationSeconds / 60,
    distanceMiles: miles,
    addedTimePct: fastestSeconds > 0
      ? Math.max(0, candidate.durationSeconds / fastestSeconds - 1)
      : 0,
    curvature: features.curvature,
    curvatureContinuity: extra.curvatureContinuity ?? null,
    backroadShare: features.backroad,
    surfaceFit: features.surfaceFit,
    elevation: features.elevation,
    trafficFlow: features.trafficFlow,
    junctionFlow: features.junctionFlow,
    novelty: features.novelty,
    mappedGravelAffinity: features.mappedGravelAffinity,
    maneuversPer10Miles: maneuvers === undefined || miles < 0.5 ? null : (maneuvers / miles) * 10,
    rideArc: extra.rideArc ?? null,
    evidenceCoverage: assessment.coverage,
    ...(extra.formulaEvidence === undefined ? {} : { formulaEvidence: extra.formulaEvidence }),
  };
}

function cautionCodes(candidate: PipelineCandidate): ReadonlySet<string> {
  return new Set(
    candidate.warnings
      .filter((warning) => warning.severity !== "info")
      .map((warning) => warning.code),
  );
}

/**
 * Which kept candidates the judge may consider. The deterministic winner is
 * always in (it is the baseline); others must sit inside the Best Ride detour
 * envelope, inside a discovery timebox, and add no caution of their own.
 */
export function funJudgeShortlist(
  candidates: readonly PipelineCandidate[],
  deterministicIndex: number,
  policy: RoutePolicy,
  discoveryTimebox?: DiscoveryTimebox,
): {
  readonly indexes: readonly number[];
  readonly excluded: readonly { readonly index: number; readonly reason: FunJudgeExclusionReason }[];
} {
  const fastest = Math.min(...candidates.map((candidate) => candidate.durationSeconds));
  const maximumPct = policy.roleDetourEnvelopes["best-ride"].maximumPct;
  const inBox = timeboxPreferredIndexes(candidates, discoveryTimebox);
  const baseline = candidates[deterministicIndex];
  const baselineCautions = baseline === undefined ? new Set<string>() : cautionCodes(baseline);
  const indexes: number[] = [];
  const excluded: { index: number; reason: FunJudgeExclusionReason }[] = [];
  candidates.forEach((candidate, index) => {
    if (index === deterministicIndex) {
      indexes.push(index);
      return;
    }
    if (fastest > 0 && candidate.durationSeconds / fastest - 1 > maximumPct + 1e-9) {
      excluded.push({ index, reason: "outside-detour-budget" });
    } else if (inBox !== null && !inBox.has(index)) {
      excluded.push({ index, reason: "outside-timebox" });
    } else if ([...cautionCodes(candidate)].some((code) => !baselineCautions.has(code))) {
      excluded.push({ index, reason: "extra-caution" });
    } else {
      indexes.push(index);
    }
  });
  return { indexes, excluded };
}

function whyDeltas(
  pick: FunJudgeCandidateEvidence,
  baseline: FunJudgeCandidateEvidence,
): readonly FunJudgeEvidenceDelta[] {
  return WHY_FEATURES.flatMap((feature) => {
    const left = pick[feature];
    const right = baseline[feature];
    if (left === null || right === null) return [];
    const delta = Number((left - right).toFixed(3));
    return Math.abs(delta) >= WHY_MIN_DELTA ? [{ feature, delta }] : [];
  }).sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));
}

export async function selectBestRideWithFunJudge(
  input: FunJudgeSelectionInput,
): Promise<FunJudgeSelection> {
  const { pipeline } = input;
  const unchanged: FunJudgeSelection = {
    roles: pipeline.roles,
    selectedIndex: pipeline.selectedIndex,
    diagnostic: null,
    request: null,
  };
  const deterministicIndex = pipeline.roles["best-ride"] ?? pipeline.selectedIndex;
  if (input.mode === "off" || deterministicIndex === null || pipeline.candidates.length === 0) {
    return unchanged;
  }

  const kept = pipeline.candidates;
  const fastest = Math.min(...kept.map((candidate) => candidate.durationSeconds));
  const shortlist = funJudgeShortlist(kept, deterministicIndex, input.policy, input.discoveryTimebox);
  const evidence = shortlist.indexes.map((index) =>
    funJudgeEvidenceFor(kept[index]!, index, fastest, input.extensions),
  );
  const intent: FunJudgeIntent = {
    roadCharacter: input.intent.roadCharacter ?? "balanced",
    surfacePreference: input.intent.surface?.preference ?? "mixed",
    avoidHighways: input.avoidHighways,
  };
  // Present in the canonical recommendation order; the judge's own order
  // check reverses it, so position bias cannot masquerade as preference.
  const request = { intent, candidates: evidence };
  const base = {
    mode: input.mode,
    deterministicIndex,
    shortlist: shortlist.indexes,
    excluded: shortlist.excluded,
  } as const;

  if (evidence.length < 2 || input.judge === null) {
    return {
      ...unchanged,
      request,
      diagnostic: {
        ...base,
        outcome: evidence.length < 2 ? "too-few-candidates" : "unavailable",
        applied: false,
        jevIndex: null,
        selectedIndex: pipeline.selectedIndex ?? deterministicIndex,
        confidence: null,
        margin: null,
        orderAgreement: null,
        model: null,
        calls: 0,
        cached: false,
        latencyMs: 0,
        why: [],
        addedTimePct: null,
      },
    };
  }

  const fallbackRanking = [
    candidateKey(deterministicIndex),
    ...shortlist.indexes.filter((index) => index !== deterministicIndex).map(candidateKey),
  ];
  const verdict = await input.judge.judge(request, fallbackRanking, input.signal, input.judgeOptions);
  const jevIndex = verdict.preferredKey === null
    ? null
    : shortlist.indexes.find((index) => candidateKey(index) === verdict.preferredKey) ?? null;
  const pickEvidence = jevIndex === null
    ? null
    : evidence[shortlist.indexes.indexOf(jevIndex)] ?? null;
  const baselineEvidence = evidence[shortlist.indexes.indexOf(deterministicIndex)]!;

  let roles = pipeline.roles;
  let selectedIndex = pipeline.selectedIndex;
  let applied = false;
  if (input.mode === "on" && jevIndex !== null && jevIndex !== deterministicIndex) {
    // Re-run the canonical role assignment with Best Ride pinned to Jev's
    // pick, so every material role stays consistent with the new Best Ride.
    const promoted = assignRoles(
      kept.map((candidate, index) => ({
        id: index,
        durationSeconds: candidate.durationSeconds,
        distanceMeters: candidate.distanceMeters,
        score: candidate.score,
      })),
      input.policy,
      undefined,
      (candidate) => candidate.id === jevIndex,
    );
    if (promoted["best-ride"] === jevIndex) {
      roles = promoted;
      selectedIndex = jevIndex;
      applied = true;
    }
  }

  return {
    roles,
    selectedIndex,
    request,
    diagnostic: {
      ...base,
      outcome: verdict.outcome,
      applied,
      jevIndex,
      selectedIndex: selectedIndex ?? deterministicIndex,
      confidence: verdict.confidence,
      margin: verdict.margin,
      orderAgreement: verdict.orderAgreement,
      model: verdict.model,
      calls: verdict.calls,
      cached: verdict.cached,
      latencyMs: Math.round(verdict.latencyMs),
      why: pickEvidence === null || jevIndex === deterministicIndex
        ? []
        : whyDeltas(pickEvidence, baselineEvidence),
      addedTimePct: pickEvidence === null ? null : Number(pickEvidence.addedTimePct.toFixed(3)),
    },
  };
}

/**
 * Defers shadow judging until the caller has built its response object. The
 * timer keeps the model call off the response path; its fresh signal and
 * four-second call options make a late result useful for the shared cache.
 */
export function scheduleFunJudgeShadow(
  input: Omit<SelectFunJudgeInput, "mode" | "signal">,
  onComplete: (selection: FunJudgeSelection) => void,
): void {
  setTimeout(() => {
    const signal = new AbortController().signal;
    const judgeOptions: FunJudgeCallOptions = {
      ...input.judgeOptions,
      deadlineMs: FUN_JUDGE_SHADOW_DEADLINE_MS,
      transportTimeoutMs: FUN_JUDGE_SHADOW_DEADLINE_MS,
    };
    void selectBestRideWithFunJudge({
      ...input,
      mode: "shadow",
      signal,
      judgeOptions,
    })
      .then((selection) => {
        try {
          onComplete(selection);
        } catch {
          // Shadow telemetry must never become a planning failure.
        }
      })
      .catch(() => {
        // An injected judge may throw; shadow remains advisory and fail-open.
      });
  }, 0);
}
