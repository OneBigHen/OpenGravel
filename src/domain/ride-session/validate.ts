/**
 * Pure validation for the physical-activity state (02-ARCHITECTURE-CONTRACT
 * §2.3; 08-RIDE-NAVIGATION-AND-FREE-RIDE §13; 17-IMPLEMENTATION-PLAN Task 8.1).
 *
 * Validation reports issues; it never throws and never repairs. Its inputs are
 * untrusted — a persisted checkpoint row, a journal row, a recovered record —
 * so every enum-shaped field, id prefix, instant and numeric bound is
 * re-checked at runtime. The reducer calls it on the payloads it accepts; the
 * storage adapter calls it to decide whether a journal row is readable at all,
 * which is what turns a truncated record into an honest "dropped" entry instead
 * of a crash.
 *
 * A validator's job here is deciding *shape*, not policy: whether a `completed`
 * session may accept a resume is the activity table's answer, and whether a fix
 * is fresh is the clock's.
 */

import {
  RIDE_SESSION_SCHEMA_VERSION,
  type PositionFix,
  type RideSessionActivity,
  type RideSessionEvent,
  type RideSessionMovingActivity,
  type RideSessionState,
  type SessionInstruction,
  type SessionPlan,
  type SessionRouteBinding,
} from "./types";
import { SESSION_ACTIVITIES, SESSION_EVENT_TYPES, SESSION_MOVING_ACTIVITIES } from "./invariants";

const SESSION_PAUSE_REASONS = ["rider", "interruption"] as const;
const SESSION_END_REASONS = ["completed", "abandoned"] as const;
const INSTRUCTION_KINDS = ["turn", "continue", "arrive"] as const;
const MANEUVERS = [
  "left",
  "right",
  "slight-left",
  "slight-right",
  "straight",
  "uturn",
] as const;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isInstant(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isBrandedId(value: unknown, prefix: string): value is string {
  return typeof value === "string" && value.startsWith(prefix) && value.length > prefix.length;
}

function isMember<T extends string>(value: unknown, members: readonly T[]): value is T {
  return typeof value === "string" && (members as readonly string[]).includes(value);
}

/** Narrows one activity value; exported because a persisted row needs it alone. */
export function isRideSessionActivity(value: unknown): value is RideSessionActivity {
  return isMember(value, SESSION_ACTIVITIES);
}

/** Narrows one moving activity value. */
export function isRideSessionMovingActivity(
  value: unknown,
): value is RideSessionMovingActivity {
  return isMember(value, SESSION_MOVING_ACTIVITIES);
}

export function validatePositionFix(value: unknown): readonly string[] {
  if (!isRecord(value)) return ["position must be an object"];
  const issues: string[] = [];
  const coordinate = value.coordinate;
  if (!isRecord(coordinate)) {
    issues.push("position.coordinate must be an object");
  } else {
    const lat = coordinate.lat;
    const lon = coordinate.lon;
    if (!isFiniteNumber(lat) || lat < -90 || lat > 90) {
      issues.push("position.coordinate.lat must be a finite latitude");
    }
    if (!isFiniteNumber(lon) || lon < -180 || lon > 180) {
      issues.push("position.coordinate.lon must be a finite longitude");
    }
  }
  if (!isInstant(value.observedAt)) {
    issues.push("position.observedAt must be a readable instant");
  }
  const accuracy = value.accuracyMeters;
  if (accuracy !== null && (!isFiniteNumber(accuracy) || accuracy < 0)) {
    issues.push("position.accuracyMeters must be null or a non-negative number");
  }
  const heading = value.headingDegrees;
  if (heading !== null && (!isFiniteNumber(heading) || heading < 0 || heading >= 360)) {
    issues.push("position.headingDegrees must be null or a heading in [0, 360)");
  }
  const speed = value.speedMps;
  if (speed !== null && (!isFiniteNumber(speed) || speed < 0)) {
    issues.push("position.speedMps must be null or a non-negative number");
  }
  if (value.speedDerived !== undefined && typeof value.speedDerived !== "boolean") {
    issues.push("position.speedDerived must be a boolean when present");
  }
  const altitude = value.altitudeMeters;
  if (altitude !== undefined && altitude !== null && !isFiniteNumber(altitude)) {
    issues.push("position.altitudeMeters must be null or a finite number when present");
  }
  const altitudeAccuracy = value.altitudeAccuracyMeters;
  if (
    altitudeAccuracy !== undefined &&
    altitudeAccuracy !== null &&
    (!isFiniteNumber(altitudeAccuracy) || altitudeAccuracy < 0)
  ) {
    issues.push("position.altitudeAccuracyMeters must be null or a non-negative number when present");
  }
  return issues;
}

export function validateSessionInstruction(value: unknown): readonly string[] {
  if (!isRecord(value)) return ["instruction must be an object"];
  const issues: string[] = [];
  if (!isBrandedId(value.instructionId, "instr_")) {
    issues.push("instruction.instructionId must be an instr_ identifier");
  }
  if (!isMember(value.kind, INSTRUCTION_KINDS)) {
    issues.push(`instruction.kind must be one of ${INSTRUCTION_KINDS.join(", ")}`);
  }
  const maneuver = value.maneuver;
  if (value.kind === "turn") {
    if (!isMember(maneuver, MANEUVERS)) {
      issues.push("a turn instruction must name a maneuver");
    }
  } else if (maneuver !== null) {
    issues.push("only a turn instruction carries a maneuver");
  }
  if (value.roadName !== null && typeof value.roadName !== "string") {
    issues.push("instruction.roadName must be null or a string");
  }
  if (!isFiniteNumber(value.distanceMeters) || value.distanceMeters < 0) {
    issues.push("instruction.distanceMeters must be a non-negative number");
  }
  if (value.targetStopId !== null && !isBrandedId(value.targetStopId, "stop_")) {
    issues.push("instruction.targetStopId must be null or a stop_ identifier");
  }
  return issues;
}

export function validateStopIds(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) return [`${label} must be an array`];
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isBrandedId(entry, "stop_")) {
      issues.push(`${label} entries must be stop_ identifiers`);
      continue;
    }
    if (seen.has(entry)) issues.push(`${label} must not repeat "${entry}"`);
    seen.add(entry);
  }
  return issues;
}

