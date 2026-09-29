/**
 * The RideSession mode machine's published legality table, plus the two
 * invariants that are not about modes at all (02-ARCHITECTURE-CONTRACT §2.3;
 * 08-RIDE-NAVIGATION-AND-FREE-RIDE §1, §6, §7, §13, §28;
 * 17-IMPLEMENTATION-PLAN Task 8.1).
 *
 * The table is data, not a comment: `reduce` asks it whether a transition is
 * legal, tests iterate it cell by cell, and adding an event type to the union
 * without a cell fails the type check. That is what makes "every illegal
 * transition produces a typed error" a property of the machine instead of a
 * promise about the switch statement.
 *
 * ## The decisions the table encodes
 *
 * - **Track-only sessions never carry turn instructions** (8 §6, OGV-RID-007):
 *   an `instruction.*` event outside `guided` is rejected, and the message names
 *   the activity so a track-only session cannot look like a guidance failure.
 * - **A paused session ingests nothing** (8 §13): position is rejected while
 *   paused, so lost GPS during a pause cannot move the ride, and an explicit
 *   `session.resumed` is required first.
 * - **`completed` is terminal.** Every event except a new `session.started`
 *   (which is itself rejected: a new activity is a new session identity, 8 §1)
 *   is refused once the session has ended.
 * - **A pause must be resumed, and a resume must follow a pause.** Both are
 *   refused otherwise rather than silently normalized.
 */

import type {
  RideSessionActivity,
  RideSessionErrorCode,
  RideSessionMovingActivity,
  SessionTransitionEventType,
} from "./types";

/** The moving modes, in the order the machine documents them. */
export const SESSION_MOVING_ACTIVITIES: readonly RideSessionMovingActivity[] = [
  "guided",
  "free",
  "track",
];

/** Every activity of the machine, terminal one last. */
export const SESSION_ACTIVITIES: readonly RideSessionActivity[] = [
  ...SESSION_MOVING_ACTIVITIES,
  "paused",
  "completed",
];

/**
 * Every event type the activity table covers. `session.started` is deliberately
 * absent: it is the entry transition out of "no session yet", and the only
 * event a session can never receive twice.
 */
export const SESSION_EVENT_TYPES: readonly SessionTransitionEventType[] = [
  "position.updated",
  "off-route.changed",
  "waypoint.arrived",
  "instruction.issued",
  "instruction.acknowledged",
  "mode.changed",
  "session.paused",
  "session.resumed",
  "session.completed",
  "session.abandoned",
  "recording.discarded",
  "suggestions.changed",
  "ride.revised",
];

/** One cell: the transition is legal, or it is refused with a typed code. */
export type SessionActivityCell =
  | { readonly kind: "allowed" }
  | {
      readonly kind: "rejected";
      readonly code: RideSessionErrorCode;
      readonly reason: string;
    };

const ALLOWED: SessionActivityCell = { kind: "allowed" };

function denied(code: RideSessionErrorCode, reason: string): SessionActivityCell {
  return { kind: "rejected", code, reason };
}

/** The end-of-session refusal shared by every terminal cell. */
const ENDED = "the session has ended; only a new session can start another activity";

function row(
  guided: SessionActivityCell,
  free: SessionActivityCell,
  track: SessionActivityCell,
  paused: SessionActivityCell,
  completed: SessionActivityCell,
): Readonly<Record<RideSessionActivity, SessionActivityCell>> {
  return { guided, free, track, paused, completed };
}

function noInstructions(activity: RideSessionActivity): SessionActivityCell {
  return denied(
    "instructions-unsupported-in-mode",
    `no maneuver is issued while the session is ${activity}` +
      (activity === "track"
        ? "; a track-only ride shows track following, never invented turn instructions"
        : ""),
  );
}

/**
 * The legality table: `SESSION_ACTIVITY_MATRIX[eventType][activity]`. Total over
 * the twelve non-entry events and all five activities.
 */
