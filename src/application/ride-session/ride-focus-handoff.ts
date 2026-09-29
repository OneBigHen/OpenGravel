/**
 * The Active Ride handoff: planner → Ride Focus
 * (04-PLANNER-AND-WORKSPACE-UX §28, 08-RIDE-NAVIGATION-AND-FREE-RIDE §1, §13;
 * 02-ARCHITECTURE-CONTRACT §2.3; 17-IMPLEMENTATION-PLAN Task 8.5).
 *
 * §28 is four requirements and this module is all four, in order:
 *
 * 1. **selects the exact route identity** — the ride binds the committed
 *    bundle's `planningGeneration` and its selected `routeId`, never "whatever
 *    was on screen";
 * 2. **creates or resumes the RideSession** — one physical activity (§1), so an
 *    existing session for the same ride is resumed rather than joined by a
 *    second one, and a new one is created only when there is none;
 * 3. **does not destroy the RideDocument** — nothing here touches the document;
 *    the session holds a revision fence (`plan.rideRevision`), it never rewrites
 *    the ride;
 * 4. **requests location if needed / switches to Ride Focus** — the permission
 *    request and the route change are the surface's, driven from the outcome
 *    this module returns (`ride-focus-environment.ts`, `src/app/ride`).
 *
 * The decision half is pure (`buildRideHandoff`) so the refusals can be asserted
 * without a browser, a controller or storage. The impure half
 * (`startRideFromHandoff`) journals the session event and writes the one durable
 * thing the ride surface needs to find it again: the bootstrap pointer.
 */

import type { GeometryRef, RideId, StopId } from "@/domain/ride/ids";
import type { Coordinate, RideDocument } from "@/domain/ride/types";
import type { RouteBundle, RouteCandidate, RouteInstruction, SpeedLimitSpan } from "@/domain/route/types";
import type { RouteCandidateId } from "@/domain/route/ids";
import type { RideSessionId } from "@/domain/ride-session/ids";
import type { SessionRouteBinding } from "@/domain/ride-session/types";

import type { RideSessionCommandResult, RideSessionController } from "./ride-session-controller";
import type { RideFocusPointerPort } from "@/application/persistence/ride-focus-pointer";
import type { RideRepositoryPort } from "@/application/persistence/ride-repository";
import { SKETCH_PREVIEW_RIDE_REFUSAL } from "@/application/planner/sketch-preview";

/**
 * Why a `Start ride` was refused. Every code is a state the rider can act on,
 * and the message is the instruction that says which action it is.
 */
export type RideHandoffRefusalCode =
  | "no-plan"
  | "no-start"
  | "no-destination"
  | "no-selection"
  | "no-line"
  | "sketch-preview";

/** Everything the handoff decides: what to start and where its line lives. */
export interface RideHandoffRequest {
  readonly rideId: RideId;
  readonly rideRevision: number;
  readonly route: SessionRouteBinding;
  readonly itinerary: readonly StopId[];
  /** The selected candidate's persisted line, for the Ride Focus map. */
  readonly routeGeometryRef: GeometryRef | null;
  /** The selected candidate's duration estimate, for ETA projection. */
  readonly routeDurationSeconds?: number;
  /** Provider facts needed to derive the next active RideSession instruction. */
  readonly instructions?: readonly RouteInstruction[];
  /** Posted speed limits along the route line (NV-04). */
  readonly speedLimits?: readonly SpeedLimitSpan[];
}

export type RideHandoffOutcome =
  | { readonly outcome: "ready"; readonly request: RideHandoffRequest }
  | {
      readonly outcome: "refused";
      readonly code: RideHandoffRefusalCode;
      readonly message: string;
    };

export interface RideHandoffInput {
  /** The authored ride. Read only: the handoff never edits it (§28). */
  readonly document: RideDocument;
  /** The committed answer, or `null` when nothing has been planned. */
  readonly bundle: RouteBundle | null;
  /** The candidate the bundle selected, or `null` when it does not resolve. */
  readonly selectedCandidate: RouteCandidate | null;
  /**
   * Whether the selected candidate's line is actually available right now. A
   * ride whose line cannot be loaded still starts — the map is a renderer, not
   * the ride — but the surface says so instead of drawing a line it invented.
   */
  readonly hasRouteLine: boolean;
  /**
   * The answer on screen plans a drawing the ride does not hold yet
   * (snap-as-you-go, OGV-D-285). Riding it would bind a route to a ride that
   * does not describe it.
   */
  readonly sketchPreview?: boolean;
}

