/**
 * The ride-sim assertions, written once and used for every track.
 *
 * Each check returns human-readable violations rather than throwing, so a
 * failure names the track, the scenario and the maneuver it is about. The
 * assertions are deliberately strict: they are the product promise, not a
 * description of what the code currently happens to do.
 */

import type { SessionInstructionId } from "@/domain/ride-session/ids";
import type { RouteManeuver } from "@/domain/ride-session/progress";
import type { RideSessionEvent } from "@/domain/ride-session/types";
import type { PlanRequestContext } from "@/application/planner/build-plan-request";
import { buildRerouteRequest, rerouteOfferState } from "@/application/ride-session/reroute";

import type { CapturedCue, ScenarioRun } from "./run-scenario";

type InstructionIssuedEvent = Extract<RideSessionEvent, { readonly type: "instruction.issued" }>;

export const ARRIVAL_MIN_LEAD_METERS = 150;
export const ARRIVAL_MIN_LEAD_SECONDS = 8;
const MAX_SPEECH_STAGES = 3;
const OFF_ROUTE_DEADLINE_MS = 10_000;

function maneuversOf(run: ScenarioRun): readonly RouteManeuver[] {
  return run.resolved.maneuvers ?? [];
}

function issuedEvents(run: ScenarioRun): InstructionIssuedEvent[] {
  return run.events.filter(
    (event): event is InstructionIssuedEvent => event.type === "instruction.issued",
  );
}

function issuedCount(run: ScenarioRun, instructionId: SessionInstructionId): number {
  return issuedEvents(run).filter(
    (event) => event.instruction.instructionId === instructionId,
  ).length;
}

function cuesFor(run: ScenarioRun, instructionId: SessionInstructionId): CapturedCue[] {
  return run.cues.filter((entry) => entry.cue.instructionId === instructionId);
}

function maneuverForCue(
  run: ScenarioRun,
  cue: CapturedCue,
): RouteManeuver | null {
  return (
    maneuversOf(run).find(
      (maneuver) => maneuver.instructionId === cue.cue.instructionId,
    ) ?? null
  );
}

function firstFixAtOrPast(run: ScenarioRun, meters: number): number | null {
  const fix = run.fixes.find((entry) => entry.intendedDistanceMeters >= meters);
  return fix?.atMs ?? null;
}

function msAt(iso: string): number {
  return Date.parse(iso);
}

/**
 * Nothing may be spoken for a maneuver once the rider is past it. The frame at
 * cue time is the engine's own measurement, not a reconstructed distance.
 */
export function cueOrderViolations(run: ScenarioRun): string[] {
  const violations: string[] = [];
  for (const entry of run.cues) {
    const maneuver = maneuverForCue(run, entry);
    if (maneuver === null) {
      violations.push(
        `${run.track.id}: spoke for unknown instruction ${entry.cue.instructionId}`,
      );
      continue;
    }
    if (
      entry.frame !== null &&
      entry.frame.distanceAlongMeters > maneuver.atDistanceMeters + 0.5
    ) {
      violations.push(
        `${run.track.id}: "${entry.cue.instructionId}" was spoken at ${entry.frame.distanceAlongMeters.toFixed(1)} m, ` +
          `${(entry.frame.distanceAlongMeters - maneuver.atDistanceMeters).toFixed(1)} m after the turn at ${maneuver.atDistanceMeters.toFixed(1)} m`,
      );
    }
  }
  return violations;
}

