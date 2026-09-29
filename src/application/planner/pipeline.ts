/**
 * The canonical candidate pipeline (Task 3.1, 06-ROUTING-AND-DECISION-ENGINE
 * §1, §7–§9; 02-ARCHITECTURE-CONTRACT §10).
 *
 * Providers generate paths; OpenGravel decides whether they are valid, useful
 * and worth showing. This module is that decision, in the one order that makes
 * it safe:
 *
 * 1. **normalize** — copy the provider's geometry and reject unusable metrics.
 * 2. **eligibility** — drop anything that cannot legally be ridden, *before*
 *    any score exists (06 §7). An ineligible candidate is explained by a
 *    diagnostic, never ranked.
 * 3. **enrich** — build the evidence map. Wave 3 has no road intelligence, so
 *    the map is keyed honestly, with `unknown` values rather than invented ones.
 * 4. **score** — deterministic, explainable, policy-versioned (§9–§10).
 *
 * Two deliberate limits, both recorded as `OGV-D-1xx` decisions:
 *
 * - The result is a **`PipelineCandidate` draft**, not a domain `RouteCandidate`:
 *   that type carries `id` and `geometryRef`, and a pure, deterministic
 *   function can mint neither (ids are random; refs belong to a store —
 *   `OGV-D-161`). The caller binds identity and storage: the server to wire ids
 *   with inline geometry, the client controller to a `GeometryStore` handle.
 * - Diversity, dedupe and role assignment (06 §14–§15) are Wave 3.2/3.3. This
 *   module preserves the provider's arrival order and claims no role.
 */

import { OFFLINE_ROUTING_WARNING } from "@/application/offline/offline-route-fallback";
import { isUsableEvidence, unknownEvidence } from "@/domain/evidence/types";
import type { EvidenceSource, EvidenceValue } from "@/domain/evidence/types";
import type { Coordinate } from "@/domain/ride/types";
import { rankDiverseCandidates } from "@/domain/route/diversity";
import {
  assessRouteFun,
  mappedGravelAffinityFromEvidence,
  selectFunWithinDetour,
  type FunAssessment,
} from "@/domain/route/fun";
import {
  evaluateEligibility,
  type ConstraintContext,
  type EligibilityFailureCode,
  type RouteEligibility,
} from "@/domain/route/eligibility";
import type { PipelineIntent } from "@/domain/route/intent";
import type { RoutePolicy } from "@/domain/route/policy";
import { assignRoles, type RoleAssignment } from "@/domain/route/roles";
import { scoreCandidate, type TrafficCostSignal } from "@/domain/route/scoring";
import type {
  EligibilityResult,
  ProviderProvenance,
  RouteEvidence,
  RouteScore,
  RouteWarning,
} from "@/domain/route/types";
import { deepFreeze } from "@/domain/util/freeze";
import { sketchStraySections } from "@/domain/sketch/snap";
import { formatDistance } from "./measurements";
import type { ProviderCandidate } from "./route-provider";
import {
  SKETCH_ADHERENCE_EVIDENCE_KEY,
  sketchAdherence,
  sketchAdherenceEvidence,
} from "./sketch-corridor";

/** The stage a diagnostic came from; the order is the pipeline's order. */
export type PipelineStage =
  | "normalize"
  | "eligibility"
  | "enrich"
  | "score"
  | "diversity";

export type PipelineDiagnosticCode =
  | "empty-candidate-set"
  | "invalid-metrics"
  | "ineligible"
  | "near-duplicate"
  | "over-limit";

/**
 * One reason a candidate did not survive. `message` is server diagnostics, not
 * rider copy; `candidateIndex` is the provider's own order, so a log can name
 * the answer that was dropped.
 */
export interface PipelineDiagnostic {
  readonly code: PipelineDiagnosticCode;
  readonly stage: PipelineStage;
  readonly candidateIndex: number | null;
  readonly providerId: string | null;
  readonly message: string;
  /** Set when the drop was a hard-eligibility failure. */
  readonly eligibilityCode?: EligibilityFailureCode;
  /**
   * Set when the drop was a diversity decision: the measured overlap (0–1) with
   * the route that already held the slot, so a log can distinguish "shown
   * twice" from "scored worse".
   */
  readonly similarity?: number;
}

