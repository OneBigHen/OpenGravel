/**
 * Active-session rerouting (08-RIDE-NAVIGATION-AND-FREE-RIDE §9–§10;
 * 06-ROUTING-AND-DECISION-ENGINE §26/§28–§29; OGV-RID-006).
 *
 * The module has two deliberately narrow responsibilities:
 *
 * - project the live session's remaining objective onto a planning-only
 *   `RideIntent`, then pass that projection through the canonical provider
 *   request builder; and
 * - submit that request to the authoritative planning service and bind only
 *   its selected answer through one `mode.changed` event.
 *
 * It owns no route ranking and no session state. A failed or cancelled plan is
 * never dispatched, so the prior route remains the RideSession authority.
 */

import type { PlanRequestContext } from "@/application/planner/build-plan-request";
import { buildProviderRequest } from "@/application/planner/build-plan-request";
import type {
  RoutePlanBundleWire,
  RoutePlanCandidate,
  RoutePlanDiagnosticsWire,
  RoutePlanIdentityWire,
  RoutePlanRequestBody,
} from "@/application/planner/ports/route-plan-contract";
import type { GeometryRef, PointId, ShapingId, StopId } from "@/domain/ride/ids";
import type {
  Coordinate,
  RideDocument,
  RideIntent,
  RidePoint,
  ShapingPoint,
  StopPoint,
} from "@/domain/ride/types";
import { validateCoordinate } from "@/domain/ride/validate";
import { modeChangedEvent } from "@/domain/ride-session/create";
import { deriveSessionNavigation } from "@/domain/ride-session/navigation";
import type {
  RideSessionState,
  SessionRouteBinding,
} from "@/domain/ride-session/types";
import { deepFreeze } from "@/domain/util/freeze";
import type {
  RideSessionCommandResult,
  RideSessionController,
  SessionPersistenceStatus,
} from "./ride-session-controller";
import { loopRejoinAnchors } from "./loop-rejoin";

/** A stable, planning-only identity. It is never written into RideDocument. */
const REROUTE_START_ID = "pt_reroute_current" as PointId;
const REROUTE_FINISH_ID = "pt_reroute_return" as PointId;
/** A mid-ride detour (fuel, food): planning-only, never an authored stop. */
const REROUTE_DETOUR_ID = "stop_reroute_detour" as StopId;

export type RerouteRequestFailure =
  | {
      readonly code: "invalid-current-position";
      readonly issues: readonly string[];
    }
  | {
      readonly code: "completed-stop-reintroduced";
      readonly stopId: StopId;
    }
  | {
      readonly code: "remaining-stop-missing";
      readonly stopId: StopId;
    }
  | {
      readonly code: "constraint-unresolved";
      readonly geometryRefs: readonly GeometryRef[];
    }
  | {
      readonly code: "invalid-request";
      readonly issues: readonly string[];
    };

export interface BuildRerouteRequestInput {
  readonly currentPosition: Coordinate;
  readonly authoredIntent: RideIntent;
  readonly remainingStopIds: readonly StopId[];
  readonly completedStopIds: readonly StopId[];
  /** A place to ride through first (a fuel stop), ahead of the remaining stops. */
  readonly detour?: { readonly coordinate: Coordinate; readonly label: string } | undefined;
  /**
   * The bound route still ahead of the rider, from their last matched point.
   * A loop rejoins it instead of heading straight back to the start.
   */
  readonly aheadLine?: readonly Coordinate[] | undefined;
  /**
   * Ride the whole of `aheadLine` from its first point, whatever the ride's
   * shape (DV-07, "Head to the start"): the way there, then the route itself.
   */
  readonly followLine?: boolean | undefined;
}

export type RerouteRequestResult =
  | {
      readonly ok: true;
      /** The full intent projection supplied to the canonical request builder. */
      readonly rerouteIntent: RideIntent;
      /** The provider-neutral request produced by that builder. */
      readonly request: Extract<
        Awaited<ReturnType<typeof buildProviderRequest>>,
        { readonly ok: true }
      >["request"];
    }
  | { readonly ok: false; readonly failure: RerouteRequestFailure };

function requestFailure(failure: RerouteRequestFailure): RerouteRequestResult {
  return deepFreeze({ ok: false as const, failure });
}

function copyCoordinate(coordinate: Coordinate): Coordinate {
  return { lon: coordinate.lon, lat: coordinate.lat };
}

function currentStart(coordinate: Coordinate): RidePoint {
  return {
    id: REROUTE_START_ID,
    kind: "start",
    coordinate: copyCoordinate(coordinate),
    provenance: { type: "derived", reason: "reliable current ride position" },
  };
}

/**
 * Rerouting a loop still ends at the loop's authored origin (by way of the
 * loop still ahead, when its line is known: `loopShaping`). If the intent
 * already had a finish, that remains the target. An open ride without a finish
 * is rejected by the canonical builder instead of inventing a destination.
 */
