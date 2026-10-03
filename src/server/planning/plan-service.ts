/**
 * The server-side route-plan service (23-API-CONTRACTS §2–§3, §14;
 * 17-IMPLEMENTATION-PLAN Task 2.4a, goal: "server builds the provider request
 * and calls GraphHopper"; Tasks 3.1–3.3 wire the real pipeline and roles).
 *
 * One call: validate bounded input, ask the deployment's `RouteCandidateProvider`
 * for candidates through the bounded lanes of `06 §4` (one lane when the caller
 * asked for no alternatives), run the canonical `runCandidatePipeline` over the
 * answers (normalize → hard eligibility → enrich → deterministic score →
 * diversity → roles), and map the survivors into the wire bundle. Hard
 * eligibility happens **before** scoring (06 §7), so a candidate that cannot
 * legally be ridden never reaches the wire with a rank, and a near-duplicate
 * never reaches a rider-visible card (06 §14). One stub remains and is marked as
 * such: the evidence map (Wave 7); the score and the roles are real.
 *
 * Failure handling is the other half of the contract. Every failure leaves the
 * service as the §3 error object, and `message` is always OpenGravel copy: a raw
 * provider message, stack or router address is diagnostics for the server log,
 * never for a client (OGV-D-162, 13 §12–§13). A lane that fails or times out is a
 * §29 diagnostic rather than a plan failure, and only a caller cancellation ends
 * the attempt without an answer (06 §28).
 */

import { boundingBoxOf, padBox } from "@/application/route-intelligence/match";
import type {
  RoadAuthorityAssessment,
  RoadAuthorityCoordinator,
  RoadAuthorityVerdict,
} from "@/application/route-intelligence/coordinator";
import { roadAuthorityFromEnv } from "./road-authority";
import {
  createFallbackRouteProvider,
  engineCoverage,
} from "@/infrastructure/routing/graphhopper/fallback-provider";
import { newRouteCandidateId } from "@/domain/route/ids";
import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import { PA_NJ_ROUTE_POLICY_VNEXT_1 } from "@/domain/route/policy";
import { bindRoles } from "@/domain/route/roles";
import { deepFreeze } from "@/domain/util/freeze";
import { createGraphHopperProvider } from "@/infrastructure/routing/graphhopper/provider";
import { DEFAULT_GRAPHHOPPER_URL, graphHopperUrlFromEnv } from "@/infrastructure/routing/graphhopper/config";
import { profileImpliesNonPavedSurface } from "@/infrastructure/routing/graphhopper/profiles";
import { GraphHopperProviderError } from "@/infrastructure/routing/graphhopper/response-parser";
import {
  budgetedCharacterClassifier,
  jevCharacterClassifierFromEnv,
  type JevCharacterClassifier,
} from "@/infrastructure/routing/jev-fun-character";
import { jevFunJudgeFromEnv } from "@/infrastructure/routing/jev-fun-judge";
import { createFunJudge, type FunJudge } from "@/application/planner/fun-judge";
import {
  parseFunJudgeMode,
  selectBestRideWithFunJudge,
  geometryFunJudgeExtensions,
  type FunJudgeSelection,
} from "@/application/planner/fun-judge-selection";
import type { RoutePlanFunJudgeWire } from "@/application/planner/ports/route-plan-contract";
import type {
  ProviderCandidate,
  ProviderRouteRequest,
  RouteCandidateProvider,
} from "@/application/planner/route-provider";
import type {
  RoutePlanBundleWire,
  RoutePlanCandidate,
  RoutePlanDiagnosticsWire,
  RoutePlanIdentityWire,
  RoutePlanOptionsWire,
} from "@/application/planner/ports/route-plan-contract";
import { parseRoutePlanFunCharacter } from "@/application/planner/ports/route-plan-contract";
import {
  isLaneUnavailable,
  resolveLanes,
  runLanes,
  type CandidateLane,
  type LaneDiagnostic,
} from "@/application/planner/candidate-lanes";

/** Character lanes at or above which a plan asks each lane for one path first. */
const FAST_FIRST_MIN_LANES = 3;

/** The alternatives pass after fast-first converged on one ride. */
const ALTERNATIVES_LANE = (profile: string): CandidateLane => ({
  id: "alternatives",
  profile,
  purpose: "engine alternatives when the character lanes converged on one ride",
  maxCalls: 1,
  deadlineMs: 20_000,
});
import {
  runCandidatePipeline,
  type PipelineCandidate,
  type PipelineDiagnostic,
} from "@/application/planner/pipeline";
import type { ConstraintContext } from "@/domain/route/eligibility";
import { engineRoadEvidence } from "@/application/roads/engine-road-evidence";
import { knownRoadEvidence, type KnownRoadsPort } from "@/application/roads/known-roads";
import { knownRoadsFromEnv } from "@/server/roads/known-roads-db";
import type { PipelineIntent } from "@/domain/route/intent";
import {
  evaluateRoadSpans,
  type ResolvedRoadSpan,
  type SpanEvaluation,
} from "@/domain/road/spans";
import { asRoadSpanId } from "@/domain/ride/ids";
import {
  FIXTURE_NOTE,
  FIXTURE_PROVIDER_ID,
  fixturePlanModeFromEnv,
  loadFixtureCandidates,
  type FixturePlanMode,
} from "./fixture-candidates";
import { parseRoutePlanRequestBody, type ValidationIssue } from "./validation";
import {
  runFunGenerators,
  type FunCandidateGenerator,
  type FunCandidateVerdict,
  type FunGeneratorReport,
  type ProductionRoute,
} from "@/application/planner/fun-generators";
import { FUN_GENERATORS, funRouteMeasurement } from "@/application/planner/fun-generator-strategies";
import { libraryCorridorSources, type LibraryRide } from "@/application/planner/fun-generator-sources";
import {
  deploymentLibraryRides,
  funGeneratorLogLine,
  funGeneratorSettingsFromEnv,
  type FunGeneratorMode,
  type FunGeneratorSettings,
} from "./fun-generators";

