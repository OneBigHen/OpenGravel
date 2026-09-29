/**
 * The RideSession authority (02-ARCHITECTURE-CONTRACT §2.3, §7;
 * 08-RIDE-NAVIGATION-AND-FREE-RIDE §1, §6, §13, §28; 17-IMPLEMENTATION-PLAN
 * Task 8.1; OGV-ARC-001, OGV-RID-001/002/005/007/008).
 *
 * The behavioral claims under test:
 *
 * - one typed event union drives one activity machine
 *   (`guided | free | track | paused | completed`) and the legality of every
 *   (activity, event) pair is a published table, not an accident of the switch;
 * - every illegal transition is a typed rejection — never a silent no-op, never
 *   a thrown error, never a mutated input;
 * - `reduce` is total, deterministic and a pure fold: replaying the journal from
 *   the start reproduces the live state byte for byte;
 * - timestamps never run backwards, and the session's RideDocument binding is a
 *   `(rideId, rideRevision)` fence that mid-ride edits advance as events;
 * - track-only sessions never carry turn instructions (OGV-RID-007), a paused
 *   session suspends position ingestion until an explicit resume (OGV-RID-008),
 *   and a Free Ride suggestion rebinds the route without starting a new session
 *   (OGV-RID-002).
 */

import { describe, expect, it } from "vitest";

import { newRideId, type RideId, type StopId } from "@/domain/ride/ids";
import {
  reduce,
  replaySessionJournal,
  type SessionReduceOutcome,
} from "@/domain/ride-session/reducer";
import {
  SESSION_ACTIVITY_MATRIX,
  SESSION_EVENT_TYPES,
  SESSION_MOVING_ACTIVITIES,
  type SessionActivityCell,
} from "@/domain/ride-session/invariants";
import { isRideSessionState } from "@/domain/ride-session/validate";
import {
  asRideSessionId,
  newSessionInstructionId,
  type RideSessionId,
  type SessionInstructionId,
} from "@/domain/ride-session/ids";
import type {
  RideSessionActivity,
  RideSessionEvent,
  RideSessionEventType,
  RideSessionMovingActivity,
  RideSessionState,
  SessionInstruction,
  SessionRouteBinding,
} from "@/domain/ride-session/types";
import { asRouteCandidateId } from "@/domain/route/ids";
import { asRecordingId, type RecordingId } from "@/domain/recording/ids";

const NOW = "2026-09-18T06:00:00.000Z";

/** `at(seconds)` — a monotonic instant relative to `NOW`. */
function at(seconds: number): string {
  return new Date(Date.parse(NOW) + seconds * 1000).toISOString();
}

const RIDE_ID: RideId = newRideId();
const SESSION_ID: RideSessionId = asRideSessionId("sess_8-1-test");

const ROUTE: SessionRouteBinding = {
  planningGeneration: 3,
  routeId: asRouteCandidateId("route_best"),
};
const OTHER_ROUTE: SessionRouteBinding = {
  planningGeneration: 4,
  routeId: asRouteCandidateId("route_alt"),
};

/** Stable test stop identities (the domain mints `stop_…`; tests only narrow). */
function stopId(value: string): StopId {
  return value as StopId;
}

const STOP_ONE = stopId("stop_one");
const STOP_TWO = stopId("stop_two");
const STOP_THREE = stopId("stop_three");
const ITINERARY: readonly StopId[] = [STOP_ONE, STOP_TWO, STOP_THREE];

interface StartOptions {
  readonly activity?: RideSessionMovingActivity;
  readonly rideId?: RideId;
  readonly rideRevision?: number;
  readonly route?: SessionRouteBinding | null;
  readonly itinerary?: readonly StopId[];
  readonly recordingId?: RecordingId | null;
  readonly suggestions?: "on" | "off";
  readonly sessionId?: RideSessionId;
}

function startedEvent(seconds: number, options: StartOptions = {}): RideSessionEvent {
  const activity = options.activity ?? "guided";
  return {
    type: "session.started",
    at: at(seconds),
    sessionId: options.sessionId ?? SESSION_ID,
    activity,
    plan: {
      rideId: options.rideId ?? RIDE_ID,
      rideRevision: options.rideRevision ?? 7,
      route: options.route === undefined ? (activity === "guided" ? ROUTE : null) : options.route,
    },
    itinerary: options.itinerary ?? ITINERARY,
    recordingId:
      options.recordingId === undefined ? asRecordingId("rec_test") : options.recordingId,
    suggestions: options.suggestions ?? "off",
  };
}

