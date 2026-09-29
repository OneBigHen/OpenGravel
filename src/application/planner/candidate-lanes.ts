/**
 * Bounded candidate lanes (Wave 3 Task 3.2,
 * 06-ROUTING-AND-DECISION-ENGINE §4/§5/§28/§29, VNX-013).
 *
 * Providers generate paths; OpenGravel decides how many paths are worth asking
 * for. A **lane** is one bounded provider call with a stated purpose, a
 * maximum number of calls and a deadline, so candidate generation is finite by
 * construction instead of by hope: there is no combinatorial route search, and
 * no lane can hold a planning attempt open past its own budget.
 *
 * Four rules shape this module:
 *
 * 1. **A lane failure is a diagnostic, not a plan failure** (`06 §29`). The
 *    baseline lane is the progressive first answer (`06 §5`), and an optional
 *    lane that times out or is rejected removes only its own candidates. The
 *    run still answers with whatever the other lanes produced.
 * 2. **Cancellation is not a lane outcome** (`06 §28`). A caller abort
 *    propagates out of `runLanes` unchanged — with the caller's own reason —
 *    so a rider who stops a plan is never told a lane failed, and a cancelled
 *    plan is never retried as an outage.
 * 3. **Lanes are offered by capability and by intent.** A lane whose profile
 *    the deployment does not serve is not run, the `balanced` lane resolves to
 *    the served base profile or falls back to `fastest`, and the
 *    `surface-targeted` lane exists only when the rider prefers non-paved
 *    (`06 §21`). A lane whose resolved profile duplicates an already-selected
 *    lane is dropped: two calls to the same profile are a duplicate budget, not
 *    a distinct lane (`OGV-D-205`).
 * 4. **The result is capped** ({@link MAX_TOTAL_CANDIDATES}). More raw paths
 *    than that is not more choice; it is the same choice with a bigger dedupe
 *    bill (`06 §14`).
 *
 * This module is application-layer and provider-neutral: it knows the port, the
 * request shape and profile **names as strings**, never an adapter, an engine
 * URL or a rider-facing label (Rule E, VNX-007).
 */

import type { ProviderCandidate, ProviderCapabilities, ProviderRouteRequest, RouteCandidateProvider } from "./route-provider";
import type { PipelineIntent } from "@/domain/route/intent";

/** One bounded provider call (`06 §4`). */
export interface CandidateLane {
  /** Stable lane id, used in diagnostics; never rider copy. */
  readonly id: string;
  /** The provider-internal profile this lane asks for (`06 §6`). */
  readonly profile: string;
  /** Why the lane exists, as a diagnostic statement rather than rider copy. */
  readonly purpose: string;
  /** Calls per lane. Bounded to exactly one: a lane is not a search. */
  readonly maxCalls: 1;
  /** The lane's own budget, in milliseconds. */
  readonly deadlineMs: number;
}

/** The lane that always answers (`06 §2`, VNX-013). */
const BASELINE_LANE_ID = "baseline-efficient";

/** The middle lane, whose profile is resolved against the deployment's set. */
const BALANCED_LANE_ID = "balanced";

/**
 * `motorcycle_base` is the profile the `balanced` lane prefers. It is not part
 * of this deployment's served set (`graphhopper/profiles.ts`), so the lane
 * resolves onto `motorcycle_scenic` when that is served (OGV-D-275, superseding
 * OGV-D-205's drop-as-duplicate), and onto the baseline — then dropped as a
 * duplicate — only when neither is.
 */
const BALANCED_LANE_PROFILE = "motorcycle_base";
const SCENIC_FALLBACK_PROFILE = "motorcycle_scenic";

/** The profile the `balanced` lane falls back to when its preference is unserved. */
const BASELINE_LANE_PROFILE = "motorcycle_fastest";

/** The lane offered only to a rider who prefers non-paved (`06 §21`). */
const SURFACE_LANE_ID = "surface-targeted";

const RIDER_CHARACTER_LANE_ID = "rider-character";

/** The surface preference that makes the surface-targeted lane meaningful. */
const SURFACE_LANE_PROFILE = "motorcycle_adventure";