/**
 * One pipeline-approved candidate, before identity and storage binding. It is
 * the domain `RouteCandidate` minus `id`/`geometryRef`/`instructionsRef`, plus
 * the geometry itself (the caller stores it and mints the handle). Bounded
 * maneuver facts remain inline so the selected candidate can seed RideSession.
 */
export interface PipelineCandidate {
  /** Diagnostics only — never rider copy (Rule E / VNX-007). */
  readonly provider: ProviderProvenance;
  readonly geometry: readonly Coordinate[];
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly instructions?: ProviderCandidate["instructions"];
  readonly speedLimits?: ProviderCandidate["speedLimits"];
  readonly eligibility: EligibilityResult;
  readonly evidence: RouteEvidence;
  readonly score: RouteScore;
  readonly warnings: readonly RouteWarning[];
  readonly fingerprint: string;
}

export interface CandidatePipelineInput {
  readonly candidates: readonly ProviderCandidate[];
  /** The narrow intent view (see `domain/route/intent.ts`). */
  readonly intent: PipelineIntent;
  readonly policy: RoutePolicy;
  /**
   * Resolved constraints. The server supplies the request's avoid rings; the
   * client controller supplies the authored intent's areas. Absent means "no
   * constraints were resolved", which is not the same as "no constraints exist"
   * — the caller that has an intent must pass them.
   */
  readonly constraintContext?: ConstraintContext;
  /**
   * Per-candidate constraints (Task 4.3b).
   *
   * A road span is measured against the **returned** route (06 §8), so its
   * verdict is a property of the candidate, not of the request: the server
   * supplies this to add `spanEvaluations` per candidate while `constraintContext`
   * keeps the candidate-independent parts (avoid areas, span identities). When
   * both are present, this wins for the candidate it is asked about; a caller with
   * no per-candidate facts simply omits it.
   */
  readonly constraintContextFor?: (
    candidate: ProviderCandidate,
  ) => ConstraintContext;
  /**
   * The committed sketch's resolved trace, when the ride has one (06 §18,
   * Task 4.4).
   *
   * Adherence is a measurement of the **returned** route against the corridor
   * (`sketchAdherence`), recorded under the `sketchAdherence` evidence key with a
   * warning when the answer went materially the other way. Absent means the ride
   * has no sketch, which is not the same as "the corridor did not resolve": a
   * builder that could not resolve one reports it on its own channel
   * (`unresolvedRefs`), so a candidate is never marked down for a missing trace.
   */
  readonly sketch?: { readonly corridor: readonly Coordinate[] };
  /** Optional per-candidate traffic integration; absent keeps the old cost. */
  readonly trafficCostFor?: (candidate: ProviderCandidate) => TrafficCostSignal | null;
  /** Evidence supplied by an application-owned enrichment port for this path. */
  readonly evidenceFor?: (candidate: ProviderCandidate) => RouteEvidence;
  /**
   * Additional OpenGravel-owned eligibility policy for a specialized use case.
   * It can only add failures/warnings to the canonical verdict; it cannot make
   * a base-ineligible route eligible.
   */
  readonly additionalEligibilityFor?: (
    candidate: ProviderCandidate,
  ) => RouteEligibility;
  /** Geometry used only for score metrics; the full route still leaves the pipeline. */
  readonly scoringGeometryFor?: (
    candidate: ProviderCandidate,
  ) => readonly Coordinate[];
  /**
   * Discovery-only selection constraint. Kept outside `PipelineIntent` so a
   * normal RideIntent time budget cannot silently change standard planning.
   */
  readonly discoveryTimebox?: {
    readonly targetMinutes: number;
    readonly toleranceMinutes: number;
  };
}

export interface PipelineFunShadowAssessment {
  /** Stable candidate fingerprint; shadow data never mints route ids. */
  readonly fingerprint: string;
  readonly providerId: string;
  readonly profile: string;
  readonly assessment: FunAssessment;
}

export interface PipelineFunShadowSelection {
  /** Index into the rider-visible candidates array. */
  readonly candidateIndex: number;
  readonly fingerprint: string;
  readonly assessment: FunAssessment;
  readonly detourPct: number;
}