/** The non-empty stop list the session takes as its pending objective (§13). */
function itineraryOf(document: RideDocument): readonly StopId[] {
  return document.intent.stops.map((stop) => stop.id);
}

/**
 * Decides whether this ride can start, and with which identity. Pure: the same
 * document and bundle always produce the same answer or the same refusal.
 */
export function buildRideHandoff(input: RideHandoffInput): RideHandoffOutcome {
  const { document, bundle, selectedCandidate } = input;
  if (bundle === null) {
    return { outcome: "refused", code: "no-plan", message: "Plan a ride before starting one." };
  }
  if (input.sketchPreview === true) {
    return { outcome: "refused", code: "sketch-preview", message: SKETCH_PREVIEW_RIDE_REFUSAL };
  }
  if (document.intent.start === null) {
    return { outcome: "refused", code: "no-start", message: "Set a start point first." };
  }
  // A loop ends where it started, so it needs no finish (UX rework 2: every
  // "2-hour loop from here" used to stop here, planned but unstartable).
  if (document.intent.shape !== "loop" && document.intent.finish === null && document.intent.stops.length === 0) {
    return {
      outcome: "refused",
      code: "no-destination",
      message: "Set a destination or a stop first.",
    };
  }
  if (selectedCandidate === null) {
    return {
      outcome: "refused",
      code: "no-selection",
      message: "Choose a route before starting the ride.",
    };
  }
  if (!input.hasRouteLine) {
    return {
      outcome: "refused",
      code: "no-line",
      message: "The chosen route's line isn't loaded yet. Try again in a moment.",
    };
  }
  return {
    outcome: "ready",
    request: {
      rideId: document.rideId,
      rideRevision: document.revision,
      route: {
        planningGeneration: bundle.planningGeneration,
        routeId: bundle.selectedRouteId,
      },
      itinerary: itineraryOf(document),
      routeGeometryRef: selectedCandidate.geometryRef,
      routeDurationSeconds: selectedCandidate.durationSeconds,
      ...(selectedCandidate.instructions === undefined
        ? {}
        : { instructions: selectedCandidate.instructions }),
      ...(selectedCandidate.speedLimits === undefined
        ? {}
        : { speedLimits: selectedCandidate.speedLimits }),
    },
  };
}

/** What the planner's `Start ride` (or the retry of it) ended as. */
export type RideStartOutcome =
  | {
      readonly outcome: "started" | "resumed";
      readonly sessionId: RideSessionId;
      readonly message: null;
    }
  | {
      readonly outcome: "rejected";
      readonly sessionId: RideSessionId | null;
      readonly message: string;
    };

export interface StartRideFromHandoffInput {
  readonly controller: RideSessionController;
  readonly pointer: RideFocusPointerPort;
  readonly request: RideHandoffRequest;
  /** The instant the session starts; the caller owns the clock. */
  readonly now: string;
  /**
   * Whether a session for this ride is already recorded in the pointer. When it
   * is, the ride is **resumed** (8 §1: one physical activity) instead of a
   * second one being started on the same route.
   */
  readonly existingSessionId?: RideSessionId | null;
}

/**
 * Starts (or hands off to) the session and records the bootstrap pointer.
 *
 * Order matters: the session event is journaled **before** the pointer is
 * written, so a crash between the two leaves a session the rider can find in the
 * journal and never a pointer to a session that does not exist.
 */
export async function startRideFromHandoff(
  input: StartRideFromHandoffInput,
): Promise<RideStartOutcome> {
  const existing = input.existingSessionId ?? null;
  if (existing !== null) {
    input.pointer.write({
      sessionId: existing,
      rideId: input.request.rideId,
      routeGeometryRef: input.request.routeGeometryRef,
      ...(input.request.routeDurationSeconds === undefined
        ? {}
        : { routeDurationSeconds: input.request.routeDurationSeconds }),
      ...(input.request.instructions === undefined
        ? {}
        : { instructions: input.request.instructions }),
      ...(input.request.speedLimits === undefined
        ? {}
        : { speedLimits: input.request.speedLimits }),
      updatedAt: input.now,
    });
    return { outcome: "resumed", sessionId: existing, message: null };
  }

  const started: RideSessionCommandResult = await input.controller.start({
    activity: "guided",
    rideId: input.request.rideId,
    rideRevision: input.request.rideRevision,
    route: input.request.route,
    itinerary: input.request.itinerary,
    at: input.now,
  });
  if (started.outcome === "rejected" || started.state === null) {
    return {
      outcome: "rejected",
      sessionId: null,
      message: started.message ?? "The ride could not be started.",
    };
  }
  input.pointer.write({
    sessionId: started.state.sessionId,
    rideId: input.request.rideId,
    routeGeometryRef: input.request.routeGeometryRef,
    ...(input.request.routeDurationSeconds === undefined
      ? {}
      : { routeDurationSeconds: input.request.routeDurationSeconds }),
    ...(input.request.instructions === undefined
      ? {}
      : { instructions: input.request.instructions }),
    ...(input.request.speedLimits === undefined
      ? {}
      : { speedLimits: input.request.speedLimits }),
    updatedAt: input.now,
  });
  return { outcome: "started", sessionId: started.state.sessionId, message: null };
}