function remainingFinish(intent: RideIntent): RidePoint | null {
  if (intent.shape !== "loop") return intent.finish;
  if (intent.start === null) return null;
  return {
    id: REROUTE_FINISH_ID,
    kind: "finish",
    coordinate: copyCoordinate(intent.start.coordinate),
    provenance: { type: "derived", reason: "authored loop return target" },
  };
}

/**
 * A loop rerouted without its remaining line would go "from here to the
 * start", skipping the rest of the ride. With the line, it rides back onto the
 * loop ahead: those anchors replace the authored shaping, which the bound line
 * already passes through (and some of which the rider has already ridden).
 */
function loopShaping(
  input: BuildRerouteRequestInput,
  stops: readonly StopPoint[],
): readonly ShapingPoint[] | null {
  const intent = input.authoredIntent;
  if (intent.sketch !== null || input.aheadLine === undefined) return null;
  const followLine = input.followLine === true;
  if (intent.shape !== "loop" && !followLine) return null;
  const anchors = loopRejoinAnchors(input.aheadLine, stops.map((stop) => stop.coordinate), followLine ? 0 : undefined);
  return anchors.map((coordinate, index) => ({
    id: `shape_reroute_rejoin_${index}` as ShapingId,
    kind: "shape" as const,
    coordinate: copyCoordinate(coordinate),
    source: "import" as const,
  }));
}

function pendingStops(
  input: BuildRerouteRequestInput,
): readonly StopPoint[] | RerouteRequestFailure {
  const completed = new Set<string>(input.completedStopIds);
  const byId = new Map(input.authoredIntent.stops.map((entry) => [entry.id, entry]));
  const result: StopPoint[] = [];
  for (const stopId of input.remainingStopIds) {
    if (completed.has(stopId)) {
      return { code: "completed-stop-reintroduced", stopId };
    }
    const stop = byId.get(stopId);
    if (stop === undefined) return { code: "remaining-stop-missing", stopId };
    result.push(stop);
  }
  return result;
}

function isFailure(
  value: readonly StopPoint[] | RerouteRequestFailure,
): value is RerouteRequestFailure {
  return !Array.isArray(value);
}

/** Geometry the base builder could not carry, including an omitted span line. */
function unresolvedConstraintRefs(
  intent: RideIntent,
  result: Extract<Awaited<ReturnType<typeof buildProviderRequest>>, { ok: true }>,
): readonly GeometryRef[] {
  const reported = new Set<GeometryRef>(result.unresolvedRefs);
  const unresolved = new Set<GeometryRef>();
  for (const area of intent.avoidAreas) {
    if (area.enabled && reported.has(area.geometryRef)) unresolved.add(area.geometryRef);
  }
  const projectedSpans = result.request.roadSpans ?? [];
  for (const [index, span] of intent.roadSpans.entries()) {
    if (projectedSpans[index]?.corridor === undefined) unresolved.add(span.geometryRef);
  }
  if (intent.sketch !== null && result.request.sketch === undefined) {
    for (const ref of intent.sketch.rawStrokeRefs) unresolved.add(ref);
    unresolved.add(intent.sketch.corridorRef);
  }
  return [...unresolved];
}

/**
 * Builds one honest reroute request without mutating authored or session state.
 *
 * Only stop identities in `remainingStopIds` may enter the projection, in that
 * exact order. Every other authored route-affecting field is retained. A sketch
 * keeps its corridor and hints but switches to `preserve-existing`, because its
 * old derived start must not override the reliable current position.
 */
export async function buildRerouteRequest(
  input: BuildRerouteRequestInput,
  context: PlanRequestContext,
): Promise<RerouteRequestResult> {
  const coordinateIssues = validateCoordinate(input.currentPosition);
  if (coordinateIssues.length > 0) {
    return requestFailure({
      code: "invalid-current-position",
      issues: coordinateIssues,
    });
  }

  const stops = pendingStops(input);
  if (isFailure(stops)) return requestFailure(stops);
  if (input.detour !== undefined) {
    const detourIssues = validateCoordinate(input.detour.coordinate);
    if (detourIssues.length > 0) {
      return requestFailure({ code: "invalid-request", issues: detourIssues });
    }
  }
  const detour: readonly StopPoint[] = input.detour === undefined
    ? []
    : [{
        id: REROUTE_DETOUR_ID,
        kind: "stop",
        coordinate: copyCoordinate(input.detour.coordinate),
        label: input.detour.label,
        provenance: { type: "derived", reason: "rider-chosen detour" },
      }];

  const shaping = loopShaping(input, stops);
  const rerouteIntent = deepFreeze<RideIntent>({
    ...input.authoredIntent,
    shape: "destination",
    start: currentStart(input.currentPosition),
    finish: remainingFinish(input.authoredIntent),
    stops: [...detour, ...stops],
    ...(shaping === null ? {} : { shaping }),
    ...(input.authoredIntent.sketch === null
      ? {}
      : {
          sketch: {
            ...input.authoredIntent.sketch,
            endpointPolicy: "preserve-existing" as const,
          },
        }),
  });

  const built = await buildProviderRequest(rerouteIntent, context);
  if (!built.ok) {
    return requestFailure({ code: "invalid-request", issues: built.issues });
  }
  const unresolved = unresolvedConstraintRefs(rerouteIntent, built);
  if (unresolved.length > 0) {
    return requestFailure({
      code: "constraint-unresolved",
      geometryRefs: unresolved,
    });
  }
  return deepFreeze({
    ok: true as const,
    rerouteIntent,
    request: built.request,
  });
}