function positionEvent(
  seconds: number,
  options: {
    readonly lat?: number;
    readonly accuracyMeters?: number | null;
    readonly headingDegrees?: number | null;
    readonly speedMps?: number | null;
    readonly observedAtSeconds?: number;
  } = {},
): RideSessionEvent {
  return {
    type: "position.updated",
    at: at(seconds),
    position: {
      coordinate: { lon: -105.2 + (options.lat ?? 40.1) / 1000, lat: options.lat ?? 40.1 },
      observedAt: at(options.observedAtSeconds ?? seconds),
      accuracyMeters: options.accuracyMeters === undefined ? 8 : options.accuracyMeters,
      headingDegrees: options.headingDegrees === undefined ? 92 : options.headingDegrees,
      speedMps: options.speedMps === undefined ? 12.5 : options.speedMps,
    },
  };
}

function arrivedEvent(seconds: number): RideSessionEvent {
  return { type: "waypoint.arrived", at: at(seconds) };
}

function instruction(overrides: Partial<SessionInstruction> = {}): SessionInstruction {
  return {
    instructionId: newSessionInstructionId(),
    kind: "turn",
    maneuver: "left",
    roadName: "County Road 12",
    distanceMeters: 180,
    targetStopId: null,
    ...overrides,
  };
}

function issuedEvent(seconds: number, value?: SessionInstruction): RideSessionEvent {
  return { type: "instruction.issued", at: at(seconds), instruction: value ?? instruction() };
}

function acknowledgedEvent(seconds: number, instructionId: SessionInstructionId): RideSessionEvent {
  return { type: "instruction.acknowledged", at: at(seconds), instructionId };
}

function modeEvent(
  seconds: number,
  activity: RideSessionMovingActivity,
  route?: SessionRouteBinding,
): RideSessionEvent {
  return {
    type: "mode.changed",
    at: at(seconds),
    activity,
    ...(route === undefined ? {} : { route }),
  };
}

function pausedEvent(seconds: number): RideSessionEvent {
  return { type: "session.paused", at: at(seconds), reason: "rider" };
}

function resumedEvent(seconds: number): RideSessionEvent {
  return { type: "session.resumed", at: at(seconds) };
}

function completedEvent(seconds: number): RideSessionEvent {
  return { type: "session.completed", at: at(seconds) };
}

function abandonedEvent(seconds: number): RideSessionEvent {
  return { type: "session.abandoned", at: at(seconds) };
}

function revisedEvent(
  seconds: number,
  options: {
    readonly rideRevision: number;
    readonly route?: SessionRouteBinding | null;
    readonly remainingStopIds?: readonly StopId[];
  },
): RideSessionEvent {
  return {
    type: "ride.revised",
    at: at(seconds),
    rideRevision: options.rideRevision,
    route: options.route === undefined ? ROUTE : options.route,
    remainingStopIds: options.remainingStopIds ?? [],
  };
}

function suggestionsEvent(seconds: number, suggestions: "on" | "off"): RideSessionEvent {
  return { type: "suggestions.changed", at: at(seconds), suggestions };
}

function applied(outcome: SessionReduceOutcome): RideSessionState {
  if (outcome.outcome !== "applied") {
    throw new Error(`expected an applied transition, got ${outcome.outcome}: ${outcome.message}`);
  }
  return outcome.state;
}

function apply(state: RideSessionState | null, event: RideSessionEvent): RideSessionState {
  return applied(reduce(state, event));
}

function rejection(state: RideSessionState | null, event: RideSessionEvent) {
  const outcome = reduce(state, event);
  if (outcome.outcome !== "rejected") {
    throw new Error(`expected a rejection, got applied state at ${outcome.state.updatedAt}`);
  }
  return outcome;
}