/**
 * The lane set this capability set can serve (`06 §4`). `DEFAULT_LANES` is the
 * full definition; {@link resolveLanes} decides which of them run for one
 * request, because that depends on the deployment's capabilities and the
 * rider's intent.
 *
 * Deadlines are ordered by how much the product needs the answer: the baseline
 * lane is the progressive first route and gets the shortest budget, while the
 * character lanes may take a little longer because the rider already has
 * something to look at.
 */
export const DEFAULT_LANES: readonly CandidateLane[] = [
  {
    id: BASELINE_LANE_ID,
    profile: BASELINE_LANE_PROFILE,
    purpose: "the efficient baseline route and the fastest reference",
    maxCalls: 1,
    deadlineMs: 15_000,
  },
  {
    id: BALANCED_LANE_ID,
    profile: BALANCED_LANE_PROFILE,
    purpose: "a middle road character between efficient and curvy",
    maxCalls: 1,
    deadlineMs: 20_000,
  },
  {
    id: "curvy",
    profile: "motorcycle_twisty",
    purpose: "a materially twistier road character",
    maxCalls: 1,
    deadlineMs: 20_000,
  },
  {
    id: SURFACE_LANE_ID,
    profile: SURFACE_LANE_PROFILE,
    purpose: "a route weighted toward the rider's unpaved surface preference",
    maxCalls: 1,
    deadlineMs: 20_000,
  },
];

/** Lanes in flight at once. Small parallelism; never a provider flood. */
export const MAX_CONCURRENT_LANES = 2;

/** Total candidates a lane run may return, across every lane (`OGV-D-206`). */
export const MAX_TOTAL_CANDIDATES = 6;

/** The surface preferences that prefer non-paved riding (`06 §21`). */
const NON_PAVED_PREFERENCES: ReadonlySet<string> = new Set(["mixed", "dirt-preferred"]);

export interface ResolveLanesInput {
  /** What the provider says it can serve (its own `profiles` list). */
  readonly capabilities: ProviderCapabilities;
  /** The narrow intent view; `surface` decides the surface-targeted lane. */
  readonly intent: PipelineIntent;
  /**
   * The profile the rider's own intent resolved to (the request's `profile`).
   * When no default lane asks for it — `motorcycle_scenic` for Backroads — it is
   * added as the `rider-character` lane, so the character a rider picked is a
   * route the engine actually drew rather than only a re-ranking (OGV-D-262).
   */
  readonly requestedProfile?: string;
  /** Whether this attempt wants alternatives at all (`06 §5`). */
  readonly includeAlternatives: boolean;
}

function prefersNonPaved(intent: PipelineIntent): boolean {
  const preference = intent.surface?.preference;
  return preference !== undefined && NON_PAVED_PREFERENCES.has(preference);
}

/**
 * The `balanced` lane's profile: its preference when the deployment **declares**
 * it serves that profile, otherwise the baseline profile. An undeclared list is
 * unknown, and asking for a profile a deployment may not have is the one thing
 * that would waste a lane, so the fallback is the safe direction.
 */
function balancedProfile(declared: readonly string[]): string {
  if (declared.includes(BALANCED_LANE_PROFILE)) return BALANCED_LANE_PROFILE;
  // A deployment without a base profile usually has a scenic one, which is the
  // middle character riders expect between fastest and twistiest (UX rework).
  if (declared.includes(SCENIC_FALLBACK_PROFILE)) return SCENIC_FALLBACK_PROFILE;
  return BASELINE_LANE_PROFILE;
}

/**
 * The lanes to run for one attempt.
 *
 * An **empty** `capabilities.profiles` list means the deployment did not
 * declare its profiles, not that it serves none: the transport bridge reports
 * exactly that (`api-provider.capabilities()`), so an undeclared list runs the
 * default lanes and lets a rejection become a lane diagnostic. A declared list
 * is authoritative, because claiming to serve a profile the deployment does not
 * have is the one thing that would waste a lane.
 */