/** The deployment's scoring policy; its version is the default bundle version. */
export const ROUTE_POLICY = PA_NJ_ROUTE_POLICY_VNEXT_1;

/** Compatibility export; the canonical default lives with GraphHopper config. */
export { DEFAULT_GRAPHHOPPER_URL };

/** Versions reported when the deployment does not declare its own. */
export const DEFAULT_PLAN_VERSIONS: PlanServiceVersions = {
  routePolicy: ROUTE_POLICY.version,
  graph: "unknown",
  evidence: "unknown",
};

/** Versions that participate in the planning identity (02 §13). */
export interface PlanServiceVersions {
  readonly routePolicy: string;
  readonly graph: string;
  readonly evidence: string;
}

/** One request to plan one attempt. */
export interface PlanRideInput {
  readonly identity: RoutePlanIdentityWire;
  readonly request: ProviderRouteRequest;
  readonly options?: RoutePlanOptionsWire;
}

/** The §3 error object; `details` is optional and never carries provider text. */
export interface PlanServiceError {
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
}

export type PlanServiceResult =
  | {
      readonly ok: true;
      readonly identity: RoutePlanIdentityWire;
      readonly bundle: RoutePlanBundleWire;
      readonly diagnostics: RoutePlanDiagnosticsWire;
    }
  | { readonly ok: false; readonly error: PlanServiceError };

export interface PlanServiceDeps {
  /** Injected provider; the deployment's GraphHopper adapter is the default. */
  readonly provider?: RouteCandidateProvider;
  readonly versions?: PlanServiceVersions;
  readonly now?: () => string;
  readonly signal?: AbortSignal;
  /**
   * Environment the deployment gate reads (`OGV_ROUTE_PLAN_FIXTURE`). Injectable
   * so a test can exercise both paths without mutating the process.
   */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * The rated curvy-road and Gravel Atlas catalogues (M3, OGV-D-264). The
   * deployment's SQLite files by default; empty when they are not configured.
   */
  readonly knownRoads?: KnownRoadsPort;
  /** Optional semantic classifier. `null` explicitly disables it in tests/fixtures. */
  readonly funCharacterClassifier?: JevCharacterClassifier | null;
  /**
   * FUN JUDGE for Best Ride (`OGV_JEV_FUN_JUDGE`). Defaults to the budgeted,
   * cached TypeSafe Jev judge when a key exists; `null` disables it.
   */
  readonly funJudge?: FunJudge | null;
  /**
   * Road authority (route intelligence RI-1): closures and legal access. The
   * deployment's coordinator by default, `null` when `OGV_ROAD_AUTHORITY` is off.
   */
  readonly roadAuthority?: RoadAuthorityCoordinator | null;
  /**
   * The fun-route generator family (`OGV_FUN_GENERATORS`). Defaults to the
   * environment's settings; tests and the research harness inject their own.
   */
  readonly funGenerators?: FunGeneratorSettings;
  /** The strategies to run; every strategy by default. The research harness runs one at a time. */
  readonly funGeneratorStrategies?: readonly FunCandidateGenerator[];
  /** The corridor library; the curated route library by default. */
  readonly funGeneratorLibrary?: () => Promise<readonly LibraryRide[]>;
  /** Receives every family report; the default writes one server log line. */
  readonly onFunGeneratorReport?: (report: FunGeneratorReport, mode: FunGeneratorMode) => void;
}

/**
 * Copy for every failure class the browser may see. Generic `Error` messages
 * are contractor-controlled text, so they never reach this table's replacement.
 */
const ERROR_COPY: Readonly<Record<string, string>> = {
  "no-route": "No route was found for this ride.",
  "outside-coverage": "Part of this ride is outside the routing coverage.",
  validation: "This ride could not be planned as asked.",
  "constraint-conflict": "Your constraints leave no eligible route.",
  "provider-timeout": "The routing service did not answer in time.",
  "provider-unavailable": "The routing service could not be reached.",
  network: "The routing service could not be reached.",
  cancelled: "The planning request was cancelled.",
  "missing-input": "The planning request was incomplete.",
};

/** 13 §12 codes a provider failure may name; anything else is an outage. */
const TAXONOMY_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_COPY));

/** Codes a later call with different conditions could succeed at. */
const RECOVERABLE_CODES: ReadonlySet<string> = new Set([
  "provider-timeout",
  "provider-unavailable",
  "network",
  "constraint-conflict",
]);

/** The generic code for a failure the service cannot classify. */
const UNKNOWN_FAILURE_CODE = "provider-unavailable";

function planError(
  code: string,
  message: string,
  recoverable: boolean,
  details?: Readonly<Record<string, unknown>>,
): PlanServiceError {
  return details === undefined
    ? { code, message, recoverable }
    : { code, message, recoverable, details };
}

function copyCoordinate(coordinate: Coordinate): Coordinate {
  return { lon: coordinate.lon, lat: coordinate.lat };
}