export interface CandidatePipelineResult {
  /**
   * The rider-visible candidates, in recommendation order: the diversity stage
   * keeps the ones that are meaningfully distinct and `06 §14`'s MMR picks the
   * strongest first, so a card list rendered in this order reads as a ranking.
   */
  readonly candidates: readonly PipelineCandidate[];
  /**
   * Experimental fun assessments for every eligible/scored candidate before
   * diversity drops any near-duplicates or over-limit alternatives.
   *
   * Shadow-only: these values do not affect roles or selectedIndex.
   */
  readonly funShadowAssessments: readonly PipelineFunShadowAssessment[];
  /**
   * What the experimental algorithm would pick for Fast & Fun from the same
   * rider-visible candidates, using the canonical role detour envelope.
   * Shadow-only: selectedIndex and role assignment remain authoritative.
   */
  readonly funShadowSelection: PipelineFunShadowSelection | null;
  readonly diagnostics: readonly PipelineDiagnostic[];
  /**
   * Role → index into `candidates` (`null` when the role was not earned).
   * Index-shaped because the pipeline mints no `RouteCandidateId`: the caller
   * binds identities with `bindRoles` (`OGV-D-194`/`OGV-D-201`).
   */
  readonly roles: RoleAssignment<number>;
  /**
   * The automatic selection (`VNX-006`): the best ride, or the fastest when
   * there is no best ride. Discovery timeboxes select an in-box route when one
   * exists, otherwise the closest valid route. `null` exactly when no candidate
   * survived.
   */
  readonly selectedIndex: number | null;
}

/** What Wave 3 can say about the candidate's surface mix: nothing, keyed. */
const SURFACE_MIX_REASON =
  "No surface evidence source exists in Wave 3; the mix is unknown, not paved.";

/**
 * The sketch contribution to one candidate: an evidence value and the warning the
 * rider sees when the route left the drawn line (06 §18).
 *
 * The source is `rider` and named after the trace, because the value is a
 * measurement of the rider's own drawing — not an engine report, and not a claim
 * the pipeline invented. `appliesTo` is deliberately absent: the candidate's
 * `GeometryRef` does not exist yet at this stage (`OGV-D-161`), and a scope that
 * pointed at the wrong handle would be worse than none.
 */
const SKETCH_TRACE_SOURCE: EvidenceSource = {
  id: "sketch-trace",
  label: "Sketch trace",
  category: "rider",
  authoritativeFor: [SKETCH_ADHERENCE_EVIDENCE_KEY],
};

interface SketchContribution {
  readonly evidence: EvidenceValue<unknown> | null;
  readonly warning: RouteWarning | null;
}

function sketchContribution(
  geometry: readonly Coordinate[],
  sketch: CandidatePipelineInput["sketch"],
): SketchContribution {
  if (sketch === undefined || sketch.corridor.length < 2) {
    return { evidence: null, warning: null };
  }
  const verdict = sketchAdherenceEvidence(sketchAdherence(geometry, sketch.corridor));
  return {
    evidence: {
      value: verdict.value,
      status: verdict.status,
      confidence: verdict.confidence,
      coverage: verdict.confidence,
      provenance: [SKETCH_TRACE_SOURCE],
    },
    warning:
      verdict.warning === null
        ? unfollowedSketchWarning(geometry, sketch.corridor)
        : {
            id: "sketch:deviation",
            code: "sketch-deviation",
            severity: "warning",
            message: verdict.warning,
          },
  };
}

/**
 * The honest note for a route that follows the drawing except where it cannot
 * (06 §18 "offer tradeoffs when perfect adherence is impossible"; OGV-D-285):
 * a drawn stretch with no rideable road under it — a trail, a private lane, a
 * line across a field — is routed around, and the rider is told how much.
 * Only when the route follows the sketch overall; a route that does not gets
 * the stronger deviation warning instead.
 */
function unfollowedSketchWarning(
  geometry: readonly Coordinate[],
  corridor: readonly Coordinate[],
): RouteWarning | null {
  const sections = sketchStraySections(geometry, corridor);
  if (sections.length === 0) return null;
  const meters = sections.reduce((sum, section) => sum + section.lengthMeters, 0);
  const where = sections.length === 1 ? "one place" : `${sections.length} places`;
  return {
    id: "sketch:unfollowed",
    code: "sketch-unfollowed",
    severity: "info",
    message: `About ${formatDistance(meters)} of your drawing, in ${where}, has no road this route can use, so it goes around there.`,
  };
}

