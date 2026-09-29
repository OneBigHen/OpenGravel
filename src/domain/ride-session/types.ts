/**
 * The RideSession value surface (02-ARCHITECTURE-CONTRACT §2.3;
 * 08-RIDE-NAVIGATION-AND-FREE-RIDE §1, §3–§7, §13, §26;
 * 17-IMPLEMENTATION-PLAN Task 8.1; OGV-ARC-001).
 *
 * RideSession is authority #3: **one physical activity**. Guided riding, Free
 * Ride, track following, recording and pause are attributes of one session —
 * never separate recordings (8 §1). It owns its own identity, the activity
 * machine, the selected route binding, the remaining objective (pending stops),
 * the completed stops, the current reliable position, the freshness-carrying
 * fix it came from, the recording reference, the guidance state and the
 * terminal outcome.
 *
 * This module is pure data: every field is readonly, the state is replaced by a
 * new frozen value (never mutated), and the only transition entry is the pure
 * reducer in `reducer.ts`. The event union below is the state machine's whole
 * input surface — there is no `setState`, no patch member, and no event that
 * carries a partial state.
 *
 * ## Three boundary decisions are visible in the shape
 *
 * - **The activity is one enum, not a set of flags.** `paused` is an activity
 *   value (8 §13 "restore paused"), and `resumeActivity` remembers the moving
 *   mode it paused from, so resuming never has to guess. `completed` is
 *   terminal for both `session.completed` and `session.abandoned`; `endReason`
 *   keeps the two distinguishable without inventing a second state.
 * - **The position is a fix, not a derived judgment.** `PositionFix` carries
 *   what the GPS reported (`observedAt`, accuracy, heading, speed) and nothing
 *   age- or quality-shaped: freshness is a function of the *query* clock, so it
 *   is derived at read time in `navigation.ts` where it can never be stale
 *   state pretending to be current (8 §4, OGV-RID-005).
 * - **The ride binding is a revision fence.** `SessionPlan` names the
 *   RideDocument revision the session is riding. A mid-ride document edit
 *   arrives as a `ride.revised` event that advances the fence and replaces only
 *   the pending objective — it is recorded, never applied destructively over
 *   the completed stops (2 §2.1/§2.3).
 */

import type { Coordinate } from "../ride/types";
import type { RideId, StopId } from "../ride/ids";
import type { RouteCandidateId } from "../route/ids";
import type { RecordingId } from "../recording/ids";
import type { SessionInstructionId, RideSessionId } from "./ids";

/** Schema version written into every session state. */
export const RIDE_SESSION_SCHEMA_VERSION = 1;

/**
 * The modes in which the rider is physically moving (8 §1). A `mode.changed`
 * event only ever names one of these: pause and completion are transitions, not
 * modes the rider selects directly.
 */
export type RideSessionMovingActivity = "guided" | "free" | "track";

/**
 * The five activities of the one activity machine (02 §2.3). `paused` is a
 * distinct activity rather than a boolean so a paused ride can never be read as
 * a moving one by accident; `completed` is the single terminal activity.
 */
export type RideSessionActivity = RideSessionMovingActivity | "paused" | "completed";

/**
 * Why a session is paused. `rider` is the explicit pause control; `interruption`
 * is the system's answer to a lost activity — GPS interruption, page lifecycle,
 * or the restore-after-reload transition 8 §13 requires.
 */
export type SessionPauseReason = "rider" | "interruption";

/** How the one terminal activity was reached. */
export type SessionEndReason = "completed" | "abandoned";

/** Whether this route-free session may request Free Ride suggestions. */
export type SessionSuggestions = "on" | "off";

/** The four freshness labels of 8 §4. */
export type PositionQuality = "fresh-good" | "fresh-poor" | "stale" | "unavailable";

/** Sustained route-continuity state owned by the physical activity. */
export type SessionOffRouteState =
  | "on-route"
  | "uncertain"
  | "off-route"
  | "rejoining"
  | "rerouting";

/**
 * One position report as the position pipeline delivered it (8 §3). Deliberately
 * no `ageMs` and no `quality`: both are functions of the clock at read time, and
 * storing them would let a stale fix keep claiming to be current.
 */