export function validateSessionRouteBinding(value: unknown): readonly string[] {
  if (!isRecord(value)) return ["route must be an object"];
  const issues: string[] = [];
  if (!isNonNegativeInteger(value.planningGeneration)) {
    issues.push("route.planningGeneration must be a non-negative integer");
  }
  if (!isBrandedId(value.routeId, "route_")) {
    issues.push("route.routeId must be a route_ identifier");
  }
  return issues;
}

export function validateSessionPlan(value: unknown): readonly string[] {
  if (!isRecord(value)) return ["plan must be an object"];
  const issues: string[] = [];
  if (!isBrandedId(value.rideId, "ride_")) {
    issues.push("plan.rideId must be a ride_ identifier");
  }
  if (!isNonNegativeInteger(value.rideRevision)) {
    issues.push("plan.rideRevision must be a non-negative integer");
  }
  if (value.route !== null) issues.push(...validateSessionRouteBinding(value.route));
  return issues;
}

/** Validates one event's shape. A malformed row is what "droppable" means. */
export function validateRideSessionEvent(value: unknown): readonly string[] {
  if (!isRecord(value)) return ["event must be an object"];
  const type = value.type;
  if (type === "session.started") {
    const issues: string[] = [];
    if (!isBrandedId(value.sessionId, "sess_")) {
      issues.push("session.started.sessionId must be a sess_ identifier");
    }
    if (!isRideSessionMovingActivity(value.activity)) {
      issues.push("session.started.activity must be a moving activity");
    }
    issues.push(...validateSessionPlan(value.plan));
    issues.push(...validateStopIds(value.itinerary, "session.started.itinerary"));
    if (value.recordingId !== null && !isBrandedId(value.recordingId, "rec_")) {
      issues.push("session.started.recordingId must be null or a rec_ identifier");
    }
    if (value.suggestions !== "on" && value.suggestions !== "off") {
      issues.push("session.started.suggestions must be on or off");
    } else if (value.suggestions === "on" && value.activity !== "free") {
      issues.push("session.started.suggestions can be on only for a route-free session");
    }
    if (!isInstant(value.at)) issues.push("session.started.at must be a readable instant");
    return issues;
  }
  if (!isMember(type, SESSION_EVENT_TYPES)) {
    return [`unknown event type "${String(type)}"`];
  }
  const issues: string[] = [];
  if (!isInstant(value.at)) issues.push(`at must be a readable instant`);
  switch (type) {
    case "position.updated":
      issues.push(...validatePositionFix(value.position));
      break;
    case "off-route.changed":
      if (
        value.state !== "on-route" &&
        value.state !== "uncertain" &&
        value.state !== "off-route" &&
        value.state !== "rejoining" &&
        value.state !== "rerouting"
      ) {
        issues.push("off-route.changed.state must be a known continuity state");
      }
      break;
    case "waypoint.arrived":
      break;
    case "instruction.issued":
      issues.push(...validateSessionInstruction(value.instruction));
      break;
    case "instruction.acknowledged":
      if (!isBrandedId(value.instructionId, "instr_")) {
        issues.push("instruction.acknowledged.instructionId must be an instr_ identifier");
      }
      break;
    case "mode.changed":
      if (!isRideSessionMovingActivity(value.activity)) {
        issues.push("mode.changed.activity must be a moving activity");
      }
      if (value.route !== undefined) issues.push(...validateSessionRouteBinding(value.route));
      break;
    case "session.paused":
      if (!isMember(value.reason, SESSION_PAUSE_REASONS)) {
        issues.push(`session.paused.reason must be one of ${SESSION_PAUSE_REASONS.join(", ")}`);
      }
      break;
    case "session.resumed":
    case "session.completed":
    case "session.abandoned":
    case "recording.discarded":
      break;
    case "suggestions.changed":
      if (value.suggestions !== "on" && value.suggestions !== "off") {
        issues.push("suggestions.changed.suggestions must be on or off");
      }
      break;
    case "ride.revised":
      if (!isNonNegativeInteger(value.rideRevision)) {
        issues.push("ride.revised.rideRevision must be a non-negative integer");
      }
      if (value.route !== null) issues.push(...validateSessionRouteBinding(value.route));
      issues.push(...validateStopIds(value.remainingStopIds, "ride.revised.remainingStopIds"));
      break;
  }
  return issues;
}