/**
 * The selection cap for rider-visible candidates: `04 §11` allows at most three
 * meaningful choices, so the diversity stage selects three and the rest are
 * diagnostics. The policy's legacy `maxAlternatives` (2) predates the card
 * layout and is deliberately not used here (`OGV-D-207`).
 */
export const PIPELINE_MAX_RESULTS = 3;

/** No role is claimed until a candidate earns one. */
function emptyRoles(): RoleAssignment<number> {
  return {
    "best-ride": null,
    fastest: null,
    "fast-and-fun": null,
    "more-twisties": null,
    "more-dirt": null,
    "lower-workload": null,
  };
}

function diagnostic(
  code: PipelineDiagnosticCode,
  stage: PipelineStage,
  candidateIndex: number | null,
  providerId: string | null,
  message: string,
  eligibilityCode?: EligibilityFailureCode,
  similarity?: number,
): PipelineDiagnostic {
  const base: PipelineDiagnostic = { code, stage, candidateIndex, providerId, message };
  return {
    ...base,
    ...(eligibilityCode === undefined ? {} : { eligibilityCode }),
    ...(similarity === undefined ? {} : { similarity }),
  };
}

function copyCoordinate(coordinate: Coordinate): Coordinate {
  return { lon: coordinate.lon, lat: coordinate.lat };
}

function hasUsableMetrics(candidate: ProviderCandidate): boolean {
  return (
    Number.isFinite(candidate.distanceMeters) &&
    candidate.distanceMeters >= 0 &&
    Number.isFinite(candidate.durationSeconds) &&
    candidate.durationSeconds >= 0
  );
}

function unitEvidenceValue(
  evidence: EvidenceValue<unknown> | undefined,
): number | undefined {
  if (!evidence || !isUsableEvidence(evidence)) return undefined;
  const value = evidence.value;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined;
}

/**
 * The provider's own stable id when the adapter supplied one (`OGV-D-167`),
 * otherwise a deterministic descriptor. Wave 3.2 owns cross-provider dedupe;
 * this value only has to be stable and comparable.
 */
function candidateFingerprint(candidate: ProviderCandidate, index: number): string {
  const provided: unknown = candidate.providerMetadata?.["fingerprint"];
  if (typeof provided === "string" && provided.length > 0) return provided;
  return [
    candidate.providerId,
    candidate.profile,
    index,
    candidate.geometry.length,
    candidate.distanceMeters,
  ].join(":");
}

function toWarnings(
  warnings: readonly { readonly code: string; readonly message: string; readonly constraintId?: string }[],
): readonly RouteWarning[] {
  return warnings.map((warning, index) => ({
    id: `eligibility:${warning.code}:${warning.constraintId ?? index}`,
    code: warning.code,
    severity: "warning",
    message: warning.message,
  }));
}

/**
 * A line from the hosted fallback router (WORK-ORDER §1.2): the stock car
 * profile, so the rider's road character and avoid rules were not applied.
 */
export const BASIC_ROUTING_WARNING: RouteWarning = {
  id: "provider:basic-routing",
  code: "basic-routing",
  severity: "info",
  message: "Basic routing: this area is outside OpenGravel's own road graph, so curvy, backroad and avoid preferences were not applied.",
};


/** One candidate that survived eligibility, with the diagnostics it arrived with. */
interface EligibleEntry {
  readonly candidate: ProviderCandidate;
  readonly index: number;
  readonly warnings: readonly RouteWarning[];
}

/**
 * Stages 3 and 4 for one candidate: the evidence map, the score, the warnings and
 * the fingerprint (06 §9, §18).
 *
 * Extracted so the pipeline's own body stays the *order* it documents — normalize,
 * eligibility, enrich, score, diversity — instead of growing a second loop inside
 * the fourth line of it.
 */