export interface ReroutePlanError {
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Structurally matches the existing server `planRide` result. */
export type ReroutePlanResult =
  | {
      readonly ok: true;
      readonly identity: RoutePlanIdentityWire;
      readonly bundle: RoutePlanBundleWire;
      readonly diagnostics: RoutePlanDiagnosticsWire;
    }
  | { readonly ok: false; readonly error: ReroutePlanError };

/**
 * Control-surface port for the existing route-plan service. Browser code may
 * adapt `/api/route-plan`; server tests and composition may pass `planRide`
 * directly. The signal is caller-owned and must be forwarded unchanged.
 */
export interface ReroutePlannerPort {
  plan(input: RoutePlanRequestBody, signal: AbortSignal): Promise<ReroutePlanResult>;
}

export type RerouteFailure =
  | { readonly code: "no-active-session" }
  | { readonly code: "session-not-guided"; readonly activity: string }
  | { readonly code: "ride-mismatch" }
  | { readonly code: "ride-revision-mismatch" }
  | { readonly code: "unreliable-position"; readonly quality: string }
  | RerouteRequestFailure
  | {
      readonly code: "planning-failed";
      readonly planningCode: string;
      readonly message: string;
      readonly recoverable: boolean;
    }
  | { readonly code: "stale-plan-answer" }
  | { readonly code: "selected-route-missing" }
  | { readonly code: "selection-not-authoritative" }
  | { readonly code: "session-changed" }
  | {
      readonly code: "binding-rejected";
      readonly reducerCode: string | undefined;
      readonly message: string | undefined;
    };

export type RerouteResult =
  | {
      readonly outcome: "succeeded";
      readonly binding: SessionRouteBinding;
      readonly selectedCandidate: RoutePlanCandidate;
      readonly state: RideSessionState;
      readonly persistence: SessionPersistenceStatus;
    }
  | { readonly outcome: "failed"; readonly failure: RerouteFailure }
  | { readonly outcome: "cancelled"; readonly reason: unknown };

export interface RerouteRideSessionInput {
  readonly ride: RideDocument;
  readonly session: RideSessionController;
  readonly planner: ReroutePlannerPort;
  readonly requestContext: PlanRequestContext;
  readonly now?: () => string;
  readonly signal?: AbortSignal;
}

function failed(failure: RerouteFailure): RerouteResult {
  return deepFreeze({ outcome: "failed" as const, failure });
}

function cancelled(reason: unknown): RerouteResult {
  return { outcome: "cancelled", reason };
}

function abortLike(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { readonly name?: unknown }).name === "AbortError"
  );
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The reroute was cancelled.", "AbortError");
}

/** Stops awaiting request preparation promptly even when a resolver cannot abort itself. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    void work.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

function sameIds(left: readonly StopId[], right: readonly StopId[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameBinding(
  left: SessionRouteBinding | null,
  right: SessionRouteBinding | null,
): boolean {
  return (
    left?.planningGeneration === right?.planningGeneration &&
    left?.routeId === right?.routeId
  );
}

function bindingFailure(result: RideSessionCommandResult): RerouteResult {
  return failed({
    code: "binding-rejected",
    reducerCode: result.code,
    message: result.message,
  });
}

/**
 * Computes and binds one reroute. The only RideSession mutation is the final
 * `mode.changed` dispatch, after a current, authoritative selection exists.
 */
