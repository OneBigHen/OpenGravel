/**
 * The PlanningSession controller — authority #2
 * (02-ARCHITECTURE-CONTRACT §2.2/§9/§10/§13, 06-ROUTING-AND-DECISION-ENGINE
 * §4–§5/§28–§29, 21-RED-TEAM-AND-FAILURE-MODES §7–§8).
 *
 * One controller answers one RideDocument revision at a time. It owns exactly
 * four things and refuses to own anything else:
 *
 * 1. **Generation ownership.** `begin` increments the planning generation
 *    *synchronously and first*, before it aborts the previous request and
 *    before any asynchronous work starts. Ownership therefore moves before
 *    anyone can observe the old attempt ending, and a late result from an
 *    older generation fails the identity check instead of writing state.
 * 2. **Fenced commits.** Every state write — bundle, selection, phase,
 *    diagnostic, notice — passes one internal `isCurrent(run)` check that
 *    compares the full `(rideId, rideRevision, generation)` identity. There is
 *    no second path into the state.
 * 3. **Last-good retention.** A new revision keeps the previous bundle and the
 *    rider's selection until (or unless) the new attempt commits its own; a
 *    failure or a cancellation never clears them, so the map is never blanked
 *    by a replan.
 * 4. **Honest cancellation.** Cancellation aborts the request through the
 *    caller-owned `AbortController`, records `cancelled` for the providers that
 *    were still in flight, and ends the attempt as `cancelled`. It is never
 *    converted into a failure and never into a success, and the work that
 *    finishes after it is ignored (06 §28, 21 §8).
 *
 * ## Progressive primary and alternatives
 *
 * Providers are queried **concurrently with one canonical request** (06 §5):
 * the first provider to answer with a usable candidate set commits the primary
 * bundle (`primary-ready`), and the remaining answers are alternatives merged
 * into the same generation (`alternatives-loading` → `ready`). Lanes, budgets
 * and a per-lane deadline belong to the Wave-3 coordinator (06 §4); here the
 * `ready` boundary is "every provider settled", which is the honest boundary
 * the session can prove today.
 *
 * ## What this task deliberately does not decide
 *
 * The controller is a fence, not a pipeline. Normalization, hard eligibility,
 * scoring, dedupe and roles are 02 §10's application pipeline (Task 3.1–3.3);
 * they arrive through `CandidatePipeline`. Until they land, the **documented
 * placeholder** below produces candidates that are explicitly unscored and
 * explicitly eligible, and automatic selection is a placeholder rule: the
 * first eligible candidate of the highest-priority provider (provider order).
 * Wave 3 replaces both, and every placeholder is marked in the data itself
 * (`policyVersion: "unscored-stub"`, `emptyRouteRoles()`).
 */

import { OFFLINE_ROUTING_WARNING } from "@/application/offline/offline-route-fallback";
import type { GeometryStore } from "@/application/geometry/geometry-store";
import type { GeometryRef, RideId } from "@/domain/ride/ids";
import type { Coordinate, RideIntent } from "@/domain/ride/types";
import { newRouteCandidateId, type RouteCandidateId } from "@/domain/route/ids";
import type {
  RouteBundle,
  RouteCandidate,
  RouteScore,
  RouteScoreComponents,
  RouteRoles,
  RouteSelectionSource,
} from "@/domain/route/types";
import { deepFreeze } from "@/domain/util/freeze";
import {
  buildProviderRequest,
  type PlanRequestContext,
  type PlanRequestResult,
  type PlanRequestVersions,
} from "./build-plan-request";
import {
  emptyPlanningSession,
  emptyRouteRoles,
  type PlanningError,
  type PlanningErrorCode,
  type PlanningIdentity,
  type PlanningPhase,
  type PlanningSessionSnapshot,
  type ProviderDiagnostic,
} from "./planning-session";
import type {
  ProviderCandidate,
  ProviderCandidateSet,
  ProviderRouteRequest,
  RouteCandidateProvider,
} from "./route-provider";

/**
 * What the controller cannot invent for itself: how to resolve stored avoid
 * geometry and which internal profile an intent maps to (OGV-D-153,
 * OGV-D-163). A composition root injects the deployment's profile mapping,
 * because application code may not import an adapter.
 */
export interface PlanningRequestContext {
  readonly resolveGeometry: PlanRequestContext["resolveGeometry"];
  readonly profileFor?: PlanRequestContext["profileFor"];
  /**
   * Whether the single canonical call should ask for alternative paths
   * (`true` by default: progressive choice must not need a second round trip).
   */
  readonly includeAlternatives?: boolean;
}

