/**
 * The RideSession reducer (02-ARCHITECTURE-CONTRACT §2.3, §5, §7;
 * 08-RIDE-NAVIGATION-AND-FREE-RIDE §1, §6, §7, §13, §28;
 * 17-IMPLEMENTATION-PLAN Task 8.1; OGV-ARC-001, OGV-RID-001/002/005/007/008).
 *
 * `reduce` is the only transition entry for the physical-activity authority. It
 * is pure (the input state is never mutated, every applied result is a new
 * deeply frozen value), total (it always returns a value, never throws) and
 * deterministic (the same state and event produce the same frozen state), and it
 * is exhaustive: the switch matches every event variant, and adding one without
 * handling it stops narrowing to `never` and fails the type check.
 *
 * ## Ordered checks (the order is part of the contract)
 *
 * 1. **Entry** — with no state, only `session.started` applies; anything else is
 *    `no-session`. With a state, `session.started` is `session-already-started`:
 *    a new activity needs a new session identity (8 §1).
 * 2. **Instant** — an unreadable `at` is `invalid-timestamp`; an `at` before
 *    `state.updatedAt` is `timestamp-regression`, so the journal's timeline is
 *    monotonic rather than delivery-ordered.
 * 3. **Activity legality** — the published table (`invariants.ts`) decides
 *    whether the event may be received at all in the current activity, and names
 *    the rejection code: `position-while-paused`,
 *    `instructions-unsupported-in-mode` (track/free, OGV-RID-007), or
 *    `illegal-transition` for a paused-resume mismatch and every terminal cell.
 * 4. **Payload** — shape validation for the variant's own payload
 *    (`invalid-position`, `invalid-instruction`, `invalid-itinerary`, …), plus
 *    the semantic fences: a fix older than the current one
 *    (`position-regression`), an unknown or re-issued instruction
 *    (`unknown-instruction`, `instruction-already-issued`), an arrival with
 *    nothing pending (`no-pending-waypoint`), a ride revision that does not
 *    advance (`ride-revision-regression`), and a completed stop that an edit
 *    tries to put back on the road (`completed-stop-reintroduced`).
 *
 * ## Two documented transition decisions
 *
 * - **Completing a paused session resolves the pause.** `session.completed` is
 *   legal from `paused` (the rider can end the ride while stopped), and the
 *   result is the plain terminal activity with `resumeActivity: null`. Nothing
 *   is lost by that: the journal still records the pause and the resume
 *   activity, so "was this a track-only ride?" is answered by history, not by a
 *   terminal state that would have to carry a mode it no longer rides.
 * - **Leaving guided (or pausing) drops the outstanding maneuver.** Guidance is
 *   re-issued by the engine after the mode settles, so a pause can never
 *   present a maneuver from before it (8 §13), and a track-only segment can
 *   never inherit a turn instruction from the guided one (8 §6).
 */

import { deepFreeze } from "../util/freeze";
import { isMonotonicInstant, sessionActivityCell } from "./invariants";
import {
  RIDE_SESSION_SCHEMA_VERSION,
  type RideSessionErrorCode,
  type RideSessionEvent,
  type RideSessionMovingActivity,
  type RideSessionState,
  type SessionReduceOutcome,
  type SessionTransitionEventType,
} from "./types";
import {
  isRideSessionMovingActivity,
  validatePositionFix,
  validateSessionInstruction,
  validateSessionPlan,
  validateSessionRouteBinding,
  validateStopIds,
} from "./validate";

type StartEvent = Extract<RideSessionEvent, { type: "session.started" }>;
type TransitionEvent = Exclude<RideSessionEvent, { type: "session.started" }>;

/** The reducer's own result vocabulary, re-exported for its callers. */
export type { SessionReduceOutcome } from "./types";

/**
 * Compile-time exhaustiveness fence: an event variant the switch forgets stops
 * narrowing to `never` and fails the type check here.
 */
function assertNever(value: never): never {
  throw new Error(`unhandled ride-session event: ${String(value)}`);
}

function rejected(code: RideSessionErrorCode, message: string): SessionReduceOutcome {
  return { outcome: "rejected", code, message };
}

function applied(state: RideSessionState): SessionReduceOutcome {
  return { outcome: "applied", state: deepFreeze(state) };
}