export interface PositionFix {
  readonly coordinate: Coordinate;
  /** ISO-8601 instant the fix was observed (not when it reached the session). */
  readonly observedAt: string;
  readonly accuracyMeters: number | null;
  readonly headingDegrees: number | null;
  readonly speedMps: number | null;
  /**
   * `true` when the device reported no speed and the position pipeline
   * derived `speedMps` from successive credible fixes (RIDE-INSTRUMENT-STRIP
   * §6.1). Absent on a device-reported speed and on older journals.
   */
  readonly speedDerived?: boolean;
  /** Device-reported altitude in metres, when the device reports one. */
  readonly altitudeMeters?: number | null;
  /** Device-reported vertical accuracy in metres, when the device reports one. */
  readonly altitudeAccuracyMeters?: number | null;
}

/**
 * The route answer being ridden: the selected candidate plus the planning
 * generation it came from, so a session can prove which answer it follows.
 */
export interface SessionRouteBinding {
  readonly planningGeneration: number;
  readonly routeId: RouteCandidateId;
}

/**
 * The RideDocument revision fence, with the route answer being ridden. `route`
 * is `null` for a Free Ride or track-only session (there is no answer to
 * follow); a guided session always has one.
 */
export interface SessionPlan {
  readonly rideId: RideId;
  readonly rideRevision: number;
  readonly route: SessionRouteBinding | null;
}

/**
 * One issued maneuver (8 §6). There is no rider copy here: the domain states the
 * maneuver, the road name and the distance, and the UI owns the sentence
 * (VNX-007). `maneuver` is present exactly for a `turn` and `null` otherwise —
 * a `continue` has no turn direction, and an `arrive` names the stop it targets.
 */
export interface SessionInstruction {
  readonly instructionId: SessionInstructionId;
  readonly kind: "turn" | "continue" | "arrive";
  readonly maneuver:
    | "left"
    | "right"
    | "slight-left"
    | "slight-right"
    | "straight"
    | "uturn"
    | null;
  readonly roadName: string | null;
  readonly distanceMeters: number;
  readonly targetStopId: StopId | null;
}

/** Fields every session event carries. */
export interface RideSessionEventBase<T extends string> {
  readonly type: T;
  /**
   * ISO-8601 instant the event happened. The journal is ordered by it and the
   * reducer refuses to move it backwards, so a session's timeline is a
   * monotonic sequence rather than an accident of delivery order.
   */
  readonly at: string;
}

/**
 * The typed event union — the session's only input (02 §2.3, 8 §1).
 *
 * `waypoint.arrived` is **payload-free on purpose**: arrival is a position the
 * matching engine (8.2) reports, and the session consumes the next pending stop
 * in order. It performs no odometer arithmetic, so no distance or duration can
 * leak into the state machine from a guess.
 */
export type RideSessionEvent =
  | (RideSessionEventBase<"session.started"> & {
      readonly sessionId: RideSessionId;
      readonly activity: RideSessionMovingActivity;
      readonly plan: SessionPlan;
      /** The stops still ahead, in order; arrival consumes the head. */
      readonly itinerary: readonly StopId[];
      /** The separate recording authority's id (8 §11), referenced, never owned. */
      readonly recordingId: RecordingId | null;
      /** Explicit route-free query policy: recording starts off, Free Ride starts on. */
      readonly suggestions: SessionSuggestions;
    })
  | (RideSessionEventBase<"position.updated"> & { readonly position: PositionFix })
  | (RideSessionEventBase<"off-route.changed"> & {
      readonly state: SessionOffRouteState;
    })
  | (RideSessionEventBase<"waypoint.arrived"> & Record<never, never>)
  | (RideSessionEventBase<"instruction.issued"> & { readonly instruction: SessionInstruction })
  | (RideSessionEventBase<"instruction.acknowledged"> & {
      readonly instructionId: SessionInstructionId;
    })
  | (RideSessionEventBase<"mode.changed"> & {
      readonly activity: RideSessionMovingActivity;
      /**
       * The route answer to bind with the change. It is how accepting a Free
       * Ride suggestion enters a guided segment without starting a new session
       * (8 §17): one event, one activity change, no new recording.
       */
      readonly route?: SessionRouteBinding;
    })
  | (RideSessionEventBase<"session.paused"> & { readonly reason: SessionPauseReason })
  | (RideSessionEventBase<"session.resumed"> & Record<never, never>)
  | (RideSessionEventBase<"session.completed"> & Record<never, never>)
  | (RideSessionEventBase<"session.abandoned"> & Record<never, never>)
  | (RideSessionEventBase<"recording.discarded"> & Record<never, never>)
  | (RideSessionEventBase<"suggestions.changed"> & {
      readonly suggestions: SessionSuggestions;
    })
  | (RideSessionEventBase<"ride.revised"> & {
      /** The new RideDocument revision; it must strictly advance. */
      readonly rideRevision: number;
      /** The binding left behind; `null` is legal only outside guided. */
      readonly route: SessionRouteBinding | null;
      readonly remainingStopIds: readonly StopId[];
    });