/**
 * A loop is planned as a round trip back to the origin (OGV-D-155), so the
 * server can prove trip shape from the resolved request without the authored
 * intent; the tolerance matches the domain's loop endpoint snap.
 */
const LOOP_ENDPOINT_TOLERANCE_METERS = 25;

/**
 * Eligibility failure codes that mean the answer broke a **rider constraint**
 * rather than the engine. An avoid area or an explicit blocking flag is the
 * rider's rule, so a plan that dropped every candidate for one of these is a
 * `constraint-conflict`, not an outage.
 */
const CONSTRAINT_ELIGIBILITY_CODES: ReadonlySet<string> = new Set([
  "avoid-area-violated",
  "self-loop-endpoint-snap-failure",
  "blocking-flag",
]);

/**
 * The eligibility failures a **road span** caused (Task 4.3b). They are kept
 * apart from the avoid-area set because the rider-facing consequence names the
 * span count rather than the generic constraint sentence.
 */
/** Failures an authoritative road source caused: the road is shut, not the rider's rule. */
const ROAD_AUTHORITY_ELIGIBILITY_CODES: ReadonlySet<string> = new Set([
  "road-closed",
  "access-prohibited",
]);

const SPAN_ELIGIBILITY_CODES: ReadonlySet<string> = new Set([
  "required-span-unsatisfied",
  "required-span-unavailable",
  "avoid-span-violated",
]);

function pipelineIntentFromRequest(request: ProviderRouteRequest): PipelineIntent {
  const closesLoop =
    haversine(request.origin, request.destination) <= LOOP_ENDPOINT_TOLERANCE_METERS;
  return {
    shape: closesLoop ? "loop" : "destination",
    // The request carries rider-facing scoring context because provider profiles
    // cannot reconstruct road character or personal familiarity.
    // `surface` is inferable in exactly one direction: the adventure profile is
    // reachable only through the surface override, so seeing it proves the rider
    // prefers non-paved and the surface-targeted lane is offered (OGV-D-209).
    // A client that sends its surface preference is believed (OGV-D-262);
    // an older one is still inferred from the adventure profile.
    // A client that sends its road character is believed too (OGV-D-263).
    ...(request.options.roadCharacter !== undefined
      ? { roadCharacter: request.options.roadCharacter }
      : {}),
    noveltyPreference: request.options.noveltyPreference ?? "balanced",
    ...(request.options.surfacePreference !== undefined
      ? { surface: { preference: request.options.surfacePreference } }
      : profileImpliesNonPavedSurface(request.profile)
        ? { surface: { preference: "dirt-preferred" as const } }
        : {}),
  };
}

/**
 * Resolves the request's avoid rings and road spans into constraint context.
 *
 * The builder flattens an area's rings (holes included) into one list
 * (OGV-D-156), so the original grouping is gone: each ring becomes its own
 * avoid area and a route must avoid every one of them. Road spans resolve to
 * identity here and are **measured per candidate** by {@link spanEvaluationsFor}:
 * a span's verdict depends on the route that came back, so it cannot live in a
 * request-wide context.
 */
function constraintContextFromRequest(request: ProviderRouteRequest): ConstraintContext {
  return {
    avoidAreas: request.avoidPolygons.map((ring, index) => ({
      id: `request-avoid-${index}`,
      rings: [ring],
    })),
    roadSpans: (request.roadSpans ?? []).map((span) => ({
      id: span.id,
      mode: span.mode,
    })),
  };
}

/**
 * The request's road spans as the domain engine measures them: the resolved
 * anchors and corridor travel with the declaration, exactly as the client
 * itself stores them. A span the request carried is always measured; a span
 * whose geometry was never resolved evaluates to `unavailable`, which is the
 * honest verdict and never a fabricated pass.
 */
function resolvedSpans(request: ProviderRouteRequest): readonly ResolvedRoadSpan[] {
  return (request.roadSpans ?? []).map((span) => ({
    id: asRoadSpanId(span.id),
    mode: span.mode,
    direction: span.direction,
    anchorRefs: span.anchors,
    geometry: span.corridor ?? [],
  }));
}

/** Every span's measured verdict against one returned candidate line. */
function spanEvaluationsFor(
  request: ProviderRouteRequest,
  geometry: readonly Coordinate[],
): readonly SpanEvaluation[] {
  return evaluateRoadSpans(resolvedSpans(request), { geometry });
}

/**
 * Normalizes an empty pipeline result into the §3 error object. A drop caused by
 * a rider constraint is a `constraint-conflict`; anything else (malformed
 * geometry, unusable metrics, no candidates at all) is a broken engine answer.
 */