/**
 * Everything the Wave-3 candidate pipeline gets to decide about one provider's
 * answer: normalization, hard eligibility, score, fingerprint and warnings
 * (02 §10, 06 §7–§9/§14).
 */
export interface CandidatePipelineInput {
  /** The attempt this answer belongs to; a late answer never gets here. */
  readonly identity: PlanningIdentity;
  readonly versions: PlanRequestVersions;
  readonly request: ProviderRouteRequest;
  /** Enabled avoid areas whose geometry the builder could not resolve. */
  readonly unresolvedRefs: readonly GeometryRef[];
  readonly providerId: string;
  readonly candidates: readonly ProviderCandidate[];
}

/**
 * The pipeline seam. Implementations are pure with respect to the session:
 * they receive the provider's own candidates and return bundle candidates that
 * own everything the session stores (ids, geometry handles, eligibility, score,
 * warnings). They must return plain data, because a committed bundle is deeply
 * frozen.
 *
 * A rejection is a **candidate loss for that provider**, not a plan failure:
 * one broken answer must not delete another provider's usable route.
 */
export interface CandidatePipeline {
  normalize(
    input: CandidatePipelineInput,
  ): Promise<readonly RouteCandidate[]> | readonly RouteCandidate[];
}

/** One request to answer one revision. */
export interface BeginPlanningInput {
  readonly rideId: RideId;
  readonly rideRevision: number;
  readonly intent: RideIntent;
  readonly versions: PlanRequestVersions;
}

/**
 * The session facade. `snapshot()` is the only read; every mutation is a
 * command, and `begin` never rejects — a planning failure is reported through
 * the snapshot's `error`, never as an exception a caller could forget to catch.
 */
export interface PlanningController {
  snapshot(): PlanningSessionSnapshot;
  /**
   * Starts a new attempt, takes ownership of the session and resolves when that
   * attempt is no longer the owner (it settled, or a newer `begin` superseded
   * it). A no-op after `dispose()`.
   */
  begin(input: BeginPlanningInput): Promise<void>;
  /**
   * Aborts the in-flight attempt, keeps the committed and last-good bundles and
   * the rider's selection, and ends as `cancelled`. A no-op when nothing is in
   * flight: a settled attempt is never retroactively cancelled.
   */
  cancel(): void;
  /** Rider selection. Locks `selectionSource` to `"rider"` (06 §15). */
  selectRoute(routeId: RouteCandidateId): void;
  /** Detaches the session: aborts in-flight work and ignores later commands. */
  dispose(): void;
}

interface PlanningControllerBaseDeps {
  /**
   * Candidate sources in **priority order**: index 0 is the baseline provider
   * (06 §2–§4) and automatic selection prefers its candidates.
   */
  readonly providers: readonly RouteCandidateProvider[];
  readonly requestContext: PlanningRequestContext;
  /** Injected clock (ISO-8601); the wall clock is the default. */
  readonly now?: () => string;
  /** Snapshot notification for a surface; it must not throw. */
  readonly onUpdate?: (snapshot: PlanningSessionSnapshot) => void;
}

/**
 * A pipeline is required, or a geometry store is: the placeholder pipeline
 * mints real `GeometryRef`s by storing candidate geometry, and the real
 * pipeline (Wave 3) supplies its own. The union makes that a compile-time
 * obligation instead of a runtime surprise.
 */
export type PlanningControllerDeps = PlanningControllerBaseDeps &
  (
    | {
        readonly pipeline: CandidatePipeline;
        readonly geometryStore?: GeometryStore;
      }
    | {
        readonly pipeline?: undefined;
        readonly geometryStore: GeometryStore;
      }
  );

export interface StubCandidatePipelineOptions {
  /** Where candidate geometry is written; the handle is what a bundle holds. */
  readonly geometryStore: GeometryStore;
  readonly now?: () => string;
}

/** Marks a score that no scoring policy produced (Task 3.1 replaces it). */
export const UNSCORED_POLICY_VERSION = "unscored-stub";

/** Note when the builder reported avoid areas it could not resolve. */
export const NOTE_UNRESOLVED_AVOID_AREAS = "unresolved-avoid-areas";

/** Note when the pipeline rejected a provider's answer we did receive. */
export const NOTE_NORMALIZATION_FAILED = "normalization-failed";