/** The guided ride with a position fix and an outstanding instruction. */
function guidedRich(): RideSessionState {
  let state = apply(null, startedEvent(0));
  state = apply(state, positionEvent(1));
  state = apply(state, issuedEvent(2));
  return state;
}

/** A state in each activity, built only through legal transitions. */
function stateIn(activity: RideSessionActivity): RideSessionState {
  const guided = guidedRich();
  switch (activity) {
    case "guided":
      return guided;
    case "free":
      return apply(guided, modeEvent(3, "free"));
    case "track":
      return apply(guided, modeEvent(3, "track"));
    case "paused":
      return apply(guided, pausedEvent(3));
    case "completed":
      return apply(guided, completedEvent(4));
  }
}

/** One semantically valid event of each type for the given state. */
function eventFor(
  type: RideSessionEventType,
  state: RideSessionState,
  tick: number,
): RideSessionEvent {
  switch (type) {
    case "position.updated":
      return positionEvent(tick);
    case "off-route.changed":
      return { type: "off-route.changed", at: at(tick), state: "on-route" };
    case "waypoint.arrived":
      return arrivedEvent(tick);
    case "instruction.issued":
      return issuedEvent(tick);
    case "instruction.acknowledged":
      return acknowledgedEvent(
        tick,
        state.activeInstruction?.instructionId ?? newSessionInstructionId(),
      );
    case "mode.changed":
      // Always a real change: a new route binding is what a Free Ride
      // suggestion acceptance looks like (8 §17).
      return modeEvent(tick, "guided", OTHER_ROUTE);
    case "session.paused":
      return pausedEvent(tick);
    case "session.resumed":
      return resumedEvent(tick);
    case "session.completed":
      return completedEvent(tick);
    case "session.abandoned":
      return abandonedEvent(tick);
    case "recording.discarded":
      return { type: "recording.discarded", at: at(tick) };
    case "suggestions.changed":
      return suggestionsEvent(tick, state.suggestions === "on" ? "off" : "on");
    case "ride.revised":
      return revisedEvent(tick, {
        rideRevision: state.plan.rideRevision + 1,
        route: state.plan.route === null ? ROUTE : state.plan.route,
        remainingStopIds: state.remainingStopIds,
      });
    case "session.started":
      throw new Error("session.started is the entry event and has no activity cell");
  }
}

describe("RideSession mode legality table", () => {
  it("publishes a total matrix over every event type and activity", () => {
    expect(Object.keys(SESSION_ACTIVITY_MATRIX).sort()).toEqual([...SESSION_EVENT_TYPES].sort());
    for (const type of SESSION_EVENT_TYPES) {
      expect(Object.keys(SESSION_ACTIVITY_MATRIX[type]).sort()).toEqual(
        [...SESSION_MOVING_ACTIVITIES, "paused", "completed"].sort(),
      );
    }
  });

  it("leaves `session.started` out of the table (it is the null-state entry event)", () => {
    expect(SESSION_EVENT_TYPES).not.toContain("session.started");
  });

  const cells: Array<[RideSessionEventType, RideSessionActivity, SessionActivityCell]> = [];
  for (const type of SESSION_EVENT_TYPES) {
    for (const activity of [...SESSION_MOVING_ACTIVITIES, "paused", "completed"] as const) {
      cells.push([type, activity, SESSION_ACTIVITY_MATRIX[type][activity]]);
    }
  }

  it.each(cells)("reduces %s from %s exactly as the table says", (type, activity, cell) => {
    const state = stateIn(activity);
    const event = eventFor(type, state, 10);
    const outcome = reduce(state, event);
    if (cell.kind === "allowed") {
      expect(outcome.outcome).toBe("applied");
      return;
    }
    expect(outcome.outcome).toBe("rejected");
    if (outcome.outcome === "rejected") expect(outcome.code).toBe(cell.code);
  });
});