function pipelineFailure(input: {
  readonly diagnostics: readonly PipelineDiagnostic[];
  readonly providerId: string;
  readonly candidateCount: number;
  /** How many road spans this request carried, for the span-specific copy. */
  readonly spanCount: number;
}): PlanServiceError {
  const constraintDropped = input.diagnostics.some(
    (entry) =>
      entry.code === "ineligible" &&
      entry.eligibilityCode !== undefined &&
      CONSTRAINT_ELIGIBILITY_CODES.has(entry.eligibilityCode),
  );
  const spanDropped = input.diagnostics.some(
    (entry) =>
      entry.code === "ineligible" &&
      entry.eligibilityCode !== undefined &&
      SPAN_ELIGIBILITY_CODES.has(entry.eligibilityCode),
  );
  const details = {
    providerId: input.providerId,
    candidateCount: input.candidateCount,
    dropped: input.diagnostics.length,
  };
  const closedDropped = input.diagnostics.some(
    (entry) =>
      entry.code === "ineligible" &&
      entry.eligibilityCode !== undefined &&
      ROAD_AUTHORITY_ELIGIBILITY_CODES.has(entry.eligibilityCode),
  );
  // A span-caused conflict names the span count and nothing about the engine: the
  // rider authored the spans, so the count is the fact they can act on (04 §17).
  if (spanDropped && input.spanCount > 0) {
    return planError(
      "constraint-conflict",
      noSpanRouteCopy(input.spanCount),
      true,
      { ...details, spanCount: input.spanCount },
    );
  }
  if (closedDropped && !constraintDropped) {
    return planError(
      "no-route",
      "Every route found uses a road that is closed right now.",
      true,
      details,
    );
  }
  if (constraintDropped) {
    return planError(
      "constraint-conflict",
      requiredCopy("constraint-conflict"),
      true,
      details,
    );
  }
  return planError(
    UNKNOWN_FAILURE_CODE,
    "No usable route came back for this ride.",
    true,
    details,
  );
}

/**
 * The sentence a span-caused conflict carries. It names the rider's own spans in
 * aggregate — never a span id, a provider name or a matching tolerance
 * (04 §17 forbids exposing tolerance to the rider).
 */
function noSpanRouteCopy(spanCount: number): string {
  return `No eligible route honors your ${spanCount} road span${spanCount === 1 ? "" : "s"}.`;
}

/**
 * Binds wire identity to one pipeline-approved candidate. The pipeline is pure
 * and owns no randomness and no store, so the candidate id is minted here and
 * the geometry travels inline (`RoutePlanCandidate`), which is exactly what the
 * server can prove (OGV-D-179).
 */
function toRoutePlanCandidate(candidate: PipelineCandidate): RoutePlanCandidate {
  return {
    id: newRouteCandidateId(),
    provider: candidate.provider,
    geometry: candidate.geometry.map(copyCoordinate),
    distanceMeters: candidate.distanceMeters,
    durationSeconds: candidate.durationSeconds,
    ...(candidate.instructions === undefined ? {} : { instructions: candidate.instructions }),
    ...(candidate.speedLimits === undefined ? {} : { speedLimits: candidate.speedLimits }),
    eligibility: candidate.eligibility,
    evidence: candidate.evidence,
    score: candidate.score,
    warnings: candidate.warnings,
    fingerprint: candidate.fingerprint,
  };
}

/** Normalizes any provider rejection into the §3 error object. */
function normalizePlanFailure(error: unknown, aborted: boolean): PlanServiceError {
  if (aborted) {
    // A caller cancellation is not an outage and not a route answer: the
    // browser asked to stop, and it must never be told the router failed
    // (06 §28, OGV-D-164/OGV-D-172).
    return planError("cancelled", requiredCopy("cancelled"), false);
  }
  if (error instanceof GraphHopperProviderError) {
    // The adapter's own message is OpenGravel copy by construction (OGV-D-162).
    return planError(error.code, error.message, error.recoverable);
  }
  if (typeof error === "object" && error !== null) {
    const code: unknown = (error as { readonly code?: unknown }).code;
    if (typeof code === "string" && TAXONOMY_CODES.has(code)) {
      return planError(code, requiredCopy(code), RECOVERABLE_CODES.has(code));
    }
    const status: unknown = (error as { readonly httpStatus?: unknown }).httpStatus;
    if (typeof status === "number" && status >= 500) {
      return planError(UNKNOWN_FAILURE_CODE, requiredCopy(UNKNOWN_FAILURE_CODE), true);
    }
  }
  return planError(UNKNOWN_FAILURE_CODE, requiredCopy(UNKNOWN_FAILURE_CODE), true);
}

function requiredCopy(code: string): string {
  return ERROR_COPY[code] ?? "This ride could not be planned.";
}

function validationFailure(issues: readonly ValidationIssue[]): PlanServiceError {
  const code = issues[0]?.code ?? "validation";
  return planError(
    code === "missing-input" ? "missing-input" : "validation",
    code === "missing-input"
      ? requiredCopy("missing-input")
      : requiredCopy("validation"),
    false,
    { issues },
  );
}

/** GraphHopper's hosted Directions API (the fallback, WORK-ORDER §1.2). */
export const HOSTED_GRAPHHOPPER_URL = "https://graphhopper.com/api/1";
/** Hosted calls per day; the free plan stops at 500 credits. */
const DEFAULT_HOSTED_DAILY_BUDGET = 400;

let sharedProvider: { readonly key: string; readonly provider: RouteCandidateProvider } | null = null;

/**
 * The deployment provider, built from the environment (23 §1, §12).
 *
 * With `GRAPHHOPPER_API_KEY` set, our own graph is wrapped in the hosted
 * fallback. The provider is shared across requests, because the fallback keeps
 * the day's hosted budget and the cached coverage box.
 */
export function graphHopperProviderFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RouteCandidateProvider {
  const baseUrl = graphHopperUrlFromEnv(env);
  const apiKey = env["GRAPHHOPPER_API_KEY"]?.trim() ?? "";
  const budget = Number(env["GRAPHHOPPER_HOSTED_DAILY_BUDGET"] ?? DEFAULT_HOSTED_DAILY_BUDGET);
  const cacheKey = `${baseUrl}|${apiKey}|${budget}`;
  if (sharedProvider?.key === cacheKey) return sharedProvider.provider;
  const primary = createGraphHopperProvider({ baseUrl });
  const provider = apiKey.length === 0
    ? primary
    : createFallbackRouteProvider({
        primary,
        hosted: createGraphHopperProvider({ baseUrl: HOSTED_GRAPHHOPPER_URL, hosted: { apiKey } }),
        coverage: engineCoverage({ baseUrl }),
        dailyBudget: Number.isFinite(budget) && budget >= 0 ? budget : DEFAULT_HOSTED_DAILY_BUDGET,
      });
  sharedProvider = { key: cacheKey, provider };
  return provider;
}