export async function rerouteRideSession(
  input: RerouteRideSessionInput,
): Promise<RerouteResult> {
  const before = input.session.snapshot();
  if (before === null) return failed({ code: "no-active-session" });
  if (before.activity !== "guided" || before.plan.route === null) {
    return failed({ code: "session-not-guided", activity: before.activity });
  }
  if (before.plan.rideId !== input.ride.rideId) return failed({ code: "ride-mismatch" });
  if (before.plan.rideRevision !== input.ride.revision) {
    return failed({ code: "ride-revision-mismatch" });
  }

  const now = input.now ?? ((): string => new Date().toISOString());
  const signal = input.signal ?? new AbortController().signal;
  if (signal.aborted) return cancelled(abortReason(signal));
  const requestedAt = now();
  const navigation = deriveSessionNavigation(before, { now: requestedAt });
  if (navigation.position.quality !== "fresh-good" || navigation.position.coordinate === null) {
    return failed({
      code: "unreliable-position",
      quality: navigation.position.quality,
    });
  }

  let built: RerouteRequestResult;
  try {
    built = await untilAborted(
      buildRerouteRequest(
        {
          currentPosition: navigation.position.coordinate,
          authoredIntent: input.ride.intent,
          remainingStopIds: before.remainingStopIds,
          completedStopIds: before.completedStopIds,
        },
        input.requestContext,
      ),
      signal,
    );
  } catch (error: unknown) {
    if (signal.aborted || abortLike(error)) return cancelled(signal.reason ?? error);
    return failed({
      code: "planning-failed",
      planningCode: "provider-unavailable",
      message: "The reroute request could not be prepared.",
      recoverable: true,
    });
  }
  if (!built.ok) return failed(built.failure);

  const identity: RoutePlanIdentityWire = {
    rideId: input.ride.rideId,
    rideRevision: input.ride.revision,
    planningGeneration: before.plan.route.planningGeneration + 1,
  };
  let planned: ReroutePlanResult;
  try {
    planned = await input.planner.plan(
      {
        identity,
        request: built.request,
        options: { includeAlternatives: built.request.options.includeAlternatives },
      },
      signal,
    );
  } catch (error: unknown) {
    if (signal.aborted || abortLike(error)) return cancelled(signal.reason ?? error);
    return failed({
      code: "planning-failed",
      planningCode: "provider-unavailable",
      message: "The reroute planner did not return an answer.",
      recoverable: true,
    });
  }

  if (signal.aborted) return cancelled(signal.reason);
  if (!planned.ok) {
    if (planned.error.code === "cancelled") return cancelled(signal.reason);
    return failed({
      code: "planning-failed",
      planningCode: planned.error.code,
      message: planned.error.message,
      recoverable: planned.error.recoverable,
    });
  }
  if (
    planned.identity.rideId !== identity.rideId ||
    planned.identity.rideRevision !== identity.rideRevision ||
    planned.identity.planningGeneration !== identity.planningGeneration
  ) {
    return failed({ code: "stale-plan-answer" });
  }
  const selected = planned.bundle.candidates.find(
    (candidate) => candidate.id === planned.bundle.selectedRouteId,
  );
  if (selected === undefined) return failed({ code: "selected-route-missing" });
  const automaticSelection =
    planned.bundle.roles["best-ride"] ?? planned.bundle.roles.fastest;
  if (
    planned.bundle.selectionSource !== "automatic" ||
    automaticSelection === null ||
    automaticSelection !== selected.id ||
    !selected.eligibility.eligible
  ) {
    return failed({ code: "selection-not-authoritative" });
  }

  // Position updates may continue while planning, but the objective and route
  // fence that formed this question must still be current before it is bound.
  const current = input.session.snapshot();
  if (
    current === null ||
    current.activity !== "guided" ||
    current.plan.rideId !== before.plan.rideId ||
    current.plan.rideRevision !== before.plan.rideRevision ||
    !sameBinding(current.plan.route, before.plan.route) ||
    !sameIds(current.completedStopIds, before.completedStopIds) ||
    !sameIds(current.remainingStopIds, before.remainingStopIds)
  ) {
    return failed({ code: "session-changed" });
  }

  const binding: SessionRouteBinding = {
    planningGeneration: identity.planningGeneration,
    routeId: planned.bundle.selectedRouteId,
  };
  const bound = await input.session.dispatch(modeChangedEvent("guided", now(), binding));
  if (bound.outcome !== "applied" || bound.state === null) return bindingFailure(bound);
  return deepFreeze({
    outcome: "succeeded" as const,
    binding,
    selectedCandidate: selected,
    state: bound.state,
    persistence: bound.persistence,
  });
}

export type RerouteOfferState =
  | { readonly canOffer: true }
  | {
      readonly canOffer: false;
      readonly reason: "not-guided" | "not-off-route" | "unreliable-position";
    };

/** Read-only seam for an 8.5 control to decide whether a reroute may be offered. */
export function rerouteOfferState(
  state: RideSessionState,
  now: string,
): RerouteOfferState {
  if (state.activity !== "guided") return { canOffer: false, reason: "not-guided" };
  if (state.offRouteState !== "off-route") {
    return { canOffer: false, reason: "not-off-route" };
  }
  if (deriveSessionNavigation(state, { now }).position.quality !== "fresh-good") {
    return { canOffer: false, reason: "unreliable-position" };
  }
  return { canOffer: true };
}