describe("RideSession start", () => {
  it("creates the session from a started event and derives the itinerary", () => {
    const state = apply(null, startedEvent(0));

    expect(state.sessionId).toBe(SESSION_ID);
    expect(state.activity).toBe("guided");
    expect(state.resumeActivity).toBeNull();
    expect(state.startedAt).toBe(at(0));
    expect(state.updatedAt).toBe(at(0));
    expect(state.endedAt).toBeNull();
    expect(state.endReason).toBeNull();
    expect(state.plan).toEqual({ rideId: RIDE_ID, rideRevision: 7, route: ROUTE });
    expect(state.completedStopIds).toEqual([]);
    expect(state.remainingStopIds).toEqual(ITINERARY);
    expect(state.recordingId).toBe("rec_test");
    expect(state.suggestions).toBe("off");
    expect(state.position).toBeNull();
    expect(state.offRouteState).toBeNull();
    expect(state.activeInstruction).toBeNull();
    expect(Object.isFrozen(state)).toBe(true);
  });

  it("records route-continuity state only for routed or track activity", () => {
    const guided = apply(apply(null, startedEvent(0)), {
      type: "off-route.changed",
      at: at(1),
      state: "uncertain",
    });
    expect(guided.offRouteState).toBe("uncertain");

    expect(
      rejection(apply(null, startedEvent(0, { activity: "free" })), {
        type: "off-route.changed",
        at: at(1),
        state: "off-route",
      }).code,
    ).toBe("illegal-transition");
  });

  it("rejects every non-start event while there is no session", () => {
    for (const type of SESSION_EVENT_TYPES) {
      const outcome = reduce(null, {
        type,
        at: at(0),
      } as RideSessionEvent);
      expect(outcome.outcome).toBe("rejected");
      if (outcome.outcome === "rejected") expect(outcome.code).toBe("no-session");
    }
  });

  it("refuses a second start on a live session (one physical activity, 8 §1)", () => {
    const state = apply(null, startedEvent(0));

    expect(rejection(state, startedEvent(1)).code).toBe("session-already-started");
    expect(
      rejection(state, startedEvent(1, { sessionId: asRideSessionId("sess_other") })).code,
    ).toBe("session-already-started");
    // A session that ended still refuses a start: a new activity means a new
    // session identity, not a reset of this one.
    expect(rejection(apply(state, completedEvent(1)), startedEvent(2)).code).toBe(
      "session-already-started",
    );
  });

  it("requires a route binding for a guided start and allows none for free/track", () => {
    expect(rejection(null, startedEvent(0, { route: null })).code).toBe(
      "no-route-binding-for-guided",
    );
    expect(apply(null, startedEvent(0, { activity: "free" })).plan.route).toBeNull();
    expect(apply(null, startedEvent(0, { activity: "track" })).plan.route).toBeNull();
  });

  it("sets the route-free suggestion policy explicitly at session start", () => {
    expect(apply(null, startedEvent(0, { activity: "free", suggestions: "off" })).suggestions).toBe("off");
    expect(apply(null, startedEvent(0, { activity: "free", suggestions: "on" })).suggestions).toBe("on");
    expect(
      rejection(null, { ...startedEvent(0), suggestions: "later" } as unknown as RideSessionEvent).code,
    ).toBe("invalid-suggestions");
    expect(
      rejection(null, { ...startedEvent(0), suggestions: "on" } as RideSessionEvent).code,
    ).toBe("invalid-suggestions");
  });

  it("folds paused time from the session journal for recording summaries", () => {
    let state = apply(null, startedEvent(0, { activity: "free" }));
    state = apply(state, pausedEvent(10));
    state = apply(state, resumedEvent(40));
    state = apply(state, { type: "session.paused", at: at(60), reason: "interruption" });
    state = apply(state, resumedEvent(65));

    expect(state.pausedDurationMs).toBe(35_000);
  });

  it("keeps the pause start when another event applies before resume", () => {
    let state = apply(null, startedEvent(0, { activity: "free" }));
    state = apply(state, pausedEvent(10));
    state = apply(state, revisedEvent(310, { rideRevision: 8, route: null }));
    state = apply(state, resumedEvent(610));

    expect(state.pausedDurationMs).toBe(600_000);
    expect((state as unknown as { readonly pausedAt: string | null }).pausedAt).toBeNull();
  });

  it("requires pausedAt exactly while the session is paused", () => {
    const moving = apply(null, startedEvent(0));
    const paused = apply(moving, pausedEvent(1));

    expect(isRideSessionState({ ...paused, pausedAt: null })).toBe(false);
    expect(isRideSessionState({ ...moving, pausedAt: at(1) })).toBe(false);
  });

  it("rejects a duplicate or malformed itinerary", () => {
    expect(
      rejection(null, startedEvent(0, { itinerary: [STOP_ONE, STOP_ONE] })).code,
    ).toBe("invalid-itinerary");
    expect(rejection(null, startedEvent(0, { itinerary: ["not-a-stop"] as unknown as StopId[] })).code).toBe(
      "invalid-itinerary",
    );
  });

  it("rejects a negative revision and a malformed instant", () => {
    expect(rejection(null, startedEvent(0, { rideRevision: -1 })).code).toBe("invalid-plan");
    expect(
      rejection(null, { ...startedEvent(0), at: "yesterday" } as RideSessionEvent).code,
    ).toBe("invalid-timestamp");
  });
});