/**
 * The diagnostics for one attempt.
 *
 * The fixture path always states what answered, so a fixture answer is labeled
 * as one wherever the bundle is read (Task 2.4b). A live attempt reports every
 * lane that produced no answer at all in `optionalProvidersUnavailable`, as
 * `laneId:profile` machine tokens: the wire has no lane channel yet, and a lane
 * outage is exactly the §3 "optional provider unavailable" case (`OGV-D-210`).
 */
function diagnosticsFor(input: {
  readonly fixtureActive: boolean;
  readonly lanes: readonly LaneDiagnostic<PlanServiceError>[];
}): RoutePlanDiagnosticsWire {
  if (input.fixtureActive) {
    return {
      optionalProvidersUnavailable: [],
      providers: [{ providerId: FIXTURE_PROVIDER_ID, outcome: "ok", note: FIXTURE_NOTE }],
    };
  }
  return {
    optionalProvidersUnavailable: input.lanes
      .filter(isLaneUnavailable)
      .map((lane) => `${lane.laneId}:${lane.profile}`),
  };
}

/**
 * The fixture's plan answer, normalized into the §3 error object.
 *
 * `details` carries only stable machine tokens: the fixture's own failure
 * reason (never a file path, never a parse message) is what a client may see.
 */
function fixtureFailure(reason: string): PlanServiceError {
  if (reason === "cancelled") {
    return planError("cancelled", requiredCopy("cancelled"), false);
  }
  return planError("provider-unavailable", requiredCopy("provider-unavailable"), true, {
    providerId: FIXTURE_PROVIDER_ID,
    reason,
  });
}

/**
 * The candidate source for one attempt: bounded lanes over one provider.
 *
 * Fixture mode is a **test seam**, so it is deliberately narrow: it applies only
 * when the environment asks for it *and* the caller injected no provider. An
 * injected provider always wins, which keeps this seam out of every unit test
 * and out of any deployment that wires its own router.
 *
 * A live attempt runs the lanes `resolveLanes` offered (`06 §4`): the baseline
 * lane alone when alternatives were not requested, otherwise the capability- and
 * intent-filtered set. A lane that fails or times out is a diagnostic, and only
 * a caller cancellation rejects (`06 §28–§29`).
 */
async function candidateSource(input: {
  readonly fixture: FixturePlanMode | null;
  readonly provider: RouteCandidateProvider;
  readonly request: ProviderRouteRequest;
  readonly intent: PipelineIntent;
  readonly includeAlternatives: boolean;
  readonly signal: AbortSignal;
  /** The alternatives pass after a fast-first attempt: exactly these lanes. */
  readonly lanesOverride?: readonly CandidateLane[];
}): Promise<
  | {
      readonly ok: true;
      readonly candidates: readonly ProviderCandidate[];
      readonly lanes: readonly LaneDiagnostic<PlanServiceError>[];
      /** The lanes asked for single paths; alternatives may still be worth a pass. */
      readonly fastFirst?: boolean;
    }
  | { readonly ok: false; readonly error: PlanServiceError }
> {
  if (input.fixture !== null) {
    const loaded = await loadFixtureCandidates(input.fixture, input.signal);
    if (!loaded.ok) return { ok: false, error: fixtureFailure(loaded.reason) };
    // The generic planning fixture contains open point-to-point lines. For a
    // discovery request the fixture must satisfy the same closed-loop shape
    // contract as GraphHopper, or the production eligibility pipeline correctly
    // discards every candidate before the browser can exercise Loop planning.
    const candidates = input.request.discovery === undefined
      ? loaded.candidates
      : loaded.candidates.map((candidate) => ({
          ...candidate,
          geometry: [
            input.request.origin,
            ...candidate.geometry.slice(1, -1),
            input.request.origin,
          ],
        }));
    return { ok: true, candidates, lanes: [] };
  }

  const lanes =
    input.lanesOverride ??
    resolveLanes({
      capabilities: input.provider.capabilities(),
      intent: input.intent,
      requestedProfile: input.request.profile,
      includeAlternatives: input.includeAlternatives,
    });
  // Fast first (UX rework, live measure 2026-09-25): an engine alternatives
  // search costs 4–7 s on a long ride, a single path ~1.3 s. With three or more
  // character lanes the profiles already give the rider different rides, so
  // each lane asks for one path and they all run together; `planRide` fetches
  // alternatives only when that leaves fewer than two distinct choices.
  const fastFirst = input.lanesOverride === undefined && input.includeAlternatives && lanes.length >= FAST_FIRST_MIN_LANES;
  try {
    const run = await runLanes({
      lanes,
      requestFor: (profile) =>
        fastFirst
          ? { ...input.request, profile, options: { ...input.request.options, includeAlternatives: false } }
          : { ...input.request, profile },
      provider: input.provider,
      signal: input.signal,
      ...(fastFirst ? { concurrency: lanes.length } : {}),
      // The service owns the error taxonomy: a lane never reports a rejection's
      // own message, only what this classifier decides (`OGV-D-162`).
      classifyFailure: (error) => normalizePlanFailure(error, input.signal.aborted),
    });
    return { ok: true, candidates: run.candidates, lanes: run.diagnostics, fastFirst };
  } catch (error) {
    return { ok: false, error: normalizePlanFailure(error, input.signal.aborted) };
  }
}