/**
 * §12 error codes that mean the engine **answered** — it processed the request
 * and refused. They are not an outage, so they must not be reported as
 * `provider-unavailable` (06 §29): a region with no legal route is a `no-route`
 * answer, not a broken deployment.
 */
const ANSWERED_FAILURE_CODES: readonly string[] = [
  "no-route",
  "outside-coverage",
  "validation",
  "constraint-conflict",
  "missing-input",
];

/** The engine-side timeout is its own diagnostic outcome (OGV-D-164). */
const TIMEOUT_CODE = "provider-timeout";

function unscoredComponents(): RouteScoreComponents {
  const component = (key: string): RouteScoreComponents["curvature"] => ({
    input: null,
    weight: 0,
    contribution: 0,
    explanationKey: `unscored.${key}`,
    evidenceStatus: "unknown",
  });
  return {
    curvature: component("curvature"),
    backroad: component("backroad"),
    surfaceFit: component("surfaceFit"),
    elevation: component("elevation"),
    traffic: component("traffic"),
    junctionFriction: component("junctionFriction"),
    novelty: component("novelty"),
    closureRisk: component("closureRisk"),
    timeCost: component("timeCost"),
    confidence: component("confidence"),
  };
}

function unscoredRoute(): RouteScore {
  return {
    policyVersion: UNSCORED_POLICY_VERSION,
    total: 0,
    components: unscoredComponents(),
  };
}

function copyCoordinate(coordinate: Coordinate): Coordinate {
  return { lon: coordinate.lon, lat: coordinate.lat };
}

/**
 * The provider's own stable id when the adapter supplied one (OGV-D-167),
 * otherwise a deterministic descriptor. Dedupe across providers is 06 §14 and
 * belongs to Wave 3.2; this value only has to be stable and comparable.
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

async function stubCandidate(
  candidate: ProviderCandidate,
  index: number,
  geometryStore: GeometryStore,
  now: () => string,
): Promise<RouteCandidate> {
  const record = await geometryStore.put(
    { kind: "line", coordinates: candidate.geometry.map(copyCoordinate) },
    { kind: "route", now: now() },
  );
  return deepFreeze<RouteCandidate>({
    id: newRouteCandidateId(),
    provider: { providerId: candidate.providerId, profile: candidate.profile },
    geometryRef: record.geometryRef,
    distanceMeters: candidate.distanceMeters,
    durationSeconds: candidate.durationSeconds,
    ...(candidate.instructions === undefined ? {} : { instructions: candidate.instructions }),
    ...(candidate.speedLimits === undefined ? {} : { speedLimits: candidate.speedLimits }),
    eligibility: { eligible: true, failures: [] },
    // A candidate the server pipeline assessed keeps that verdict (OGV-D-263);
    // anything else stays explicitly unscored.
    evidence: candidate.assessment?.evidence ?? {},
    score: candidate.assessment?.score ?? unscoredRoute(),
    // A candidate planned on the device says so: nothing on the server saw it.
    warnings:
      candidate.assessment?.warnings ??
      (candidate.providerMetadata?.["offlineRouting"] === true ? [OFFLINE_ROUTING_WARNING] : []),
    fingerprint: candidateFingerprint(candidate, index),
  });
}

/**
 * The documented placeholder pipeline (Wave 3.1 replaces it).
 *
 * It stores each candidate's full-resolution geometry and returns a candidate
 * whose eligibility is `eligible: true` and whose score is explicitly
 * `unscored-stub`. It performs **no** verification and **no** scoring: it
 * claims no knowledge rather than fake precision (`evidence` is empty, roles
 * are null, instructions are dropped). Hard eligibility is therefore not yet
 * enforced in a browser flow — that is Task 3.1's job, and the placeholder is
 * marked in the data so nothing downstream can mistake it for a verdict.
 */
export function createStubCandidatePipeline(
  options: StubCandidatePipelineOptions,
): CandidatePipeline {
  const now = options.now ?? ((): string => new Date().toISOString());
  return {
    async normalize(input: CandidatePipelineInput): Promise<readonly RouteCandidate[]> {
      return Promise.all(
        input.candidates.map((candidate, index) =>
          stubCandidate(candidate, index, options.geometryStore, now),
        ),
      );
    },
  };
}