export type RecordingPreparationOutcome =
  | { readonly outcome: "ready" }
  | { readonly outcome: "rejected"; readonly message: string };

/** Typed planner actions that cross into physical RideSession ownership. */
export interface PlannerRideActions {
  readonly start: (request: RideHandoffRequest) => Promise<RideStartOutcome>;
  readonly record: (document: RideDocument) => Promise<RecordingPreparationOutcome>;
  readonly freeRide: (document: RideDocument) => Promise<RideStartOutcome>;
}

/** Checkpoints the current authoring revision before Ride Focus loads it. */
export async function prepareRecordingFromPlanner(input: {
  readonly document: RideDocument;
  readonly rides: RideRepositoryPort;
  readonly writerToken: string;
}): Promise<RecordingPreparationOutcome> {
  try {
    const saved = await input.rides.saveRide(input.document, {
      writerToken: input.writerToken,
      baseRevision: input.document.revision,
    });
    return saved.ok
      ? { outcome: "ready" }
      : {
          outcome: "rejected",
          message: "The current ride could not be saved, so recording was not started.",
        };
  } catch {
    return {
      outcome: "rejected",
      message: "The current ride could not be saved, so recording was not started.",
    };
  }
}

/** Starts the distinct, route-free Free Ride activity from the planner. */
export async function startFreeRideFromPlanner(input: {
  readonly controller: RideSessionController;
  readonly pointer: RideFocusPointerPort;
  readonly document: RideDocument;
  readonly rides: RideRepositoryPort;
  readonly writerToken: string;
  readonly now: string;
}): Promise<RideStartOutcome> {
  const current = input.pointer.read();
  if (current.status === "found") {
    return {
      outcome: "rejected",
      sessionId: current.pointer.sessionId,
      message: "A ride is already in progress. Resume it in Ride Focus before starting another.",
    };
  }
  if (current.status !== "absent") {
    return {
      outcome: "rejected",
      sessionId: null,
      message: "The current ride could not be checked. Try opening Ride Focus first.",
    };
  }

  let saved: Awaited<ReturnType<RideRepositoryPort["saveRide"]>>;
  try {
    saved = await input.rides.saveRide(input.document, {
      writerToken: input.writerToken,
      baseRevision: input.document.revision,
    });
  } catch {
    return { outcome: "rejected", sessionId: null, message: "The ride could not be saved, so Free Ride was not started." };
  }
  if (!saved.ok) {
    return { outcome: "rejected", sessionId: null, message: "The ride could not be saved, so Free Ride was not started." };
  }

  const started = await input.controller.start({
    activity: "free",
    suggestions: "on",
    rideId: input.document.rideId,
    rideRevision: input.document.revision,
    itinerary: [],
    at: input.now,
  });
  if (started.outcome === "rejected" || started.state === null) {
    return {
      outcome: "rejected",
      sessionId: null,
      message: started.message ?? "Free Ride could not be started.",
    };
  }

  input.pointer.write({
    sessionId: started.state.sessionId,
    rideId: input.document.rideId,
    routeGeometryRef: null,
    updatedAt: input.now,
  });
  return { outcome: "started", sessionId: started.state.sessionId, message: null };
}

/** The URL the Ride Focus surface lives at (04 §28 "switches to Ride Focus"). */
export const RIDE_FOCUS_PATH = "/ride";

/** Narrowing helper for a route binding whose candidate is known to exist. */
export function routeBindingFor(
  bundle: RouteBundle,
  routeId: RouteCandidateId,
): SessionRouteBinding {
  return { planningGeneration: bundle.planningGeneration, routeId };
}

/** The line a scene should draw, or `null` when the handle did not resolve. */
export function routeLineOrNull(
  geometry: Readonly<Record<string, { readonly kind: string; readonly coordinates?: readonly Coordinate[] }>>,
  ref: GeometryRef,
): readonly Coordinate[] | null {
  const payload = geometry[ref];
  if (payload === undefined || payload.kind !== "line" || payload.coordinates === undefined) {
    return null;
  }
  return payload.coordinates;
}