/**
 * Plans one request. Validates first (so a bad body never reaches the router),
 * then asks the provider, then maps what came back. Never throws: every failure
 * is a `PlanServiceResult`.
 */
/** One budgeted, cached classifier per server process, so readings are reused across plans. */
let environmentClassifier: { readonly key: string; readonly classifier: JevCharacterClassifier | null } | null = null;
function environmentCharacterClassifier(
  env: Readonly<Record<string, string | undefined>>,
): JevCharacterClassifier | null {
  const key = env["JEV_API_KEY"]?.trim() ?? "";
  if (environmentClassifier?.key !== key) {
    const inner = jevCharacterClassifierFromEnv(env);
    environmentClassifier = { key, classifier: inner === null ? null : budgetedCharacterClassifier(inner) };
  }
  return environmentClassifier.classifier;
}

/** One budgeted, cached FUN JUDGE per server process (shared call budget and cache). */
let environmentJudge: { readonly key: string; readonly judge: FunJudge | null } | null = null;
function environmentFunJudge(env: Readonly<Record<string, string | undefined>>): FunJudge | null {
  const key = env["JEV_API_KEY"]?.trim() ?? "";
  if (environmentJudge?.key !== key) {
    const port = jevFunJudgeFromEnv(env);
    environmentJudge = { key, judge: port === null ? null : createFunJudge(port) };
  }
  return environmentJudge.judge;
}

function funJudgeWire(
  selection: FunJudgeSelection,
  routeIds: readonly string[],
): RoutePlanFunJudgeWire | undefined {
  const diagnostic = selection.diagnostic;
  if (diagnostic === null) return undefined;
  const id = (index: number): string | undefined => routeIds[index];
  const deterministicRouteId = id(diagnostic.deterministicIndex);
  const selectedRouteId = id(diagnostic.selectedIndex);
  if (deterministicRouteId === undefined || selectedRouteId === undefined) return undefined;
  return {
    mode: diagnostic.mode,
    outcome: diagnostic.outcome,
    applied: diagnostic.applied,
    deterministicRouteId,
    jevRouteId: diagnostic.jevIndex === null ? null : id(diagnostic.jevIndex) ?? null,
    selectedRouteId,
    shortlistSize: diagnostic.shortlist.length,
    excluded: diagnostic.excluded.flatMap((entry) => {
      const routeId = id(entry.index);
      return routeId === undefined ? [] : [{ routeId, reason: entry.reason }];
    }),
    confidence: diagnostic.confidence,
    margin: diagnostic.margin,
    orderAgreement: diagnostic.orderAgreement,
    model: diagnostic.model,
    calls: diagnostic.calls,
    cached: diagnostic.cached,
    latencyMs: diagnostic.latencyMs,
    why: diagnostic.why,
    addedTimePct: diagnostic.addedTimePct,
  };
}