describe("RideSession position ingestion", () => {
  it("replaces the current reliable position", () => {
    const state = apply(apply(null, startedEvent(0)), positionEvent(1, { lat: 40.5 }));

    expect(state.position?.coordinate.lat).toBe(40.5);
    expect(state.sessionStartPosition).toEqual(state.position?.coordinate);
    expect(state.position?.observedAt).toBe(at(1));
    expect(state.updatedAt).toBe(at(1));
  });

  it("keeps the first accepted fix as the return-to-session-start target", () => {
    const later = positionEvent(5, { lat: 40.7 });
    const state = apply(
      apply(apply(null, startedEvent(0, { activity: "free" })), positionEvent(1, { lat: 40.5 })),
      later,
    );

    expect(state.sessionStartPosition?.lat).toBe(40.5);
    expect(state.position?.coordinate.lat).toBe(40.7);
  });

  it("refuses a fix older than the current one (progress never moves backwards)", () => {
    const state = apply(apply(null, startedEvent(0)), positionEvent(5));

    const outcome = rejection(state, positionEvent(6, { observedAtSeconds: 4 }));
    expect(outcome.code).toBe("position-regression");
  });

  it("refuses a malformed fix", () => {
    const state = apply(null, startedEvent(0));

    expect(rejection(state, positionEvent(1, { lat: Number.NaN })).code).toBe("invalid-position");
    expect(
      rejection(state, positionEvent(1, { accuracyMeters: -3 })).code,
    ).toBe("invalid-position");
    expect(rejection(state, positionEvent(1, { headingDegrees: 400 })).code).toBe(
      "invalid-position",
    );
  });

  it("freezes position ingestion while paused until an explicit resume (8 §13)", () => {
    const moving = apply(apply(null, startedEvent(0)), positionEvent(1));
    const paused = apply(moving, pausedEvent(2));

    expect(rejection(paused, positionEvent(3)).code).toBe("position-while-paused");
    const resumed = apply(paused, resumedEvent(4));
    expect(apply(resumed, positionEvent(5)).position?.observedAt).toBe(at(5));
  });
});

describe("RideSession mode changes", () => {
  it("keeps the pre-pause activity so resume returns to it, never guessing", () => {
    const free = apply(apply(null, startedEvent(0, { activity: "free" })), pausedEvent(1));
    expect(free.resumeActivity).toBe("free");
    expect(free.activity).toBe("paused");

    const resumed = apply(free, resumedEvent(2));
    expect(resumed.activity).toBe("free");
    expect(resumed.resumeActivity).toBeNull();
  });

  it("rejects a no-op mode change instead of silently accepting it", () => {
    const guided = apply(null, startedEvent(0));

    expect(rejection(guided, modeEvent(1, "guided")).code).toBe("mode-unchanged");
    // A rebind of the route is a real change, so it is accepted.
    expect(apply(guided, modeEvent(1, "guided", OTHER_ROUTE)).plan.route).toEqual(OTHER_ROUTE);
  });

  it("requires the route binding when entering guided, and accepts one in the same event (8 §17)", () => {
    const free = apply(null, startedEvent(0, { activity: "free" }));
    expect(free.plan.route).toBeNull();

    expect(rejection(free, modeEvent(1, "guided")).code).toBe("no-route-binding-for-guided");
    const guided = apply(free, modeEvent(2, "guided", ROUTE));
    expect(guided.activity).toBe("guided");
    expect(guided.plan.route).toEqual(ROUTE);
  });

  it("refuses a route binding on a non-guided mode change", () => {
    const guided = apply(null, startedEvent(0));

    expect(rejection(guided, modeEvent(1, "free", OTHER_ROUTE)).code).toBe(
      "route-binding-not-allowed",
    );
  });

  it("drops guidance state when leaving guided or pausing", () => {
    const free = apply(guidedRich(), modeEvent(3, "free"));
    expect(free.activeInstruction).toBeNull();
    expect(free.plan.route).toBeNull();
    expect(apply(guidedRich(), pausedEvent(3)).activeInstruction).toBeNull();
  });
});