/** Every event variant's `type` tag. */
export type RideSessionEventType = RideSessionEvent["type"];

/**
 * Every event type the activity machine can receive *after* the entry event:
 * `session.started` leaves the "no session yet" state and is handled by the
 * reducer's entry path, so the mode-legality table does not cover it.
 */
export type SessionTransitionEventType = Exclude<RideSessionEventType, "session.started">;

/**
 * The whole session state. It is created by `session.started` and replaced by
 * every applied event; terminal in `completed` except for the events the
 * activity matrix refuses.
 */
export interface RideSessionState {
  readonly schemaVersion: number;
  readonly sessionId: RideSessionId;
  readonly activity: RideSessionActivity;
  /** The moving activity a `paused` session resumes into; `null` otherwise. */
  readonly resumeActivity: RideSessionMovingActivity | null;
  /** The event instant that began the current pause; `null` unless paused. */
  readonly pausedAt: string | null;
  readonly plan: SessionPlan;
  readonly startedAt: string;
  /** The last applied event's instant; the monotonic fence for the journal. */
  readonly updatedAt: string;
  readonly endedAt: string | null;
  readonly endReason: SessionEndReason | null;
  /** The current reliable position, or `null` before the first fix. */
  readonly position: PositionFix | null;
  /** The first accepted session fix; the explicit fallback target for Head Home. */
  readonly sessionStartPosition: Coordinate | null;
  /** Null until the matcher has made its first route-continuity decision. */
  readonly offRouteState: SessionOffRouteState | null;
  readonly completedStopIds: readonly StopId[];
  readonly remainingStopIds: readonly StopId[];
  /** The outstanding maneuver, or `null` when none is issued/one was acked. */
  readonly activeInstruction: SessionInstruction | null;
  /**
   * The last maneuver the rider consumed. Kept because it is the fence that
   * refuses a re-issued identity after acknowledgement (8 §7): the session
   * never re-announces an instruction it already delivered.
   */
  readonly lastAcknowledgedInstructionId: SessionInstructionId | null;
  /** The recording authority's reference; only explicit discard clears it (8 §11). */
  readonly recordingId: RecordingId | null;
  /** Route-free suggestion policy; retained across pause and guided segments. */
  readonly suggestions: SessionSuggestions;
  /** Completed paused wall time folded from session.paused/session.resumed journal events. */
  readonly pausedDurationMs: number;
}

/**
 * The typed rejection codes. Every illegal transition answers with one of
 * these; none of them is a silent no-op, and none of them throws.
 */
export type RideSessionErrorCode =
  | "no-session"
  | "session-already-started"
  | "illegal-transition"
  | "mode-unchanged"
  | "no-route-binding-for-guided"
  | "route-binding-not-allowed"
  | "invalid-activity"
  | "invalid-session-id"
  | "invalid-plan"
  | "invalid-itinerary"
  | "invalid-position"
  | "invalid-off-route-state"
  | "invalid-instruction"
  | "invalid-timestamp"
  | "timestamp-regression"
  | "position-regression"
  | "position-while-paused"
  | "no-pending-waypoint"
  | "unknown-instruction"
  | "instruction-already-issued"
  | "instructions-unsupported-in-mode"
  | "ride-revision-regression"
  | "completed-stop-reintroduced"
  | "no-recording-reference"
  | "invalid-suggestions"
  | "suggestions-unchanged";

/** The reducer's total result: a new frozen state, or a typed rejection. */
export type SessionReduceOutcome =
  | { readonly outcome: "applied"; readonly state: RideSessionState }
  | {
      readonly outcome: "rejected";
      readonly code: RideSessionErrorCode;
      readonly message: string;
    };