export async function planRide(
  input: PlanRideInput,
  deps: PlanServiceDeps = {},
): Promise<PlanServiceResult> {
  const parsed = parseRoutePlanRequestBody(input);
  if (!parsed.ok) return { ok: false, error: validationFailure(parsed.issues) };

  const versions = deps.versions ?? DEFAULT_PLAN_VERSIONS;
  const provider = deps.provider ?? graphHopperProviderFromEnv();
  const knownRoads = deps.knownRoads ?? knownRoadsFromEnv(deps.env ?? process.env);
  const signal = deps.signal ?? new AbortController().signal;
  const fixture =
    deps.provider === undefined
      ? fixturePlanModeFromEnv(deps.env ?? process.env)
      : null;

  const intent = pipelineIntentFromRequest(parsed.value.request);
  const source = await candidateSource({
    fixture,
    provider,
    request: parsed.value.request,
    intent,
    // An explicit request-level option wins; the provider-level flag is the
    // fallback because that is the one the browser sets today (`OGV-D-211`).
    includeAlternatives:
      parsed.value.options?.includeAlternatives ??
      parsed.value.request.options.includeAlternatives,
    signal,
  });
  if (!source.ok) return { ok: false, error: source.error };
  let candidates = source.candidates;
  let laneDiagnostics = source.lanes;

  // Lane A (ROUTE-INTELLIGENCE-PROVIDER-MESH §6): closures and legal access,
  // fetched once per plan for the candidates' corridor inside a strict
  // deadline, then checked per candidate. A source that did not answer leaves
  // closures unknown and says so; it never reads as clear.
  const roadAuthority = deps.roadAuthority === undefined
    ? roadAuthorityFromEnv(deps.env ?? process.env)
    : deps.roadAuthority;
  const assessRoads = async (from: readonly ProviderCandidate[]): Promise<RoadAuthorityAssessment | null> => {
    if (roadAuthority === null || roadAuthority.sources.length === 0) return null;
    const points = from.flatMap((candidate) => candidate.geometry);
    if (points.length === 0) return null;
    return roadAuthority.assess(padBox(boundingBoxOf(points), 500), signal);
  };
  let roads = await assessRoads(candidates);
  const verdicts = new WeakMap<ProviderCandidate, RoadAuthorityVerdict>();
  const roadVerdict = (candidate: ProviderCandidate): RoadAuthorityVerdict | null => {
    if (roads === null) return null;
    let verdict = verdicts.get(candidate);
    if (verdict === undefined) {
      verdict = roads.evaluate(candidate.geometry);
      verdicts.set(candidate, verdict);
    }
    return verdict;
  };

  const rank = (
    from: readonly ProviderCandidate[],
    verdictFor: (candidate: ProviderCandidate) => RoadAuthorityVerdict | null = roadVerdict,
  ) => runCandidatePipeline({
    candidates: from,
    intent,
    policy: ROUTE_POLICY,
    // What the engine knows about the roads under each line: surface mix, the
    // backroad share and curvature (M3, OGV-D-263).
    evidenceFor: (candidate) => {
      const verdict = verdictFor(candidate);
      return {
        ...engineRoadEvidence(candidate.roadSummary, intent.surface?.preference ?? "mixed"),
        ...knownRoadEvidence(candidate.geometry, knownRoads),
        ...(verdict === null ? {} : { closures: verdict.evidence.closures, access: verdict.evidence.access }),
      };
    },
    additionalEligibilityFor: (candidate) => {
      const verdict = verdictFor(candidate);
      return verdict === null
        ? { eligible: true, failures: [], warnings: [] }
        : { eligible: verdict.failures.length === 0, failures: verdict.failures, warnings: verdict.warnings };
    },
    // A loop's ride time is its budget (OGV-D-262): the discovery request is
    // only ever sent for a loop, so this never touches point-to-point planning.
    ...(parsed.value.request.discovery === undefined
      ? {}
      : { discoveryTimebox: parsed.value.request.discovery }),
    constraintContext: constraintContextFromRequest(parsed.value.request),
    // Each candidate is measured against its own returned line: a span verdict
    // belongs to the route that was actually produced (06 §8).
    constraintContextFor: (candidate): ConstraintContext => ({
      ...constraintContextFromRequest(parsed.value.request),
      spanEvaluations: spanEvaluationsFor(parsed.value.request, candidate.geometry),
    }),
    // Trace adherence is measured per candidate against the corridor the client
    // resolved (06 §18). The builder always sends it, fitted to the wire budget
    // (OGV-D-285); only an older client leaves the anchors as the reference — a
    // coarser measurement of the same drawing, never a missing trace.
    ...(parsed.value.request.sketch === undefined
      ? {}
      : {
          sketch: {
            corridor:
              parsed.value.request.sketch.corridor ??
              parsed.value.request.sketch.anchors,
          },
        }),
  });
  let pipeline = rank(candidates);
  if (source.fastFirst === true && pipeline.candidates.length < 2) {
    // The profiles converged on one ride: ask the engine for alternatives to
    // the rider's own character, and rank everything together.
    const more = await candidateSource({
      fixture,
      provider,
      request: parsed.value.request,
      intent,
      includeAlternatives: true,
      signal,
      lanesOverride: [ALTERNATIVES_LANE(parsed.value.request.profile)],
    });
    if (more.ok && more.candidates.length > 0) {
      candidates = [...candidates, ...more.candidates];
      laneDiagnostics = [...laneDiagnostics, ...more.lanes];
      // The alternatives may leave the first corridor; the feeds are cached.
      roads = await assessRoads(candidates);
      pipeline = rank(candidates);
    }
  }
  // The fun-route generator family (routing research Phase 7). Off by default;
  // in shadow it runs after the answer and cannot touch the bundle.
  const funSettings = deps.funGenerators ?? funGeneratorSettingsFromEnv(deps.env ?? process.env);
  if (funSettings.mode !== "off" && fixture === null && pipeline.candidates.length > 0) {
    const report = (mode: FunGeneratorMode) => (result: FunGeneratorReport): void => {
      if (deps.onFunGeneratorReport !== undefined) deps.onFunGeneratorReport(result, mode);
      else console.info(funGeneratorLogLine(mode, parsed.value.request.requestId, result));
    };
    const bestIndex = pipeline.roles["best-ride"] ?? 0;
    const ordered = [
      ...pipeline.candidates.slice(bestIndex, bestIndex + 1),
      ...pipeline.candidates.filter((_, index) => index !== bestIndex),
    ];
    const production: ProductionRoute[] = ordered.map((candidate, index) => ({
      id: `production:${index}`,
      geometry: candidate.geometry,
      measurement: funRouteMeasurement(candidate),
    }));
    // The same canonical gate the plan used: closures and access for the new
    // line's own corridor, avoid areas, spans and every hard eligibility rule.
    const verify = async (candidate: ProviderCandidate): Promise<FunCandidateVerdict> => {
      const own = await assessRoads([candidate]);
      const single = rank([candidate], () => own?.evaluate(candidate.geometry) ?? null);
      const kept = single.candidates[0];
      if (kept === undefined) {
        return {
          eligible: false,
          codes: single.diagnostics.flatMap((entry) => (entry.eligibilityCode === undefined ? [] : [entry.eligibilityCode])),
        };
      }
      return { eligible: true, measurement: funRouteMeasurement(kept) };
    };
    const run = async (runSignal: AbortSignal): Promise<FunGeneratorReport> => {
      const rides = await (deps.funGeneratorLibrary ?? deploymentLibraryRides)();
      return runFunGenerators({
        context: {
          request: parsed.value.request,
          production,
          sources: libraryCorridorSources(parsed.value.request, rides),
        },
        generators: deps.funGeneratorStrategies ?? FUN_GENERATORS,
        provider,
        budget: funSettings.budget,
        allocation: funSettings.allocation,
        verify,
        signal: runSignal,
        duplicateSimilarityThreshold: ROUTE_POLICY.duplicateSimilarityThreshold,
      });
    };
    if (funSettings.mode === "shadow") {
      // Detached: the rider's answer never waits for, or depends on, the family.
      void run(new AbortController().signal).then(report("shadow"), () => undefined);
    } else if (!signal.aborted) {
      try {
        const result = await run(signal);
        report("on")(result);
        if (result.pool.length > 0) {
          candidates = [...candidates, ...result.pool.map((entry) => entry.candidate)];
          roads = await assessRoads(candidates);
          pipeline = rank(candidates);
        }
      } catch {
        // A cancelled or failed family leaves the production answer untouched.
      }
    }
  }

  if (pipeline.candidates.length === 0) {
    // A lane that could not answer at all is the more informative failure: it
    // says *why* there is nothing to rank, and it carries the §3 taxonomy code
    // the provider reported (`no-route`, `provider-timeout`, …). Otherwise the
    // adapter already normalized a zero-path answer, so an empty result *here*
    // means every candidate it returned was unusable or ineligible: a broken
    // engine or an unsatisfiable constraint, never a durable "no route here".
    const laneFailure = laneDiagnostics.find((lane) => lane.failure !== null)?.failure;
    if (laneFailure !== undefined && laneFailure !== null) {
      return { ok: false, error: laneFailure };
    }
    return {
      ok: false,
      error: pipelineFailure({
        diagnostics: pipeline.diagnostics,
        providerId: fixture === null ? provider.id : FIXTURE_PROVIDER_ID,
        candidateCount: candidates.length,
        spanCount: parsed.value.request.roadSpans?.length ?? 0,
      }),
    };
  }

  const mapped = pipeline.candidates.map(toRoutePlanCandidate);
  // FUN JUDGE (default off). In `on` mode a confident Jev preference among the
  // eligible, in-budget candidates becomes Best Ride; every other outcome —
  // including any failure here — keeps the deterministic roles.
  const env = deps.env ?? process.env;
  const funJudgeMode = parseFunJudgeMode(env["OGV_JEV_FUN_JUDGE"]);
  let judged: FunJudgeSelection = {
    roles: pipeline.roles,
    selectedIndex: pipeline.selectedIndex,
    diagnostic: null,
    request: null,
  };
  if (funJudgeMode !== "off" && !signal.aborted) {
    try {
      judged = await selectBestRideWithFunJudge({
        pipeline,
        intent,
        avoidHighways: parsed.value.request.options.avoidHighways,
        policy: ROUTE_POLICY,
        ...(parsed.value.request.discovery === undefined
          ? {}
          : { discoveryTimebox: parsed.value.request.discovery }),
        mode: funJudgeMode,
        judge: deps.funJudge === undefined ? environmentFunJudge(env) : deps.funJudge,
        extensions: geometryFunJudgeExtensions,
        signal,
      });
    } catch {
      // Advisory failure never changes the deterministic answer.
    }
  }
  const funJudge = funJudgeWire(judged, mapped.map((candidate) => candidate.id));
  // The pipeline assigns roles by kept index because it mints no ids; binding
  // them here is the step that turns them into wire identities.
  const roles = bindRoles(judged.roles, mapped);
  const selectedRouteId = roles["best-ride"] ?? roles.fastest;
  if (selectedRouteId === null) {
    // Unreachable by construction: `assignRoles` fills `fastest` and `best-ride`
    // from the first candidate of a non-empty set. Kept as an explicit guard so a
    // future role policy that selects nothing fails closed instead of shipping a
    // bundle without a route.
    return {
      ok: false,
      error: planError(
        "constraint-conflict",
        requiredCopy("constraint-conflict"),
        true,
      ),
    };
  }

  const bundle: RoutePlanBundleWire = deepFreeze({
    policyVersion: versions.routePolicy,
    graphVersion: versions.graph,
    evidenceVersion: versions.evidence,
    // The pipeline's order is the recommendation order: 06 §14's MMR selection
    // puts the strongest distinct candidates first, so the first candidate is the
    // automatic selection.
    candidates: mapped,
    roles,
    selectedRouteId,
    selectionSource: "automatic",
  });

  // The model only sees the aggregate assessment of the deterministic shadow
  // winner. A missing key, sparse evidence, timeout or malformed answer cannot
  // change the bundle, its roles, or the success of the planning request.
  let funCharacter: RoutePlanDiagnosticsWire["funCharacter"];
  const shadow = pipeline.funShadowSelection;
  if (shadow !== null && !signal.aborted) {
    try {
      const classifier = deps.funCharacterClassifier === undefined
        ? environmentCharacterClassifier(deps.env ?? process.env)
        : deps.funCharacterClassifier;
      const reading = await classifier?.classify(shadow.assessment, signal);
      if (reading !== undefined && reading !== null) {
        funCharacter = parseRoutePlanFunCharacter({
          fingerprint: shadow.fingerprint,
          label: reading.label,
          confidence: reading.confidence,
          model: reading.model,
          policyVersion: shadow.assessment.policyVersion,
        }) ?? undefined;
      }
    } catch {
      // Advisory failure is deliberately absent from the answer.
    }
  }

  return {
    ok: true,
    identity: parsed.value.identity,
    bundle,
    diagnostics: {
      ...diagnosticsFor({ fixtureActive: fixture !== null, lanes: laneDiagnostics }),
      ...(funCharacter === undefined ? {} : { funCharacter }),
      ...(funJudge === undefined ? {} : { funJudge }),
    },
  };
}