export const SESSION_ACTIVITY_MATRIX: Readonly<
  Record<SessionTransitionEventType, Readonly<Record<RideSessionActivity, SessionActivityCell>>>
> = {
  "position.updated": row(
    ALLOWED,
    ALLOWED,
    ALLOWED,
    denied("position-while-paused", "a paused session ignores position until it is resumed"),
    denied("illegal-transition", ENDED),
  ),
  "off-route.changed": row(
    ALLOWED,
    denied("illegal-transition", "Free Ride has no bound route to deviate from"),
    ALLOWED,
    denied("illegal-transition", "a paused session does not change route continuity"),
    denied("illegal-transition", ENDED),
  ),
  "waypoint.arrived": row(
    ALLOWED,
    ALLOWED,
    ALLOWED,
    denied("illegal-transition", "a paused session cannot advance to a waypoint"),
    denied("illegal-transition", ENDED),
  ),
  "instruction.issued": row(
    ALLOWED,
    noInstructions("free"),
    noInstructions("track"),
    noInstructions("paused"),
    denied("illegal-transition", ENDED),
  ),
  "instruction.acknowledged": row(
    ALLOWED,
    noInstructions("free"),
    noInstructions("track"),
    noInstructions("paused"),
    denied("illegal-transition", ENDED),
  ),
  "mode.changed": row(
    ALLOWED,
    ALLOWED,
    ALLOWED,
    denied("illegal-transition", "resume the session before changing its mode"),
    denied("illegal-transition", ENDED),
  ),
  "session.paused": row(
    ALLOWED,
    ALLOWED,
    ALLOWED,
    denied("illegal-transition", "the session is already paused"),
    denied("illegal-transition", ENDED),
  ),
  "session.resumed": row(
    denied("illegal-transition", "the session is not paused"),
    denied("illegal-transition", "the session is not paused"),
    denied("illegal-transition", "the session is not paused"),
    ALLOWED,
    denied("illegal-transition", ENDED),
  ),
  "session.completed": row(
    ALLOWED,
    ALLOWED,
    ALLOWED,
    ALLOWED,
    denied("illegal-transition", ENDED),
  ),
  "session.abandoned": row(
    ALLOWED,
    ALLOWED,
    ALLOWED,
    ALLOWED,
    denied("illegal-transition", ENDED),
  ),
  "recording.discarded": row(
    ALLOWED,
    ALLOWED,
    ALLOWED,
    ALLOWED,
    denied("illegal-transition", ENDED),
  ),
  "suggestions.changed": row(
    denied("illegal-transition", "suggestions can change only in a route-free session"),
    ALLOWED,
    denied("illegal-transition", "suggestions can change only in a route-free session"),
    denied("illegal-transition", "resume the route-free session before changing suggestions"),
    denied("illegal-transition", ENDED),
  ),
  "ride.revised": row(
    ALLOWED,
    ALLOWED,
    ALLOWED,
    ALLOWED,
    denied("illegal-transition", ENDED),
  ),
};

/** The table lookup the reducer uses; total by construction. */
export function sessionActivityCell(
  activity: RideSessionActivity,
  eventType: SessionTransitionEventType,
): SessionActivityCell {
  return SESSION_ACTIVITY_MATRIX[eventType][activity];
}

/**
 * `true` when `next` does not precede `previous` (equal instants are the same
 * millisecond, which is legal: two events can share an instant).
 */
export function isMonotonicInstant(previous: string, next: string): boolean {
  const previousMs = Date.parse(previous);
  const nextMs = Date.parse(next);
  if (Number.isNaN(nextMs)) return false;
  if (Number.isNaN(previousMs)) return true;
  return nextMs >= previousMs;
}

/**
 * The ride-document binding fence: a session rides exactly one document
 * revision, and only a `ride.revised` event may move it forward.
 */
export function isBoundToRevision(
  state: { readonly plan: { readonly rideId: string; readonly rideRevision: number } },
  rideId: string,
  rideRevision: number,
): boolean {
  return state.plan.rideId === rideId && state.plan.rideRevision === rideRevision;
}