describe("RideSession suggestion policy", () => {
  it("toggles suggestions only in a route-free session and preserves the setting through pause", () => {
    const free = apply(null, startedEvent(0, { activity: "free", suggestions: "off" }));
    const enabled = apply(free, suggestionsEvent(1, "on"));
    expect(enabled.suggestions).toBe("on");
    expect(rejection(enabled, suggestionsEvent(2, "on")).code).toBe("suggestions-unchanged");
    const paused = apply(enabled, pausedEvent(3));
    expect(paused.suggestions).toBe("on");
    expect(rejection(paused, suggestionsEvent(4, "off")).code).toBe("illegal-transition");
    expect(apply(apply(paused, resumedEvent(4)), suggestionsEvent(5, "off")).suggestions).toBe("off");
  });

  it.each(["guided", "track", "completed"] as const)("refuses suggestion changes from %s", (activity) => {
    const state = stateIn(activity);
    expect(rejection(state, suggestionsEvent(10, "on")).code).toBe("illegal-transition");
  });
});

describe("RideSession waypoints", () => {
  it("consumes the next pending stop in order and stops at the head", () => {
    let state = apply(null, startedEvent(0));
    state = apply(state, arrivedEvent(1));
    expect(state.completedStopIds).toEqual([STOP_ONE]);
    expect(state.remainingStopIds).toEqual([STOP_TWO, STOP_THREE]);

    state = apply(state, arrivedEvent(2));
    expect(state.completedStopIds).toEqual([STOP_ONE, STOP_TWO]);
    expect(state.remainingStopIds).toEqual([STOP_THREE]);
  });

  it("rejects an arrival with nothing pending (no odometer math, no invented stop)", () => {
    const state = apply(null, startedEvent(0, { itinerary: [] }));

    expect(rejection(state, arrivedEvent(1)).code).toBe("no-pending-waypoint");
  });

  it("is a payload-free marker: the event cannot carry distance or time", () => {
    const event = arrivedEvent(1);

    expect(Object.keys(event).sort()).toEqual(["at", "type"]);
  });
});