export function resolveLanes(input: ResolveLanesInput): readonly CandidateLane[] {
  if (!input.includeAlternatives) {
    const baseline = DEFAULT_LANES.find((lane) => lane.id === BASELINE_LANE_ID);
    return baseline === undefined ? [] : [baseline];
  }

  const declared = input.capabilities.profiles;
  const serves = (profile: string): boolean =>
    declared.length === 0 || declared.includes(profile);

  const resolved: CandidateLane[] = [];
  const usedProfiles = new Set<string>();
  for (const lane of DEFAULT_LANES) {
    if (lane.id === SURFACE_LANE_ID && !prefersNonPaved(input.intent)) continue;
    const profile =
      lane.id === BALANCED_LANE_ID ? balancedProfile(declared) : lane.profile;
    if (!serves(profile)) continue;
    // One call per profile: a second lane asking the same question is duplicate
    // budget, and the diversity stage would drop its near-duplicate anyway.
    if (usedProfiles.has(profile)) continue;
    usedProfiles.add(profile);
    resolved.push(profile === lane.profile ? lane : { ...lane, profile });
  }
  const requested = input.requestedProfile;
  if (requested !== undefined && !usedProfiles.has(requested) && serves(requested)) {
    resolved.push({
      id: RIDER_CHARACTER_LANE_ID,
      profile: requested,
      purpose: "the road character the rider asked for",
      maxCalls: 1,
      deadlineMs: 20_000,
    });
  }
  return resolved;
}

/** How one lane ended (`06 §29`). */
export type LaneOutcome = "ok" | "failed" | "timeout" | "capped" | "skipped";

/** What a lane rejection must expose for the diagnostic note. */
export interface LaneFailureLike {
  /** A stable machine code; never provider text. */
  readonly code: string;
}

/** One lane's outcome, as observable diagnostics. */
export interface LaneDiagnostic<Failure extends LaneFailureLike = LaneFailureLike> {
  readonly laneId: string;
  readonly profile: string;
  readonly outcome: LaneOutcome;
  /** Candidates this lane contributed to the run. */
  readonly candidateCount: number;
  /**
   * A stable machine token (`rejection:<code>`, `lane-deadline-exceeded`,
   * `candidate-cap`, `candidate-cap-reached`), never provider text
   * (OGV-D-151/OGV-D-162).
   */
  readonly note: string;
  /**
   * The classified rejection, when the caller supplied a classifier. The
   * default is `null`: this module never invents an error taxonomy, and
   * `plan-service` owns the one the wire uses.
   */
  readonly failure: Failure | null;
}

export interface LaneRunInput<Failure extends LaneFailureLike = LaneFailureLike> {
  readonly lanes: readonly CandidateLane[];
  /** Builds the request for one lane's profile; the rest of the request is shared. */
  readonly requestFor: (profile: string) => ProviderRouteRequest;
  readonly provider: RouteCandidateProvider;
  /** The caller's signal. Its abort propagates out of `runLanes` unchanged. */
  readonly signal: AbortSignal;
  /**
   * Classifies a rejection into the caller's own error shape. Optional, and the
   * only way a lane failure can carry structured meaning: nothing here reads a
   * provider message.
   */
  readonly classifyFailure?: (error: unknown) => Failure | null;
  /**
   * Lanes in flight at once; defaults to {@link MAX_CONCURRENT_LANES}. The
   * fast-first plan runs its single-path lanes all together.
   */
  readonly concurrency?: number;
}

export interface LaneRunResult<Failure extends LaneFailureLike = LaneFailureLike> {
  /** Candidates in lane order, capped at {@link MAX_TOTAL_CANDIDATES}. */
  readonly candidates: readonly ProviderCandidate[];
  /** One entry per lane, in lane order. */
  readonly diagnostics: readonly LaneDiagnostic<Failure>[];
}

/** A lane's own abort budget, combined with the caller's signal. */
interface LaneDeadline {
  readonly signal: AbortSignal;
  readonly timedOut: () => boolean;
  readonly dispose: () => void;
}

/**
 * `AbortSignal.any` over the caller's signal and a lane-owned timer. The timer
 * is always cleared by {@link LaneDeadline.dispose}, so a fast lane leaves no
 * pending timer behind.
 */
function laneDeadline(caller: AbortSignal, deadlineMs: number): LaneDeadline {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("lane deadline exceeded"));
  }, deadlineMs);
  return {
    signal: AbortSignal.any([caller, controller.signal]),
    timedOut: (): boolean => timedOut,
    dispose: (): void => clearTimeout(timer),
  };
}