function enrichCandidate(
  entry: EligibleEntry,
  input: CandidatePipelineInput,
  baselineDurationSeconds: number,
): PipelineCandidate {
  const sketch = sketchContribution(entry.candidate.geometry, input.sketch);
  const trafficCost = input.trafficCostFor?.(entry.candidate) ?? null;
  const suppliedEvidence = input.evidenceFor?.(entry.candidate) ?? {};
  const scoringGeometry = input.scoringGeometryFor?.(entry.candidate);
  const evidence: RouteEvidence = {
    surfaceMix: unknownEvidence(SURFACE_MIX_REASON),
    ...suppliedEvidence,
    ...(trafficCost?.label === undefined
      ? {}
      : {
          trafficBand: {
            value: trafficCost.label,
            status: trafficCost.status,
            confidence: null,
            provenance: [{
              id: "traffic-cost",
              label: "Protect the Ride traffic cost",
              category: "traffic" as const,
            }],
          },
        }),
    ...(sketch.evidence === null
      ? {}
      : { [SKETCH_ADHERENCE_EVIDENCE_KEY]: sketch.evidence }),
  };
  return deepFreeze<PipelineCandidate>({
    provider: {
      providerId: entry.candidate.providerId,
      profile: entry.candidate.profile,
    },
    geometry: entry.candidate.geometry.map(copyCoordinate),
    distanceMeters: entry.candidate.distanceMeters,
    durationSeconds: entry.candidate.durationSeconds,
    ...(entry.candidate.instructions === undefined
      ? {}
      : { instructions: entry.candidate.instructions }),
    ...(entry.candidate.speedLimits === undefined
      ? {}
      : { speedLimits: entry.candidate.speedLimits }),
    eligibility: { eligible: true, failures: [] },
    evidence,
    score: scoreCandidate({
      candidate: scoringGeometry === undefined || scoringGeometry.length < 2
        ? entry.candidate
        : { ...entry.candidate, geometry: scoringGeometry },
      intent: input.intent,
      policy: input.policy,
      evidence,
      baselineDurationSeconds,
      trafficCost,
    }),
    warnings: [
      ...entry.warnings,
      ...(sketch.warning === null ? [] : [sketch.warning]),
      ...(entry.candidate.providerMetadata?.["basicRouting"] === true ? [BASIC_ROUTING_WARNING] : []),
      ...(entry.candidate.providerMetadata?.["offlineRouting"] === true ? [OFFLINE_ROUTING_WARNING] : []),
    ],
    fingerprint: candidateFingerprint(entry.candidate, entry.index),
  });
}

/**
 * Runs the pipeline over one provider answer (or several). Pure and total:
 * every drop is described by a diagnostic, and an empty input is an empty
 * result plus a diagnostic rather than a silent success.
 */
