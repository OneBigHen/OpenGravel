/**
 * Typed construction for the session event union
 * (02-ARCHITECTURE-CONTRACT §5, §2.3; 08-RIDE-NAVIGATION-AND-FREE-RIDE §26).
 *
 * Every builder mints the identity the event needs (a session id, an
 * instruction id) and returns a plain, deeply frozen value. They exist so the
 * callers — the controller, and later the GPS/matching engine (8.2) and the Ride
 * Focus UI (8.5) — never hand-assemble an event literal: the union stays the
 * single vocabulary, and the one place an id is minted is here.
 *
 * Builders do not validate policy: assembling a `track` start with a route
 * binding is a legal value, and the reducer decides that it means nothing. They
 * do state defaults honestly — an absent itinerary is an empty one, an absent
 * recording reference is `null`, and never a placeholder string.
 */

import { deepFreeze } from "../util/freeze";
import { newRideSessionId, newSessionInstructionId } from "./ids";
import type { StopId } from "../ride/ids";
import type {
  PositionFix,
  RideSessionEvent,
  RideSessionMovingActivity,
  SessionSuggestions,
  SessionInstruction,
  SessionOffRouteState,
  SessionPauseReason,
  SessionPlan,
  SessionRouteBinding,
} from "./types";
import type { SessionInstructionId, RideSessionId } from "./ids";
import type { RecordingId } from "../recording/ids";

export interface StartSessionInput {
  readonly at: string;
  readonly activity: RideSessionMovingActivity;
  readonly plan: SessionPlan;
  readonly sessionId?: RideSessionId;
  readonly itinerary?: readonly StopId[];
  readonly recordingId?: RecordingId | null;
  readonly suggestions?: SessionSuggestions;
}

/** `session.started` — the one entry event; it mints the session identity. */
export function sessionStartedEvent(input: StartSessionInput): RideSessionEvent {
  return deepFreeze<RideSessionEvent>({
    type: "session.started",
    at: input.at,
    sessionId: input.sessionId ?? newRideSessionId(),
    activity: input.activity,
    plan: input.plan,
    itinerary: [...(input.itinerary ?? [])],
    recordingId: input.recordingId ?? null,
    suggestions: input.suggestions ?? "off",
  });
}

/** `position.updated` — one fix as the position pipeline delivered it (8 §3). */
export function positionUpdatedEvent(position: PositionFix, at: string): RideSessionEvent {
  return deepFreeze<RideSessionEvent>({ type: "position.updated", at, position });
}

/** `off-route.changed` — the progress matcher's continuity verdict (8 §9). */
export function offRouteChangedEvent(
  state: SessionOffRouteState,
  at: string,
): RideSessionEvent {
  return { type: "off-route.changed", at, state };
}

/**
 * `waypoint.arrived` — a payload-free marker. The session consumes the next
 * pending stop in order; no distance or odometer arithmetic enters the machine.
 */
export function waypointArrivedEvent(at: string): RideSessionEvent {
  return { type: "waypoint.arrived", at };
}

export type NewSessionInstructionInput =
  | {
      readonly kind: "turn";
      readonly maneuver: NonNullable<SessionInstruction["maneuver"]>;
      readonly distanceMeters: number;
      readonly roadName?: string | null;
      readonly targetStopId?: StopId | null;
    }
  | {
      readonly kind: "continue" | "arrive";
      readonly distanceMeters: number;
      readonly roadName?: string | null;
      readonly targetStopId?: StopId | null;
    };

/** Mints the maneuver identity; the reducer validates coherence. */
export function newSessionInstruction(
  input: NewSessionInstructionInput,
): SessionInstruction {
  return deepFreeze<SessionInstruction>({
    instructionId: newSessionInstructionId(),
    kind: input.kind,
    maneuver: input.kind === "turn" ? input.maneuver : null,
    roadName: input.roadName ?? null,
    distanceMeters: input.distanceMeters,
    targetStopId: input.targetStopId ?? null,
  });
}

/** `instruction.issued` — one maneuver for the guidance engine to present. */
export function instructionIssuedEvent(
  instruction: SessionInstruction,
  at: string,
): RideSessionEvent {
  return deepFreeze<RideSessionEvent>({ type: "instruction.issued", at, instruction });
}

/** `instruction.acknowledged` — the rider consumed the outstanding maneuver. */
export function instructionAcknowledgedEvent(
  instructionId: SessionInstructionId,
  at: string,
): RideSessionEvent {
  return { type: "instruction.acknowledged", at, instructionId };
}

/**
 * `mode.changed` — a move between guided, free and track. Passing `route` binds
 * a route answer in the same transition, which is how accepting a Free Ride
 * suggestion enters a guided segment without ending the recording (8 §17).
 */
export function modeChangedEvent(
  activity: RideSessionMovingActivity,
  at: string,
  route?: SessionRouteBinding,
): RideSessionEvent {
  return route === undefined
    ? { type: "mode.changed", at, activity }
    : { type: "mode.changed", at, activity, route };
}

/** `session.paused` — `rider` by default; `interruption` for a lost activity. */
export function sessionPausedEvent(
  at: string,
  reason: SessionPauseReason = "rider",
): RideSessionEvent {
  return { type: "session.paused", at, reason };
}

/** `session.resumed` — the explicit resume 8 §13 requires after a reload. */
export function sessionResumedEvent(at: string): RideSessionEvent {
  return { type: "session.resumed", at };
}

/** `session.completed` — the rider finished the ride. */
export function sessionCompletedEvent(at: string): RideSessionEvent {
  return { type: "session.completed", at };
}

/** `session.abandoned` — the activity ended without finishing its objective. */
export function sessionAbandonedEvent(at: string): RideSessionEvent {
  return { type: "session.abandoned", at };
}

/** `recording.discarded` — records that the separate trace was intentionally removed. */
export function recordingDiscardedEvent(at: string): RideSessionEvent {
  return { type: "recording.discarded", at };
}

/** `suggestions.changed` — explicitly enables or suppresses route-free queries. */
export function suggestionsChangedEvent(
  suggestions: SessionSuggestions,
  at: string,
): RideSessionEvent {
  return deepFreeze<RideSessionEvent>({ type: "suggestions.changed", at, suggestions });
}

export interface RideRevisedInput {
  readonly rideRevision: number;
  readonly route: SessionRouteBinding | null;
  readonly remainingStopIds?: readonly StopId[];
}

/** `ride.revised` — a mid-ride document edit, recorded rather than applied. */
export function rideRevisedEvent(input: RideRevisedInput, at: string): RideSessionEvent {
  return deepFreeze<RideSessionEvent>({
    type: "ride.revised",
    at,
    rideRevision: input.rideRevision,
    route: input.route,
    remainingStopIds: [...(input.remainingStopIds ?? [])],
  });
}