describe("RideSession instructions", () => {
  it("issues, supersedes and acknowledges guidance in guided mode", () => {
    const first = instruction();
    const second = instruction();
    let state = apply(apply(null, startedEvent(0)), issuedEvent(1, first));
    expect(state.activeInstruction?.instructionId).toBe(first.instructionId);

    state = apply(state, issuedEvent(2, second));
    expect(state.activeInstruction?.instructionId).toBe(second.instructionId);

    state = apply(state, acknowledgedEvent(3, second.instructionId));
    expect(state.activeInstruction).toBeNull();
    expect(state.lastAcknowledgedInstructionId).toBe(second.instructionId);
    // The superseded instruction is no longer known: acknowledging it is a
    // typed rejection, never a silent no-op.
    expect(rejection(state, acknowledgedEvent(4, first.instructionId)).code).toBe(
      "unknown-instruction",
    );
    expect(rejection(state, acknowledgedEvent(5, second.instructionId)).code).toBe(
      "unknown-instruction",
    );
  });

  it("refuses to re-issue an instruction identity it has already consumed (8 §7)", () => {
    const value = instruction();
    const issued = apply(apply(null, startedEvent(0)), issuedEvent(1, value));
    const acknowledged = apply(issued, acknowledgedEvent(2, value.instructionId));

    expect(rejection(acknowledged, issuedEvent(3, value)).code).toBe("instruction-already-issued");
    expect(rejection(issued, issuedEvent(3, value)).code).toBe("instruction-already-issued");
  });

  it("never invents turn instructions for a track-only session (OGV-RID-007)", () => {
    const track = apply(null, startedEvent(0, { activity: "track", route: null }));

    const issued = rejection(track, issuedEvent(1));
    expect(issued.code).toBe("instructions-unsupported-in-mode");
    expect(issued.message).toContain("track");
  });

  it("refuses instructions in free ride, pause and completion states", () => {
    const free = apply(null, startedEvent(0, { activity: "free" }));
    expect(rejection(free, issuedEvent(1)).code).toBe("instructions-unsupported-in-mode");
    expect(rejection(stateIn("paused"), acknowledgedEvent(4, newSessionInstructionId())).code).toBe(
      "instructions-unsupported-in-mode",
    );
    expect(rejection(stateIn("completed"), issuedEvent(5)).code).toBe("illegal-transition");
  });

  it("rejects a malformed instruction payload", () => {
    const guided = apply(null, startedEvent(0));

    expect(
      rejection(guided, issuedEvent(1, instruction({ kind: "turn", maneuver: null }))).code,
    ).toBe("invalid-instruction");
    expect(
      rejection(guided, issuedEvent(1, instruction({ distanceMeters: -1 }))).code,
    ).toBe("invalid-instruction");
    expect(
      rejection(guided, issuedEvent(1, instruction({ kind: "continue", maneuver: "left" }))).code,
    ).toBe("invalid-instruction");
  });
});

describe("RideSession completion and abandonment", () => {
  it("completes from a moving activity", () => {
    const state = apply(apply(null, startedEvent(0)), completedEvent(1));

    expect(state.activity).toBe("completed");
    expect(state.resumeActivity).toBeNull();
    expect(state.endedAt).toBe(at(1));
    expect(state.endReason).toBe("completed");
  });

  it("completes a paused track session without resurrecting pause semantics", () => {
    const paused = apply(
      apply(null, startedEvent(0, { activity: "track", route: null })),
      pausedEvent(1),
    );
    expect(paused.resumeActivity).toBe("track");

    const completed = apply(paused, completedEvent(2));
    expect(completed.activity).toBe("completed");
    expect(completed.resumeActivity).toBeNull();
    expect((completed as unknown as { readonly pausedAt: string | null }).pausedAt).toBeNull();
    expect(completed.pausedDurationMs).toBe(1_000);
    expect(completed.endReason).toBe("completed");
    // Terminal state refuses every later transition, including the resume the
    // pre-completion pause would otherwise have allowed.
    expect(rejection(completed, resumedEvent(3)).code).toBe("illegal-transition");
  });

  it("distinguishes abandonment from completion in one terminal activity", () => {
    const started = apply(null, startedEvent(0));
    const paused = apply(started, pausedEvent(1));
    const state = apply(paused, abandonedEvent(3));

    expect(state.activity).toBe("completed");
    expect(state.endReason).toBe("abandoned");
    expect((state as unknown as { readonly pausedAt: string | null }).pausedAt).toBeNull();
    expect(state.pausedDurationMs).toBe(2_000);
  });
});

describe("RideSession recording reference", () => {
  it("journals an explicit discard without changing the physical activity", () => {
    const state = apply(null, startedEvent(0, { recordingId: asRecordingId("rec_discard") }));
    const discarded = apply(state, { type: "recording.discarded", at: at(1) });

    expect(discarded.activity).toBe("guided");
    expect(discarded.recordingId).toBeNull();
    expect(discarded.updatedAt).toBe(at(1));
    expect(
      rejection(discarded, { type: "recording.discarded", at: at(2) }).code,
    ).toBe("no-recording-reference");
  });
});