export function runCandidatePipeline(
  input: CandidatePipelineInput,
): CandidatePipelineResult {
  const diagnostics: PipelineDiagnostic[] = [];
  const constraintContext: ConstraintContext =
    input.constraintContext ?? { avoidAreas: [], roadSpans: [] };

  if (input.candidates.length === 0) {
    return deepFreeze({
      candidates: [],
      funShadowAssessments: [],
      funShadowSelection: null,
      diagnostics: [
        diagnostic(
          "empty-candidate-set",
          "normalize",
          null,
          null,
          "The provider returned no candidates.",
        ),
      ],
      roles: emptyRoles(),
      selectedIndex: null,
    });
  }

  // Stage 1 — normalize: copy geometry, reject unusable metrics. Geometric
  // validity stays a hard-eligibility decision, so normalize never pre-empts it.
  const normalized: { candidate: ProviderCandidate; index: number }[] = [];
  input.candidates.forEach((candidate, index) => {
    if (!hasUsableMetrics(candidate)) {
      diagnostics.push(
        diagnostic(
          "invalid-metrics",
          "normalize",
          index,
          candidate.providerId,
          "The candidate carries a non-finite or negative distance or duration.",
        ),
      );
      return;
    }
    normalized.push({
      candidate: { ...candidate, geometry: candidate.geometry.map(copyCoordinate) },
      index,
    });
  });

  // Stage 2 — hard eligibility: an illegal or impossible route never reaches
  // scoring, and every drop explains itself.
  const eligible: {
    candidate: ProviderCandidate;
    index: number;
    warnings: readonly RouteWarning[];
  }[] = [];
  for (const entry of normalized) {
    const baseVerdict = evaluateEligibility({
      candidate: entry.candidate,
      intent: input.intent,
      constraintContext:
        input.constraintContextFor?.(entry.candidate) ?? constraintContext,
    });
    const additionalVerdict = input.additionalEligibilityFor?.(entry.candidate);
    const verdict: RouteEligibility = additionalVerdict === undefined
      ? baseVerdict
      : {
          eligible: baseVerdict.eligible && additionalVerdict.eligible,
          failures: [...baseVerdict.failures, ...additionalVerdict.failures],
          warnings: [...baseVerdict.warnings, ...additionalVerdict.warnings],
        };
    if (!verdict.eligible) {
      for (const failure of verdict.failures) {
        diagnostics.push(
          diagnostic(
            "ineligible",
            "eligibility",
            entry.index,
            entry.candidate.providerId,
            failure.message,
            failure.code,
          ),
        );
      }
      continue;
    }
    eligible.push({
      candidate: entry.candidate,
      index: entry.index,
      warnings: toWarnings(verdict.warnings),
    });
  }

  // Stage 3/4 — enrich and score. The fastest eligible candidate is the detour
  // baseline, computed once so every candidate is measured against the same
  // reference (a per-candidate baseline would make the penalty meaningless).
  const baselineDurationSeconds = eligible.reduce(
    (fastest, entry) => Math.min(fastest, entry.candidate.durationSeconds),
    Number.POSITIVE_INFINITY,
  );

  const candidates = eligible.map((entry) =>
    enrichCandidate(entry, input, baselineDurationSeconds),
  );

  // Shadow evaluation: measure recreational character for every eligible
  // candidate before diversity can remove alternatives. This deliberately does
  // not feed rankDiverseCandidates, assignRoles, or selectedIndex yet.
  const funShadowAssessments: readonly PipelineFunShadowAssessment[] =
    candidates.map((candidate) => ({
      fingerprint: candidate.fingerprint,
      providerId: candidate.provider.providerId,
      profile: candidate.provider.profile,
      assessment: assessRouteFun(candidate.score, {
        mappedGravelAffinity: mappedGravelAffinityFromEvidence(
          candidate.evidence,
          candidate.distanceMeters,
        ),
      }),
    }));

  // A timebox is preserved through the diversity cap: an in-box route (or the
  // closest valid route when none fit) must not be discarded merely because
  // three less useful discovery routes have higher fun scores.
  const timeboxPreferred = timeboxPreferredIndexes(
    candidates,
    input.discoveryTimebox,
  );
  const maximumScore = candidates.reduce(
    (maximum, candidate) => Math.max(maximum, candidate.score.total),
    0,
  );

  // Stage 5 — diversity (06 §14): a near-duplicate never reaches a rider-visible
  // card, and the visible set stops at the product's three choices. The MMR
  // selection also decides the order: the strongest distinct candidates first,
  // so the bundle reads as a ranking rather than as a provider's arrival log.
  const ranking = rankDiverseCandidates(
    candidates.map((candidate, index) => ({
      id: index,
      geometry: candidate.geometry,
      distanceMeters: candidate.distanceMeters,
      durationSeconds: candidate.durationSeconds,
      surfaceMix: unitEvidenceValue(candidate.evidence.surfaceMix),
      score: {
        total: timeboxPreferred?.has(index)
          ? maximumScore + 1 + candidate.score.total
          : candidate.score.total,
      },
      profile: candidate.provider.profile,
    })),
    {
      maxResults: PIPELINE_MAX_RESULTS,
      similarityThreshold: input.policy.duplicateSimilarityThreshold,
      diversityLambda: input.policy.diversityLambda,
    },
  );
  for (const entry of ranking.dropped) {
    const providerId = candidates[entry.index]?.provider.providerId ?? null;
    diagnostics.push(
      entry.reason === "near-duplicate"
        ? diagnostic(
            "near-duplicate",
            "diversity",
            entry.index,
            providerId,
            `Candidate ${entry.index} overlaps ${Math.round(entry.overlap * 100)}% of a route that is already shown.`,
            undefined,
            entry.overlap,
          )
        : diagnostic(
            "over-limit",
            "diversity",
            entry.index,
            providerId,
            `Candidate ${entry.index} was not shown: the planner already had ${PIPELINE_MAX_RESULTS} choices.`,
          ),
    );
  }

  const kept: PipelineCandidate[] = [];
  for (const entry of ranking.ranked) {
    const candidate = candidates[entry.index];
    if (candidate !== undefined) kept.push(candidate);
  }

  const funShadowPick = selectFunWithinDetour(
    kept.map((candidate, index) => ({
      id: index,
      durationSeconds: candidate.durationSeconds,
      distanceMeters: candidate.distanceMeters,
      score: candidate.score,
      funSignals: {
        mappedGravelAffinity: mappedGravelAffinityFromEvidence(
          candidate.evidence,
          candidate.distanceMeters,
        ),
      },
    })),
    input.policy.roleDetourEnvelopes["fast-and-fun"].maximumPct,
  );
  const funShadowCandidate =
    funShadowPick === null ? undefined : kept[funShadowPick.id];
  const funShadowSelection: PipelineFunShadowSelection | null =
    funShadowPick === null || funShadowCandidate === undefined
      ? null
      : {
          candidateIndex: funShadowPick.id,
          fingerprint: funShadowCandidate.fingerprint,
          assessment: funShadowPick.assessment,
          detourPct: funShadowPick.detourPct,
        };

  // Stage 6 — roles (06 §15). The eligible set is the only reference set: every
  // added-time comparison and the `fastest` role come from the same constraints
  // the candidates were measured against (06 §13).
  // A timeboxed loop's best ride fits the ride time (OGV-D-262): a shorter,
  // higher-scoring loop is still a choice, but never the recommendation.
  const keptInBox = timeboxPreferredIndexes(kept, input.discoveryTimebox);
  const roles = assignRoles(
    kept.map((candidate, index) => ({
      id: index,
      durationSeconds: candidate.durationSeconds,
      distanceMeters: candidate.distanceMeters,
      score: candidate.score,
    })),
    input.policy,
    undefined,
    (candidate) => keptInBox === null || keptInBox.has(candidate.id),
  );

  const scoreSelection = roles["best-ride"] ?? roles.fastest;
  const selectedIndex = selectTimeboxedCandidate(
    kept,
    input.discoveryTimebox,
    scoreSelection,
  );

  return deepFreeze({
    candidates: kept,
    funShadowAssessments,
    funShadowSelection,
    diagnostics,
    roles,
    selectedIndex,
  });
}