/** The rejection's own code, read structurally and never its message. */
function structuralCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code: unknown = (error as { readonly code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

interface LaneAnswer<Failure extends LaneFailureLike> {
  readonly lane: CandidateLane;
  readonly outcome: LaneOutcome;
  readonly candidates: readonly ProviderCandidate[];
  readonly failure: Failure | null;
  readonly note: string;
}

/**
 * Runs the lanes and returns everything they produced.
 *
 * The run is wave-based: up to {@link MAX_CONCURRENT_LANES} lanes are in flight
 * at a time, waves run in lane order, and results are reported in lane order —
 * so the same lanes with the same answers always produce the same candidate
 * list. Rejects only for a caller abort, carrying the caller's own reason.
 */
export async function runLanes<Failure extends LaneFailureLike = LaneFailureLike>(
  input: LaneRunInput<Failure>,
): Promise<LaneRunResult<Failure>> {
  if (input.signal.aborted) throw input.signal.reason;

  const candidates: ProviderCandidate[] = [];
  const diagnostics: LaneDiagnostic<Failure>[] = [];

  const runOne = async (lane: CandidateLane): Promise<LaneAnswer<Failure>> => {
    const deadline = laneDeadline(input.signal, lane.deadlineMs);
    try {
      const answer = await input.provider.candidates(
        input.requestFor(lane.profile),
        deadline.signal,
      );
      return {
        lane,
        outcome: "ok",
        candidates: answer.candidates,
        failure: null,
        note: "ok",
      };
    } catch (error) {
      // A caller abort is the caller's own decision and travels unchanged; it is
      // deliberately checked before the lane's own deadline (06 §28).
      if (input.signal.aborted) throw input.signal.reason;
      if (deadline.timedOut()) {
        return {
          lane,
          outcome: "timeout",
          candidates: [],
          failure: null,
          note: "lane-deadline-exceeded",
        };
      }
      const failure = input.classifyFailure?.(error) ?? null;
      const code = failure?.code ?? structuralCode(error) ?? "unknown";
      return {
        lane,
        outcome: "failed",
        candidates: [],
        failure,
        note: `rejection:${code}`,
      };
    } finally {
      deadline.dispose();
    }
  };

  const concurrency = Math.max(1, input.concurrency ?? MAX_CONCURRENT_LANES);
  for (let offset = 0; offset < input.lanes.length; offset += concurrency) {
    if (input.signal.aborted) throw input.signal.reason;
    if (candidates.length >= MAX_TOTAL_CANDIDATES) {
      for (const lane of input.lanes.slice(offset)) {
        diagnostics.push({
          laneId: lane.id,
          profile: lane.profile,
          outcome: "skipped",
          candidateCount: 0,
          note: "candidate-cap-reached",
          failure: null,
        });
      }
      break;
    }

    const wave = input.lanes.slice(offset, offset + concurrency);
    const answers = await Promise.all(wave.map((lane) => runOne(lane)));
    if (input.signal.aborted) throw input.signal.reason;

    for (const answer of answers) {
      const remaining = MAX_TOTAL_CANDIDATES - candidates.length;
      if (remaining <= 0) {
        diagnostics.push({
          laneId: answer.lane.id,
          profile: answer.lane.profile,
          outcome: "capped",
          candidateCount: 0,
          note: "candidate-cap-reached",
          failure: answer.failure,
        });
        continue;
      }
      const taken = answer.candidates.slice(0, remaining);
      candidates.push(...taken);
      const truncated = taken.length < answer.candidates.length;
      diagnostics.push({
        laneId: answer.lane.id,
        profile: answer.lane.profile,
        outcome: truncated ? "capped" : answer.outcome,
        candidateCount: taken.length,
        note: truncated ? "candidate-cap" : answer.note,
        failure: answer.failure,
      });
    }
  }

  return { candidates, diagnostics };
}

/** True when a lane diagnostic means the lane produced no answer at all. */
export function isLaneUnavailable(diagnostic: LaneDiagnostic): boolean {
  return diagnostic.outcome === "failed" || diagnostic.outcome === "timeout";
}