/** No instruction may be issued twice, and none may be invented. */
export function issueIdentityViolations(run: ScenarioRun): string[] {
  const known = new Set(maneuversOf(run).map((maneuver) => maneuver.instructionId));
  const violations: string[] = [];
  const seen = new Map<string, number>();
  for (const event of issuedEvents(run)) {
    const id = event.instruction.instructionId;
    if (!known.has(id)) violations.push(`${run.track.id}: issued unknown instruction ${id}`);
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  for (const [id, count] of seen) {
    if (count !== 1) violations.push(`${run.track.id}: instruction ${id} was issued ${count} times`);
  }
  return violations;
}

/**
 * Every maneuver on the route is issued once and its first spoken cue leaves
 * the rider at least 150 m or 8 s to react. Later band repeats are allowed (the
 * speech coordinator's 2 mi / 0.5 mi / 100 m design), but they must count down.
 */
export function maneuverGuidanceViolations(run: ScenarioRun): string[] {
  const violations: string[] = [];
  for (const maneuver of maneuversOf(run)) {
    const issued = issuedCount(run, maneuver.instructionId);
    if (issued !== 1) {
      violations.push(
        `${run.track.id}: ${maneuver.kind} at ${maneuver.atDistanceMeters.toFixed(0)} m was issued ${issued} times`,
      );
      continue;
    }
    const cues = cuesFor(run, maneuver.instructionId);
    const first = cues[0];
    if (first === undefined) {
      violations.push(
        `${run.track.id}: ${maneuver.kind} at ${maneuver.atDistanceMeters.toFixed(0)} m was never announced`,
      );
      continue;
    }
    const leadSeconds = first.cue.distanceMeters / run.track.speedMps;
    if (
      first.cue.distanceMeters < ARRIVAL_MIN_LEAD_METERS &&
      leadSeconds < ARRIVAL_MIN_LEAD_SECONDS
    ) {
      violations.push(
        `${run.track.id}: ${maneuver.kind} at ${maneuver.atDistanceMeters.toFixed(0)} m was first announced ` +
          `${first.cue.distanceMeters.toFixed(0)} m (${leadSeconds.toFixed(1)} s) before it`,
      );
    }
    if (cues.length > MAX_SPEECH_STAGES) {
      violations.push(
        `${run.track.id}: ${maneuver.kind} at ${maneuver.atDistanceMeters.toFixed(0)} m was announced ${cues.length} times`,
      );
    }
    for (let index = 1; index < cues.length; index += 1) {
      const previous = cues[index - 1];
      const current = cues[index];
      if (previous === undefined || current === undefined) continue;
      if (current.cue.distanceMeters >= previous.cue.distanceMeters) {
        violations.push(
          `${run.track.id}: ${maneuver.kind} at ${maneuver.atDistanceMeters.toFixed(0)} m repeated or grew ` +
            `(${previous.cue.distanceMeters.toFixed(0)} m → ${current.cue.distanceMeters.toFixed(0)} m)`,
        );
      }
    }
  }
  return violations;
}

/** Arrival is the route's final `arrive` maneuver: issued once, spoken once at least once. */
export function arrivalViolations(run: ScenarioRun): string[] {
  const arrivals = maneuversOf(run).filter((maneuver) => maneuver.kind === "arrive");
  if (arrivals.length !== 1) {
    return [`${run.track.id}: route has ${arrivals.length} arrival maneuvers, expected 1`];
  }
  const arrival = arrivals[0];
  if (arrival === undefined) return [`${run.track.id}: arrival maneuver is missing`];
  const violations: string[] = [];
  const issued = issuedCount(run, arrival.instructionId);
  if (issued !== 1) {
    violations.push(`${run.track.id}: arrival was issued ${issued} times`);
  }
  if (cuesFor(run, arrival.instructionId).length === 0) {
    violations.push(`${run.track.id}: arrival was never announced`);
  }
  return violations;
}

/** Progress is the matched along-route distance; it may hold but never go back. */
export function progressViolations(run: ScenarioRun): string[] {
  const violations: string[] = [];
  let previous: number | null = null;
  run.frames.forEach((frame, index) => {
    if (frame === null) return;
    if (previous !== null && frame.distanceAlongMeters < previous) {
      violations.push(
        `${run.track.id}: progress went backwards at fix ${index}: ${previous.toFixed(2)} m → ${frame.distanceAlongMeters.toFixed(2)} m`,
      );
    }
    previous = frame.distanceAlongMeters;
  });
  return violations;
}

export function offRouteStates(run: ScenarioRun): readonly string[] {
  return run.events
    .filter((event) => event.type === "off-route.changed")
    .map((event) => (event.type === "off-route.changed" ? event.state : ""));
}

export function offRouteAlertViolations(run: ScenarioRun): string[] {
  return offRouteStates(run)
    .filter((state) => state === "off-route" || state === "rerouting")
    .map((state) => `${run.track.id}: raised ${state}`);
}

/** The ride actually finished, not merely stopped emitting fixes. */
export function completionViolations(run: ScenarioRun): string[] {
  const frame = run.finalFrame;
  if (frame === null) return [`${run.track.id}: no progress frame was ever produced`];
  if (frame.distanceRemainingMeters > 30) {
    return [
      `${run.track.id}: the replay ended ${frame.distanceRemainingMeters.toFixed(0)} m from the route end`,
    ];
  }
  return [];
}

function missedTurnManeuver(run: ScenarioRun): RouteManeuver | null {
  const at = run.timeline.missedTurnAtMeters;
  if (at === null) return null;
  return (
    maneuversOf(run).reduce<RouteManeuver | null>((closest, maneuver) => {
      if (maneuver.kind === "arrive" || maneuver.kind === "continue") return closest;
      if (closest === null) return maneuver;
      return Math.abs(maneuver.atDistanceMeters - at) <
        Math.abs(closest.atDistanceMeters - at)
        ? maneuver
        : closest;
    }, null)
  );
}

/**
 * The missed-turn promise: the ignored turn was announced once, the rider was
 * told off-route within 10 s, and the reroute seam then offers and builds a
 * request from the live position.
 */
export async function missedTurnViolations(run: ScenarioRun): Promise<string[]> {
  const violations: string[] = [];
  const missed = missedTurnManeuver(run);
  const missedAt = run.timeline.missedTurnAtMeters;
  if (missed === null || missedAt === null) {
    return [`${run.track.id}: the missed-turn scenario has no turn to miss`];
  }
  const issued = issuedCount(run, missed.instructionId);
  if (issued !== 1) {
    violations.push(
      `${run.track.id}: the missed turn at ${missedAt.toFixed(0)} m was issued ${issued} times`,
    );
  }
  const firstCue = cuesFor(run, missed.instructionId)[0];
  if (firstCue === undefined) {
    violations.push(`${run.track.id}: the missed turn was never announced`);
  } else {
    const leadSeconds = firstCue.cue.distanceMeters / run.track.speedMps;
    if (
      firstCue.cue.distanceMeters < ARRIVAL_MIN_LEAD_METERS &&
      leadSeconds < ARRIVAL_MIN_LEAD_SECONDS
    ) {
      violations.push(
        `${run.track.id}: the missed turn was first announced ${firstCue.cue.distanceMeters.toFixed(0)} m before it`,
      );
    }
  }

  if (run.firstOffRoute === null) {
    violations.push(`${run.track.id}: ignoring the turn never raised off-route`);
    return violations;
  }
  const reached = firstFixAtOrPast(run, missedAt);
  if (reached === null) {
    violations.push(`${run.track.id}: the replay never reached the missed turn`);
    return violations;
  }
  const delay = msAt(run.firstOffRoute.at) - reached;
  if (delay > OFF_ROUTE_DEADLINE_MS) {
    violations.push(
      `${run.track.id}: off-route took ${(delay / 1_000).toFixed(1)} s (deadline 10 s)`,
    );
  }

  // The rider ignored a turn on the route: no later maneuver may be announced.
  for (const maneuver of maneuversOf(run)) {
    if (maneuver.atDistanceMeters <= missedAt + 1) continue;
    if (issuedCount(run, maneuver.instructionId) > 0) {
      violations.push(
        `${run.track.id}: announced the later ${maneuver.kind} at ${maneuver.atDistanceMeters.toFixed(0)} m after leaving the route`,
      );
    }
  }

  const state = run.firstOffRoute.state;
  const offer = rerouteOfferState(state, run.firstOffRoute.at);
  if (!offer.canOffer) {
    violations.push(`${run.track.id}: off-route did not offer a reroute (${offer.reason})`);
    return violations;
  }
  const coordinate = state.position?.coordinate;
  if (coordinate === undefined || coordinate === null) {
    violations.push(`${run.track.id}: off-route state has no reliable position for a reroute`);
    return violations;
  }
  const context: PlanRequestContext = {
    requestId: `ride-sim-${run.track.id}`,
    includeAlternatives: false,
    resolveGeometry: () => null,
  };
  const built = await buildRerouteRequest(
    {
      currentPosition: coordinate,
      authoredIntent: run.authoredIntent,
      remainingStopIds: [],
      completedStopIds: [],
    },
    context,
  );
  if (!built.ok) {
    violations.push(
      `${run.track.id}: the reroute request could not be built (${built.failure.code})`,
    );
    return violations;
  }
  if (
    Math.abs(built.request.origin.lat - coordinate.lat) > 1e-9 ||
    Math.abs(built.request.origin.lon - coordinate.lon) > 1e-9
  ) {
    violations.push(`${run.track.id}: the reroute request did not start at the live position`);
  }
  return violations;
}