/**
 * A discovery timebox is a selection constraint, not a fabricated eligibility
 * claim: select the highest-scoring in-box route when possible, otherwise the
 * closest valid route. Stable candidate order breaks exact ties.
 */
function selectTimeboxedCandidate(
  candidates: readonly PipelineCandidate[],
  timebox: CandidatePipelineInput["discoveryTimebox"],
  fallback: number | null,
): number | null {
  if (candidates.length === 0) return null;
  const preferred = timeboxPreferredIndexes(candidates, timebox);
  if (preferred === null) return fallback;
  if (timebox === undefined) return fallback;
  const entries = candidates.map((candidate, index) => ({
    index,
    score: candidate.score.total,
    difference: Math.abs(candidate.durationSeconds - timebox.targetMinutes * 60),
  })).filter((entry) => preferred.has(entry.index));
  const pool = entries;
  pool.sort((left, right) => {
    if (left.score !== right.score) return right.score - left.score;
    if (left.difference !== right.difference) return left.difference - right.difference;
    return left.index - right.index;
  });
  return pool[0]?.index ?? fallback;
}

/**
 * Indexes that satisfy a budget, or the closest-duration indexes if none do.
 * `null` means ordinary non-timeboxed planning.
 */
function timeboxPreferredIndexes(
  candidates: readonly PipelineCandidate[],
  timebox: CandidatePipelineInput["discoveryTimebox"],
): ReadonlySet<number> | null {
  if (timebox === undefined) return null;
  const targetSeconds = timebox.targetMinutes * 60;
  const toleranceSeconds = timebox.toleranceMinutes * 60;
  const differences = candidates.map((candidate) =>
    Math.abs(candidate.durationSeconds - targetSeconds),
  );
  const matching = differences
    .map((difference, index) => ({ difference, index }))
    .filter((entry) => entry.difference <= toleranceSeconds);
  if (matching.length > 0) return new Set(matching.map((entry) => entry.index));
  const closest = Math.min(...differences);
  return new Set(
    differences.flatMap((difference, index) =>
      difference === closest ? [index] : [],
    ),
  );
}