describe("RideSession ride-document binding", () => {
  it("advances the bound revision as an event and keeps completed stops completed", () => {
    let state = apply(null, startedEvent(0));
    state = apply(state, arrivedEvent(1));

    const revised = apply(
      state,
      revisedEvent(2, { rideRevision: 8, remainingStopIds: [STOP_TWO, STOP_THREE] }),
    );
    expect(revised.plan.rideRevision).toBe(8);
    expect(revised.completedStopIds).toEqual([STOP_ONE]);
    expect(revised.remainingStopIds).toEqual([STOP_TWO, STOP_THREE]);
  });

  it("refuses a revision that does not advance", () => {
    const state = apply(null, startedEvent(0, { rideRevision: 7 }));

    expect(rejection(state, revisedEvent(1, { rideRevision: 7 })).code).toBe(
      "ride-revision-regression",
    );
    expect(rejection(state, revisedEvent(1, { rideRevision: 6 })).code).toBe(
      "ride-revision-regression",
    );
  });

  it("never lets an edit reintroduce a stop the session already completed", () => {
    const state = apply(apply(null, startedEvent(0)), arrivedEvent(1));

    expect(
      rejection(state, revisedEvent(2, { rideRevision: 8, remainingStopIds: ITINERARY })).code,
    ).toBe("completed-stop-reintroduced");
  });

  it("keeps guided bound to a route", () => {
    const state = apply(null, startedEvent(0));

    expect(
      rejection(state, revisedEvent(1, { rideRevision: 8, route: null })).code,
    ).toBe("no-route-binding-for-guided");
    // An edit that also rebinds the route is legal (a mid-ride reroute answer).
    expect(
      apply(state, revisedEvent(2, { rideRevision: 8, route: OTHER_ROUTE })).plan.route,
    ).toEqual(OTHER_ROUTE);
  });
});

describe("RideSession reducer contract", () => {
  it("rejects any event whose instant runs backwards", () => {
    const state = apply(apply(null, startedEvent(0)), positionEvent(5));

    expect(rejection(state, arrivedEvent(4)).code).toBe("timestamp-regression");
  });

  it("never mutates or reuses its input state", () => {
    const state = apply(null, startedEvent(0));
    const before = JSON.stringify(state);

    const next = apply(state, positionEvent(1));

    expect(JSON.stringify(state)).toBe(before);
    expect(next).not.toBe(state);
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next.position)).toBe(true);
    expect(Object.isFrozen(next.remainingStopIds)).toBe(true);
  });

  it("is deterministic: the same (state, event) yields the same frozen value twice", () => {
    const state = apply(null, startedEvent(0));
    const event = positionEvent(1);

    const first = applied(reduce(state, event));
    const second = applied(reduce(state, event));

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("replays a long journal to a byte-identical state (fold == live)", () => {
    const instructionValue = instruction();
    const journal: RideSessionEvent[] = [
      startedEvent(0),
      positionEvent(1),
      positionEvent(2),
      issuedEvent(3, instructionValue),
      acknowledgedEvent(4, instructionValue.instructionId),
      arrivedEvent(5),
      positionEvent(6),
      modeEvent(7, "free"),
      pausedEvent(8),
      resumedEvent(9),
      positionEvent(10),
      revisedEvent(11, { rideRevision: 8, route: null, remainingStopIds: [STOP_TWO, STOP_THREE] }),
      modeEvent(12, "guided", ROUTE),
      arrivedEvent(13),
      positionEvent(14),
      completedEvent(15),
    ];

    let live: RideSessionState | null = null;
    for (const event of journal) live = apply(live, event);

    const replay = replaySessionJournal(null, journal);

    expect(replay.state).not.toBeNull();
    expect(JSON.stringify(replay.state)).toBe(JSON.stringify(live));
    expect(replay.appliedCount).toBe(journal.length);
    expect(replay.dropped).toEqual([]);
  });

  it("stops a replay at the first rejected event and reports it honestly", () => {
    const journal: RideSessionEvent[] = [
      startedEvent(0),
      positionEvent(1),
      // A stale fix: rejected by the reducer.
      positionEvent(2, { observedAtSeconds: 0 }),
      arrivedEvent(3),
    ];

    const replay = replaySessionJournal(null, journal);

    expect(replay.appliedCount).toBe(2);
    expect(replay.dropped.map((entry) => entry.reason)).toEqual([
      "rejected-by-reducer",
      "after-dropped-event",
    ]);
    expect(replay.dropped[0]?.code).toBe("position-regression");
    expect(replay.state?.remainingStopIds).toEqual(ITINERARY);
  });
});