/** One new frozen state: `changes` over the current state, stamped with `at`. */
function next(
  state: RideSessionState,
  changes: Partial<RideSessionState>,
  at: string,
): RideSessionState {
  return { ...state, ...changes, updatedAt: at };
}

function isReadableInstant(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isBrandedId(value: unknown, prefix: string): value is string {
  return typeof value === "string" && value.startsWith(prefix) && value.length > prefix.length;
}

function startSession(event: StartEvent): SessionReduceOutcome {
  if (!isReadableInstant(event.at)) {
    return rejected("invalid-timestamp", `"${String(event.at)}" is not a readable instant`);
  }
  if (!isBrandedId(event.sessionId, "sess_")) {
    return rejected(
      "invalid-session-id",
      `session id "${String(event.sessionId)}" is not a sess_ identifier`,
    );
  }
  if (!isRideSessionMovingActivity(event.activity)) {
    return rejected(
      "invalid-activity",
      `a session cannot start as "${String(event.activity)}"`,
    );
  }
  const planIssues = validateSessionPlan(event.plan);
  if (planIssues.length > 0) return rejected("invalid-plan", planIssues.join("; "));
  const itineraryIssues = validateStopIds(event.itinerary, "itinerary");
  if (itineraryIssues.length > 0) {
    return rejected("invalid-itinerary", itineraryIssues.join("; "));
  }
  if (event.activity === "guided" && event.plan.route === null) {
    return rejected(
      "no-route-binding-for-guided",
      "a guided session must name the route answer it follows",
    );
  }
  if (event.recordingId !== null && !isBrandedId(event.recordingId, "rec_")) {
    return rejected("invalid-plan", "the recording reference must be null or a rec_ identifier");
  }
  if (
    (event.suggestions !== "on" && event.suggestions !== "off") ||
    (event.suggestions === "on" && event.activity !== "free")
  ) {
    return rejected(
      "invalid-suggestions",
      "suggestions must be on or off, and can be on only for a route-free session",
    );
  }

  const state: RideSessionState = {
    schemaVersion: RIDE_SESSION_SCHEMA_VERSION,
    sessionId: event.sessionId,
    activity: event.activity,
    resumeActivity: null,
    pausedAt: null,
    plan: event.plan,
    startedAt: event.at,
    updatedAt: event.at,
    endedAt: null,
    endReason: null,
    position: null,
    sessionStartPosition: null,
    offRouteState: null,
    completedStopIds: [],
    remainingStopIds: [...event.itinerary],
    activeInstruction: null,
    lastAcknowledgedInstructionId: null,
    recordingId: event.recordingId,
    suggestions: event.suggestions,
    pausedDurationMs: 0,
  };
  return applied(state);
}

function applyTransition(
  state: RideSessionState,
  event: TransitionEvent,
): SessionReduceOutcome {
  switch (event.type) {
    case "position.updated": {
      const issues = validatePositionFix(event.position);
      if (issues.length > 0) return rejected("invalid-position", issues.join("; "));
      const previous = state.position;
      if (
        previous !== null &&
        !isMonotonicInstant(previous.observedAt, event.position.observedAt)
      ) {
        return rejected(
          "position-regression",
          `a fix observed at ${event.position.observedAt} precedes the current fix at ${previous.observedAt}`,
        );
      }
      return applied(next(
        state,
        {
          position: event.position,
          sessionStartPosition: state.sessionStartPosition ?? event.position.coordinate,
        },
        event.at,
      ));
    }

    case "off-route.changed": {
      const valid =
        event.state === "on-route" ||
        event.state === "uncertain" ||
        event.state === "off-route" ||
        event.state === "rejoining" ||
        event.state === "rerouting";
      if (!valid) {
        return rejected(
          "invalid-off-route-state",
          `unknown off-route state "${String(event.state)}"`,
        );
      }
      return applied(next(state, { offRouteState: event.state }, event.at));
    }

    case "waypoint.arrived": {
      const head = state.remainingStopIds[0];
      if (head === undefined) {
        return rejected(
          "no-pending-waypoint",
          "the session has no pending waypoint to arrive at",
        );
      }
      return applied(
        next(
          state,
          {
            completedStopIds: [...state.completedStopIds, head],
            remainingStopIds: state.remainingStopIds.slice(1),
          },
          event.at,
        ),
      );
    }

    case "instruction.issued": {
      const issues = validateSessionInstruction(event.instruction);
      if (issues.length > 0) return rejected("invalid-instruction", issues.join("; "));
      const instructionId = event.instruction.instructionId;
      if (
        instructionId === state.activeInstruction?.instructionId ||
        instructionId === state.lastAcknowledgedInstructionId
      ) {
        return rejected(
          "instruction-already-issued",
          `instruction "${instructionId}" has already been issued in this session`,
        );
      }
      return applied(next(state, { activeInstruction: event.instruction }, event.at));
    }

    case "instruction.acknowledged": {
      if (state.activeInstruction?.instructionId !== event.instructionId) {
        return rejected(
          "unknown-instruction",
          `no outstanding instruction "${event.instructionId}" to acknowledge`,
        );
      }
      return applied(
        next(
          state,
          {
            activeInstruction: null,
            lastAcknowledgedInstructionId: event.instructionId,
          },
          event.at,
        ),
      );
    }

    case "mode.changed": {
      if (event.activity === state.activity && event.route === undefined) {
        return rejected("mode-unchanged", `the session is already ${state.activity}`);
      }
      if (event.route !== undefined) {
        const issues = validateSessionRouteBinding(event.route);
        if (issues.length > 0) return rejected("invalid-plan", issues.join("; "));
        if (event.activity !== "guided") {
          return rejected(
            "route-binding-not-allowed",
            `only a guided session rides a route answer, not ${event.activity}`,
          );
        }
      }
      const route = event.activity === "guided" ? (event.route ?? state.plan.route) : null;
      if (event.activity === "guided" && route === null) {
        return rejected(
          "no-route-binding-for-guided",
          "entering guided needs the route answer to guide by",
        );
      }
      return applied(
        next(
          state,
          {
            activity: event.activity,
            resumeActivity: null,
            plan: { ...state.plan, route },
            activeInstruction: null,
            offRouteState: null,
          },
          event.at,
        ),
      );
    }

    case "session.paused": {
      if (!isRideSessionMovingActivity(state.activity)) {
        return rejected(
          "illegal-transition",
          `a ${state.activity} session cannot be paused`,
        );
      }
      return applied(
        next(
          state,
          {
            activity: "paused",
            resumeActivity: state.activity,
            pausedAt: event.at,
            activeInstruction: null,
          },
          event.at,
        ),
      );
    }

    case "session.resumed": {
      const resumeActivity: RideSessionMovingActivity | null = state.resumeActivity;
      if (resumeActivity === null) {
        return rejected(
          "illegal-transition",
          "the session has no paused activity to resume into",
        );
      }
      const pausedAt = state.pausedAt;
      if (pausedAt === null) {
        return rejected("illegal-transition", "the session has no pause start to resume from");
      }
      const pauseDurationMs = Math.max(
        0,
        Date.parse(event.at) - Date.parse(pausedAt),
      );
      return applied(
        next(
          state,
          {
            activity: resumeActivity,
            resumeActivity: null,
            pausedAt: null,
            pausedDurationMs: state.pausedDurationMs + pauseDurationMs,
          },
          event.at,
        ),
      );
    }

    case "session.completed":
    case "session.abandoned": {
      const endReason = event.type === "session.completed" ? "completed" : "abandoned";
      const finalPauseDurationMs =
        state.pausedAt === null
          ? 0
          : Math.max(0, Date.parse(event.at) - Date.parse(state.pausedAt));
      return applied(
        next(
          state,
          {
            activity: "completed",
            resumeActivity: null,
            pausedAt: null,
            pausedDurationMs: state.pausedDurationMs + finalPauseDurationMs,
            endedAt: event.at,
            endReason,
            activeInstruction: null,
          },
          event.at,
        ),
      );
    }

    case "recording.discarded": {
      if (state.recordingId === null) {
        return rejected("no-recording-reference", "the session has no recording to discard");
      }
      return applied(next(state, { recordingId: null }, event.at));
    }

    case "suggestions.changed": {
      if (event.suggestions !== "on" && event.suggestions !== "off") {
        return rejected("invalid-suggestions", "suggestions must be on or off");
      }
      if (event.suggestions === state.suggestions) {
        return rejected("suggestions-unchanged", `suggestions are already ${state.suggestions}`);
      }
      return applied(next(state, { suggestions: event.suggestions }, event.at));
    }

    case "ride.revised": {
      if (
        !Number.isInteger(event.rideRevision) ||
        event.rideRevision <= state.plan.rideRevision
      ) {
        return rejected(
          "ride-revision-regression",
          `revision ${String(event.rideRevision)} does not advance the bound revision ${state.plan.rideRevision}`,
        );
      }
      const issues = validateStopIds(event.remainingStopIds, "ride.revised.remainingStopIds");
      if (issues.length > 0) return rejected("invalid-itinerary", issues.join("; "));
      if (event.route !== null) {
        const routeIssues = validateSessionRouteBinding(event.route);
        if (routeIssues.length > 0) return rejected("invalid-plan", routeIssues.join("; "));
      }
      const completed = new Set<string>(state.completedStopIds);
      const reintroduced = event.remainingStopIds.find((stopId) => completed.has(stopId));
      if (reintroduced !== undefined) {
        return rejected(
          "completed-stop-reintroduced",
          `stop "${reintroduced}" is already completed and cannot return to the remaining objective`,
        );
      }
      if (state.activity === "guided" && event.route === null) {
        return rejected(
          "no-route-binding-for-guided",
          "a guided session cannot be left without a route answer",
        );
      }
      return applied(
        next(
          state,
          {
            plan: {
              ...state.plan,
              rideRevision: event.rideRevision,
              route: event.route,
            },
            remainingStopIds: [...event.remainingStopIds],
            offRouteState: null,
          },
          event.at,
        ),
      );
    }

    default:
      return assertNever(event);
  }
}

/**
 * Applies one typed event to the session (see the module comment for the ordered
 * checks). Pure and total: every input returns an outcome value.
 */
export function reduce(
  state: RideSessionState | null,
  event: RideSessionEvent,
): SessionReduceOutcome {
  if (state === null) {
    if (event.type !== "session.started") {
      return rejected("no-session", `"${event.type}" arrived with no session to apply it to`);
    }
    return startSession(event);
  }
  if (event.type === "session.started") {
    return rejected(
      "session-already-started",
      "one physical activity per session; a new ride needs a new session identity",
    );
  }
  if (!isReadableInstant(event.at)) {
    return rejected("invalid-timestamp", `"${String(event.at)}" is not a readable instant`);
  }
  if (!isMonotonicInstant(state.updatedAt, event.at)) {
    return rejected(
      "timestamp-regression",
      `event at ${event.at} precedes the session's last event at ${state.updatedAt}`,
    );
  }
  const cell = sessionActivityCell(state.activity, event.type as SessionTransitionEventType);
  if (cell.kind === "rejected") return rejected(cell.code, cell.reason);
  return applyTransition(state, event as TransitionEvent);
}

/** One journal position a replay did not apply. */
export interface SessionJournalReplayDrop {
  readonly index: number;
  readonly reason: "rejected-by-reducer" | "after-dropped-event";
  readonly code?: RideSessionErrorCode;
  readonly message: string;
}

export interface SessionJournalReplay {
  readonly state: RideSessionState | null;
  readonly appliedCount: number;
  readonly dropped: readonly SessionJournalReplayDrop[];
}

/**
 * Folds a journal over an optional starting state.
 *
 * The replay **stops at the first rejected event**: a state machine's later
 * events can depend on the one that failed, so continuing would produce a state
 * no live session could have reached. Everything from the offender onward is
 * reported as dropped, which is exactly what a crash-recovered tail needs to
 * state honestly (8 §13).
 */
export function replaySessionJournal(
  state: RideSessionState | null,
  events: readonly RideSessionEvent[],
): SessionJournalReplay {
  let current = state;
  let appliedCount = 0;
  let droppedAt: number | null = null;
  const dropped: SessionJournalReplayDrop[] = [];

  events.forEach((event, index) => {
    if (droppedAt !== null) {
      dropped.push({
        index,
        reason: "after-dropped-event",
        message: `not applied: the event at index ${droppedAt} was rejected`,
      });
      return;
    }
    const outcome = reduce(current, event);
    if (outcome.outcome === "rejected") {
      droppedAt = index;
      dropped.push({
        index,
        reason: "rejected-by-reducer",
        code: outcome.code,
        message: outcome.message,
      });
      return;
    }
    current = outcome.state;
    appliedCount += 1;
  });

  return { state: current, appliedCount, dropped };
}