/** The roles a run's candidates earned (06 §15); every other role stays null. */
function rolesFor(run: Run): RouteRoles {
  const eligible = run.candidates.filter((candidate) => candidate.eligibility.eligible);
  const hinted = (key: "bestRide" | "lowerWorkload"): RouteCandidateId | null =>
    eligible.find((candidate) => run.roleHints.get(candidate.fingerprint)?.[key] === true)?.id ??
    null;
  let fastest: RouteCandidate | null = null;
  for (const candidate of eligible) {
    if (!Number.isFinite(candidate.durationSeconds) || candidate.durationSeconds <= 0) continue;
    if (fastest === null || candidate.durationSeconds < fastest.durationSeconds) fastest = candidate;
  }
  return {
    ...emptyRouteRoles(),
    "best-ride": hinted("bestRide"),
    fastest: fastest?.id ?? null,
    "lower-workload": hinted("lowerWorkload"),
  };
}

interface InternalState {
  rideId: RideId | null;
  rideRevision: number;
  generation: number;
  phase: PlanningPhase;
  committed: RouteBundle | null;
  lastGood: RouteBundle | null;
  selectionSource: RouteSelectionSource;
  selectedRouteId: RouteCandidateId | null;
  error: PlanningError | null;
  /** Keyed by provider id; rendered in provider (priority) order. */
  diagnostics: Map<string, ProviderDiagnostic>;
  startedAt: string;
  settledAt: string | null;
}

/** One attempt: everything whose lifetime is the generation (fenced). */
interface Run {
  readonly generation: number;
  readonly rideId: RideId;
  readonly rideRevision: number;
  readonly versions: PlanRequestVersions;
  readonly controller: AbortController;
  readonly pending: Set<string>;
  /** Providers that answered (resolved), even if the pipeline then refused. */
  readonly answered: Set<string>;
  /**
   * The code each provider *answered* with, keyed by provider id. A rejection with
   * one of {@link ANSWERED_FAILURE_CODES} is an answer, not an outage, so the code
   * has to survive `receiveFailure` for `normalizeFailure` to prefer it.
   */
  readonly answeredCodes: Map<string, string>;
  readonly candidates: RouteCandidate[];
  /**
   * Role hints a provider attached to its candidates (the server pipeline's
   * best-ride / lower-workload assignment), keyed by candidate fingerprint so
   * they survive normalization.
   */
  readonly roleHints: Map<string, { readonly bestRide: boolean; readonly lowerWorkload: boolean }>;
  cancelled: boolean;
  finished: boolean;
  /** Resolves `begin`; called exactly once per run. */
  readonly closed: () => void;
}

/** Resolves a `begin` promise when its run is closed (settled, superseded, disposed). */
function closedSignal(): { readonly promise: Promise<void>; close: () => void } {
  let close: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    close = resolve;
  });
  return { promise, close };
}

/** The candidate's own provider code, when the rejection carries one. */
/**
 * The order in which a provider's *answer* wins the attempt, most actionable
 * first.
 *
 * A provider that answers "your constraints leave no eligible route" has told the
 * rider what to change; one that answers "no route here" has not. When providers
 * disagree — or when the only answered code is the generic one — the most specific
 * answer is the honest one to surface, and a rider-facing constraint problem must
 * never reach the rider as "no legal route", which reads as a fact about the world
 * rather than about their own areas and points (04 §18, 06 §29).
 *
 * Recorded as OGV-D-235; the diagnostic per provider still carries its own code, so
 * nothing is lost by choosing one for the surface.
 */
const ANSWER_PRIORITY: readonly PlanningErrorCode[] = [
  "constraint-conflict",
  "no-route",
];

function providerFailureCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code: unknown = (error as { readonly code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

function failureNote(code: string | null): string {
  return `rejection:${code ?? "unknown"}`;
}

class PlanningSessionController implements PlanningController {
  private readonly providers: readonly RouteCandidateProvider[];
  private readonly requestContext: PlanningRequestContext;
  private readonly pipeline: CandidatePipeline;
  private readonly now: () => string;
  private readonly onUpdate:
    | ((snapshot: PlanningSessionSnapshot) => void)
    | undefined;
  private state: InternalState;
  private run: Run | null = null;
  private disposed = false;

  constructor(deps: PlanningControllerDeps, pipeline: CandidatePipeline) {
    this.providers = deps.providers;
    this.requestContext = deps.requestContext;
    this.pipeline = pipeline;
    this.now = deps.now ?? ((): string => new Date().toISOString());
    this.onUpdate = deps.onUpdate;
    const empty = emptyPlanningSession(null);
    this.state = {
      rideId: empty.identity.rideId,
      rideRevision: empty.identity.rideRevision,
      generation: empty.identity.planningGeneration,
      phase: empty.phase,
      committed: null,
      lastGood: null,
      selectionSource: empty.selectionSource,
      selectedRouteId: empty.selectedRouteId,
      error: null,
      diagnostics: new Map<string, ProviderDiagnostic>(),
      startedAt: empty.startedAt,
      settledAt: null,
    };
  }

  /* ---------------------------------------------------------------------
   * Read
   * ------------------------------------------------------------------ */

  snapshot(): PlanningSessionSnapshot {
    const diagnostics: ProviderDiagnostic[] = [];
    for (const provider of this.providers) {
      const diagnostic = this.state.diagnostics.get(provider.id);
      if (diagnostic !== undefined) diagnostics.push({ ...diagnostic });
    }
    return deepFreeze<PlanningSessionSnapshot>({
      identity: {
        rideId: this.state.rideId,
        rideRevision: this.state.rideRevision,
        planningGeneration: this.state.generation,
      },
      phase: this.state.phase,
      lastGoodBundle: this.state.lastGood,
      committedBundle: this.state.committed,
      selectionSource: this.state.selectionSource,
      selectedRouteId: this.state.selectedRouteId,
      error: this.state.error === null ? null : { ...this.state.error },
      diagnostics,
      startedAt: this.state.startedAt,
      settledAt: this.state.settledAt,
    });
  }

  /* ---------------------------------------------------------------------
   * Commands
   * ------------------------------------------------------------------ */

  begin(input: BeginPlanningInput): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const previous = this.run;
    // The values a replan must not lose, read before the new attempt state
    // replaces the old one.
    const retainedLastGood = this.state.lastGood;
    const retainedSelectionSource = this.state.selectionSource;
    const retainedSelectedRouteId = this.state.selectedRouteId;
    // (a) Ownership moves first and synchronously: the new generation is the
    // owner before anything else happens, so nothing can observe a window in
    // which the old attempt still owns the session.
    const generation = this.state.generation + 1;
    this.state = {
      rideId: input.rideId,
      rideRevision: input.rideRevision,
      generation,
      // (c) Last-good and the rider's selection are carried over untouched:
      // replanning must not blank the map or lose a choice.
      lastGood: retainedLastGood,
      selectionSource: retainedSelectionSource,
      selectedRouteId: retainedSelectedRouteId,
      phase: "validating",
      committed: null,
      error: null,
      diagnostics: new Map<string, ProviderDiagnostic>(),
      startedAt: this.now(),
      settledAt: null,
    };
    const closed = closedSignal();
    const run: Run = {
      generation,
      rideId: input.rideId,
      rideRevision: input.rideRevision,
      versions: input.versions,
      controller: new AbortController(),
      pending: new Set<string>(),
      answered: new Set<string>(),
      answeredCodes: new Map<string, string>(),
      candidates: [],
      roleHints: new Map(),
      cancelled: false,
      finished: false,
      closed: closed.close,
    };
    this.run = run;
    // (b) …and only then is the previous attempt aborted.
    if (previous !== null) this.abandon(previous);
    this.emit();
    // (d) New work starts last.
    void this.launch(run, input);
    return closed.promise;
  }

  cancel(): void {
    if (this.disposed) return;
    const run = this.run;
    if (run === null || run.cancelled || run.finished) return;
    run.cancelled = true;
    run.controller.abort();
    // Every provider still in flight is cancelled by *us*; a provider that
    // answers later cannot change this record (21 §8).
    for (const providerId of [...run.pending]) {
      this.recordDiagnostic(run, {
        providerId,
        outcome: "cancelled",
        candidateCount: 0,
      });
    }
    run.pending.clear();
    run.finished = true;
    this.setPhase(run, "cancelled");
    run.closed();
  }

  selectRoute(routeId: RouteCandidateId): void {
    if (this.disposed) return;
    const target = this.state.committed ?? this.state.lastGood;
    if (target === null) return;
    // A selection names a route the rider can actually see; an unknown id is a
    // stale UI handle, not an instruction.
    if (!target.candidates.some((candidate) => candidate.id === routeId)) return;
    const updated = deepFreeze<RouteBundle>({
      ...target,
      selectedRouteId: routeId,
      selectionSource: "rider",
    });
    this.state.selectionSource = "rider";
    this.state.selectedRouteId = routeId;
    if (this.state.committed !== null) this.state.committed = updated;
    if (this.state.lastGood === target) this.state.lastGood = updated;
    this.emit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const run = this.run;
    if (run !== null && !run.finished) {
      run.cancelled = true;
      run.controller.abort();
      run.finished = true;
      run.closed();
    }
  }

  /* ---------------------------------------------------------------------
   * The fence
   * ------------------------------------------------------------------ */

  /**
   * The single ownership guard: an attempt may write only while it is the
   * session's current run for the current `(rideId, rideRevision, generation)`
   * identity. The generation is the discriminator (it strictly increases);
   * the other two fields are compared so a write can never land on a different
   * question.
   */
  private isCurrent(run: Run): boolean {
    return (
      !this.disposed &&
      this.run === run &&
      this.state.generation === run.generation &&
      this.state.rideId === run.rideId &&
      this.state.rideRevision === run.rideRevision
    );
  }

  /** Current ownership *and* an attempt that is still progressing. */
  private isLive(run: Run): boolean {
    return !run.cancelled && !run.finished && this.isCurrent(run);
  }

  private abandon(run: Run): void {
    run.cancelled = true;
    run.controller.abort();
    run.finished = true;
    run.closed();
  }

  private emit(): void {
    const subscriber = this.onUpdate;
    if (this.disposed || subscriber === undefined) return;
    try {
      subscriber(this.snapshot());
    } catch {
      // A rendering subscriber must not be able to abort planning, and the
      // controller has no logging channel (13 §13 owns logging).
    }
  }

  private setPhase(run: Run, phase: PlanningPhase): void {
    if (!this.isCurrent(run)) return;
    this.state.phase = phase;
    if (phase === "ready" || phase === "failed" || phase === "cancelled") {
      this.state.settledAt = this.now();
    }
    this.emit();
  }

  private settle(run: Run, phase: "ready"): void {
    if (!this.isCurrent(run)) return;
    run.finished = true;
    this.setPhase(run, phase);
    run.closed();
  }

  private fail(run: Run, error: PlanningError): void {
    if (!this.isCurrent(run)) return;
    run.finished = true;
    this.state.error = error;
    this.setPhase(run, "failed");
    run.closed();
  }

  private recordDiagnostic(run: Run, diagnostic: ProviderDiagnostic): void {
    if (!this.isCurrent(run)) return;
    this.state.diagnostics.set(diagnostic.providerId, diagnostic);
    this.emit();
  }

  /* ---------------------------------------------------------------------
   * Launching
   * ------------------------------------------------------------------ */

  private async launch(run: Run, input: BeginPlanningInput): Promise<void> {
    let built: PlanRequestResult;
    try {
      built = await buildProviderRequest(input.intent, {
        resolveGeometry: this.requestContext.resolveGeometry,
        ...(this.requestContext.profileFor === undefined
          ? {}
          : { profileFor: this.requestContext.profileFor }),
        includeAlternatives: this.requestContext.includeAlternatives ?? true,
      });
    } catch {
      // A throwing geometry resolver is an infrastructure problem, not an
      // authored-constraint problem; the ride may still be replannable.
      if (this.isLive(run)) {
        this.fail(run, {
          code: "provider-unavailable",
          message: "the planning request could not be prepared",
          recoverable: true,
        });
      }
      return;
    }
    if (!this.isLive(run)) return;
    if (!built.ok) {
      this.fail(run, {
        code: "constraint-conflict",
        message: `the ride intent cannot form a planning request: ${built.issues.join("; ")}`,
        recoverable: true,
      });
      return;
    }
    const notes: readonly string[] =
      built.unresolvedRefs.length > 0 ? [NOTE_UNRESOLVED_AVOID_AREAS] : [];
    this.setPhase(run, "routing-primary");
    for (const provider of this.providers) {
      this.query(run, provider, built.request, built.unresolvedRefs, notes);
    }
  }

  /** A per-provider signal derived from the attempt's controller (06 §28). */
  private childSignal(run: Run): AbortSignal {
    const child = new AbortController();
    const parent = run.controller.signal;
    if (parent.aborted) {
      child.abort(parent.reason);
      return child.signal;
    }
    parent.addEventListener("abort", () => child.abort(parent.reason), {
      once: true,
    });
    return child.signal;
  }

  private query(
    run: Run,
    provider: RouteCandidateProvider,
    request: ProviderRouteRequest,
    unresolvedRefs: readonly GeometryRef[],
    notes: readonly string[],
  ): void {
    const signal = this.childSignal(run);
    run.pending.add(provider.id);
    let started: Promise<ProviderCandidateSet>;
    try {
      started = provider.candidates(request, signal);
    } catch (error) {
      this.receiveFailure(run, provider, error);
      return;
    }
    void started.then(
      (set) => {
        void this.receiveSet(run, provider, set, request, unresolvedRefs, notes);
      },
      (error: unknown) => {
        this.receiveFailure(run, provider, error);
      },
    );
  }

  /* ---------------------------------------------------------------------
   * Arrivals
   * ------------------------------------------------------------------ */

  private async receiveSet(
    run: Run,
    provider: RouteCandidateProvider,
    set: ProviderCandidateSet,
    request: ProviderRouteRequest,
    unresolvedRefs: readonly GeometryRef[],
    notes: readonly string[],
  ): Promise<void> {
    if (!this.isLive(run)) return;
    run.answered.add(provider.id);
    let normalized: readonly RouteCandidate[];
    try {
      normalized = await this.pipeline.normalize({
        identity: {
          rideId: run.rideId,
          rideRevision: run.rideRevision,
          planningGeneration: run.generation,
        },
        versions: run.versions,
        request,
        unresolvedRefs,
        providerId: provider.id,
        candidates: set.candidates,
      });
    } catch {
      if (!this.isLive(run)) return;
      // The provider stays "pending" until its answer is merged, so the
      // attempt cannot settle with a provider's outcome unrecorded.
      run.pending.delete(provider.id);
      this.recordDiagnostic(run, {
        providerId: provider.id,
        outcome: "failed",
        candidateCount: 0,
        note: NOTE_NORMALIZATION_FAILED,
      });
      this.advance(run);
      return;
    }
    if (!this.isLive(run)) return;
    run.pending.delete(provider.id);
    this.recordDiagnostic(run, {
      providerId: provider.id,
      outcome: "ok",
      candidateCount: normalized.length,
      ...(notes.length === 0 ? {} : { note: notes.join("; ") }),
    });
    for (const candidate of set.candidates) {
      const fingerprint: unknown = candidate.providerMetadata?.["fingerprint"];
      if (typeof fingerprint !== "string") continue;
      run.roleHints.set(fingerprint, {
        bestRide: candidate.providerMetadata?.["bestRide"] === true,
        lowerWorkload: candidate.providerMetadata?.["lowerWorkload"] === true,
      });
    }
    run.candidates.push(...normalized);
    this.advance(run);
  }

  private receiveFailure(
    run: Run,
    provider: RouteCandidateProvider,
    error: unknown,
  ): void {
    if (!this.isLive(run)) return;
    run.pending.delete(provider.id);
    const code = providerFailureCode(error);
    if (code !== null && ANSWERED_FAILURE_CODES.includes(code)) {
      run.answered.add(provider.id);
      run.answeredCodes.set(provider.id, code);
    }
    this.recordDiagnostic(run, {
      providerId: provider.id,
      outcome: code === TIMEOUT_CODE ? "timeout" : "failed",
      candidateCount: 0,
      note: failureNote(code),
    });
    this.advance(run);
  }

  /* ---------------------------------------------------------------------
   * Progression
   * ------------------------------------------------------------------ */

  private advance(run: Run): void {
    if (!this.isCurrent(run)) return;
    let bundle: RouteBundle | null;
    try {
      bundle = this.buildBundle(run);
    } catch {
      // The pipeline returned data the fence cannot own (a non-plain object it
      // could not freeze, for example). Fail closed rather than store it.
      this.fail(run, {
        code: "provider-unavailable",
        message: "the candidate pipeline produced an unusable bundle",
        recoverable: true,
      });
      return;
    }
    if (bundle !== null) {
      const selection: RouteSelectionSource = bundle.selectionSource;
      const isPrimaryCommit = this.state.committed === null;
      this.setCommitted(run, bundle, selection);
      if (isPrimaryCommit) {
        this.setPhase(run, "primary-ready");
        if (run.pending.size > 0) this.setPhase(run, "alternatives-loading");
      }
    }
    if (run.pending.size === 0) {
      if (this.state.committed !== null) {
        this.settle(run, "ready");
      } else {
        this.fail(run, this.normalizeFailure(run));
      }
      return;
    }
    if (bundle === null) this.emit();
  }

  private buildBundle(run: Run): RouteBundle | null {
    const selection = this.selectCandidate(run);
    if (selection === null) return null;
    return deepFreeze<RouteBundle>({
      rideId: run.rideId,
      rideRevision: run.rideRevision,
      planningGeneration: run.generation,
      policyVersion: run.versions.routePolicy,
      graphVersion: run.versions.graph,
      evidenceVersion: run.versions.evidence,
      // Every candidate the attempt has, ineligible ones included: an
      // ineligible candidate explains itself through its eligibility failures.
      candidates: [...run.candidates],
      selectedRouteId: selection.id,
      selectionSource: selection.source,
      // 06 §15 roles: the provider's own best-ride / lower-workload hints, and
      // the fastest eligible candidate. Unearned roles stay null.
      roles: rolesFor(run),
      createdAt: this.now(),
    });
  }

  /**
   * The selection placeholder (Task 3.3 replaces it): while the rider has not
   * chosen, the first eligible candidate of the highest-priority provider —
   * deterministic, arrival-order independent, and never an ineligible
   * candidate. A rider selection locks while its candidate is still present.
   */
  private selectCandidate(
    run: Run,
  ): { readonly id: RouteCandidateId; readonly source: RouteSelectionSource } | null {
    const sticky = this.state.selectedRouteId;
    if (this.state.selectionSource === "rider" && sticky !== null) {
      const chosen = run.candidates.find((candidate) => candidate.id === sticky);
      if (chosen !== undefined) return { id: chosen.id, source: "rider" };
      // The rider's route is not part of this revision: a bundle must select a
      // route it contains, so the automatic rule decides and says so.
    }
    // VNX-006: the automatic selection is the best ride when a provider named one.
    const bestRide = rolesFor(run)["best-ride"];
    if (bestRide !== null) return { id: bestRide, source: "automatic" };
    for (const provider of this.providers) {
      const candidate = run.candidates.find(
        (entry) => entry.provider.providerId === provider.id && entry.eligibility.eligible,
      );
      if (candidate !== undefined) {
        return { id: candidate.id, source: "automatic" };
      }
    }
    return null;
  }

  private setCommitted(
    run: Run,
    bundle: RouteBundle,
    source: RouteSelectionSource,
  ): void {
    if (!this.isCurrent(run)) return;
    this.state.committed = bundle;
    this.state.lastGood = bundle;
    this.state.selectionSource = source;
    this.state.selectedRouteId = bundle.selectedRouteId;
    this.emit();
  }

  /**
   * Normalizes "no usable candidate" into the §29 codes: a provider that
   * never answered is an outage, an ineligible-only set is a constraint the
   * rider can relax, and anything else is a durable "no route here".
   */
  private normalizeFailure(run: Run): PlanningError {
    if (run.candidates.length > 0) {
      const codes: string[] = [];
      for (const candidate of run.candidates) {
        for (const failure of candidate.eligibility.failures) {
          if (!codes.includes(failure.code)) codes.push(failure.code);
        }
      }
      return {
        code: "constraint-conflict",
        message: `no candidate satisfied hard eligibility (${codes.length === 0 ? "unspecified" : codes.join(", ")})`,
        recoverable: true,
      };
    }
    if (run.answered.size === 0) {
      return {
        code: "provider-unavailable",
        message: "no provider answered the planning request",
        recoverable: true,
      };
    }
    // A provider that answered with a rider-actionable code decided this attempt:
    // "your constraints leave no eligible route" is something the rider can act on,
    // and it must not be flattened into the generic "no route here" (OGV-D-235).
    const answeredCodes = new Set(run.answeredCodes.values());
    const preferred = ANSWER_PRIORITY.find((code) => answeredCodes.has(code));
    if (preferred !== undefined && preferred !== "no-route") {
      return {
        code: preferred,
        message: `no candidate satisfied the rider's constraints (${preferred})`,
        recoverable: true,
      };
    }
    return {
      code: "no-route",
      message: "no provider produced a usable route",
      recoverable: false,
    };
  }
}

/**
 * Creates one planning session controller. Both halves of the Wave-3 pipeline
 * story are optional at the call site: inject `pipeline` (and optionally a
 * `geometryStore`), or inject only a `geometryStore` and get the documented
 * placeholder pipeline.
 */
export function createPlanningController(
  deps: PlanningControllerDeps,
): PlanningController {
  const pipeline: CandidatePipeline =
    deps.pipeline !== undefined
      ? deps.pipeline
      : createStubCandidatePipeline({
          geometryStore: deps.geometryStore,
          ...(deps.now === undefined ? {} : { now: deps.now }),
        });
  return new PlanningSessionController(deps, pipeline);
}