/** A journal row's payload is readable: the event is a well-formed variant. */
export function isRideSessionEvent(value: unknown): value is RideSessionEvent {
  try {
    return validateRideSessionEvent(value).length === 0;
  } catch {
    return false;
  }
}

export function validateRideSessionState(value: unknown): readonly string[] {
  if (!isRecord(value)) return ["state must be an object"];
  const issues: string[] = [];
  if (value.schemaVersion !== RIDE_SESSION_SCHEMA_VERSION) {
    issues.push(`state.schemaVersion must be ${RIDE_SESSION_SCHEMA_VERSION}`);
  }
  if (!isBrandedId(value.sessionId, "sess_")) {
    issues.push("state.sessionId must be a sess_ identifier");
  }
  if (!isRideSessionActivity(value.activity)) {
    issues.push("state.activity must be a known activity");
  }
  const resumeActivity = value.resumeActivity;
  if (resumeActivity !== null && !isRideSessionMovingActivity(resumeActivity)) {
    issues.push("state.resumeActivity must be null or a moving activity");
  }
  if (value.activity === "paused" && resumeActivity === null) {
    issues.push("a paused state must name the moving activity it resumes into");
  }
  if (value.activity !== "paused" && resumeActivity !== null) {
    issues.push("only a paused state carries a resume activity");
  }
  if (value.activity === "paused") {
    if (!isInstant(value.pausedAt)) {
      issues.push("a paused state must carry a readable pause start instant");
    }
  } else if (value.pausedAt !== null) {
    issues.push("only a paused state carries a pause start instant");
  }
  issues.push(...validateSessionPlan(value.plan));
  if (!isInstant(value.startedAt)) issues.push("state.startedAt must be a readable instant");
  if (!isInstant(value.updatedAt)) issues.push("state.updatedAt must be a readable instant");
  if (value.endedAt !== null && !isInstant(value.endedAt)) {
    issues.push("state.endedAt must be null or a readable instant");
  }
  if (value.endReason !== null && !isMember(value.endReason, SESSION_END_REASONS)) {
    issues.push("state.endReason must be null or a known end reason");
  }
  if (value.position !== null) issues.push(...validatePositionFix(value.position));
  if (value.sessionStartPosition !== null) {
    const coordinate = value.sessionStartPosition;
    if (!isRecord(coordinate)) {
      issues.push("state.sessionStartPosition must be null or a coordinate");
    } else {
      if (!isFiniteNumber(coordinate.lat) || coordinate.lat < -90 || coordinate.lat > 90) {
        issues.push("state.sessionStartPosition.lat must be a finite latitude");
      }
      if (!isFiniteNumber(coordinate.lon) || coordinate.lon < -180 || coordinate.lon > 180) {
        issues.push("state.sessionStartPosition.lon must be a finite longitude");
      }
    }
  }
  if (
    value.offRouteState !== null &&
    value.offRouteState !== "on-route" &&
    value.offRouteState !== "uncertain" &&
    value.offRouteState !== "off-route" &&
    value.offRouteState !== "rejoining" &&
    value.offRouteState !== "rerouting"
  ) {
    issues.push("state.offRouteState must be null or a known continuity state");
  }
  const completed = validateStopIds(value.completedStopIds, "state.completedStopIds");
  const remaining = validateStopIds(value.remainingStopIds, "state.remainingStopIds");
  issues.push(...completed, ...remaining);
  if (Array.isArray(value.completedStopIds) && Array.isArray(value.remainingStopIds)) {
    const completedSet = new Set(value.completedStopIds as readonly string[]);
    for (const stopId of value.remainingStopIds as readonly string[]) {
      if (completedSet.has(stopId)) {
        issues.push(`state cannot both complete and await "${stopId}"`);
      }
    }
  }
  if (value.activeInstruction !== null) {
    issues.push(...validateSessionInstruction(value.activeInstruction));
  }
  const acknowledged = value.lastAcknowledgedInstructionId;
  if (acknowledged !== null && !isBrandedId(acknowledged, "instr_")) {
    issues.push("state.lastAcknowledgedInstructionId must be null or an instr_ identifier");
  }
  if (value.recordingId !== null && !isBrandedId(value.recordingId, "rec_")) {
    issues.push("state.recordingId must be null or a rec_ identifier");
  }
  if (value.suggestions !== "on" && value.suggestions !== "off") {
    issues.push("state.suggestions must be on or off");
  }
  if (!isNonNegativeInteger(value.pausedDurationMs)) {
    issues.push("state.pausedDurationMs must be a non-negative integer");
  }
  return issues;
}

/** The stored state is usable: every documented field is well formed. */
export function isRideSessionState(value: unknown): value is RideSessionState {
  try {
    return validateRideSessionState(value).length === 0;
  } catch {
    return false;
  }
}

/** Narrows a stored fix (the navigation derivation only reads live state). */
export function isPositionFix(value: unknown): value is PositionFix {
  return validatePositionFix(value).length === 0;
}

/** Narrows a stored plan value. */
export function isSessionPlan(value: unknown): value is SessionPlan {
  return validateSessionPlan(value).length === 0;
}

/** Narrows a stored route binding. */
export function isSessionRouteBinding(value: unknown): value is SessionRouteBinding {
  return validateSessionRouteBinding(value).length === 0;
}

/** Narrows a stored instruction value. */
export function isSessionInstruction(value: unknown): value is SessionInstruction {
  return validateSessionInstruction(value).length === 0;
}
