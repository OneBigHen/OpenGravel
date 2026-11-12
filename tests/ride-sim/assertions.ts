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
import type { RideSessionEvent, RideSessionState } from "@/domain/ride-session/types";
import type { PlanRequestContext } from "@/application/planner/build-plan-request";
import { buildRerouteRequest, rerouteOfferState } from "@/application/ride-session/reroute";
import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import { createGuidedReroutePlanner } from "@/application/ride-session/guided-reroute";
import {
  REJOIN_OFFSETS_METERS,
  bearingOf,
  chainage,
  nearestAlong,
  pointAlong,
  ringSpanAlong,
} from "@/application/ride-session/rejoin-splice";
import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import { modeChangedEvent } from "@/domain/ride-session/create";
import { deriveSessionNavigation } from "@/domain/ride-session/navigation";
import { createRideSessionController, type RideSessionController } from "@/application/ride-session/ride-session-controller";

import { createFakeConnectorProvider } from "./fake-connector-provider";

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

// ---------------------------------------------------------------------------
// RM-6: a missed turn puts the rider back on the planned ride

/** The new route must be bound this soon after off-route. */
export const REJOIN_BIND_DEADLINE_MS = 5_000;
/** Share of the planned ride still ahead that the reroute must keep. */
export const REJOIN_MIN_KEPT_SHARE = 0.9;

export interface RejoinMeasure {
  /** Every problem found, in the three checks' order. */
  readonly violations: string[];
  /** Check 1: a new route is bound within 5 s of off-route. */
  readonly bindViolations: string[];
  /** Check 2: the bound route's tail is the planned line from the rejoin point. */
  readonly tailViolations: string[];
  /** Check 3: at least 90% of the planned ride still rejoinable is kept. */
  readonly keptViolations: string[];
  readonly bindMs: number | null;
  readonly routerCalls: number;
  /** Planned metres kept after the rejoin point. */
  readonly keptMeters: number;
  /** Planned metres ahead of the earliest place the rider could rejoin without a U-turn. */
  readonly rejoinableMeters: number;
  /** Planned metres ahead of the rider's nearest point on the line when off-route was raised. */
  readonly aheadMeters: number;
}

function memoryGeometry() {
  return createMemoryGeometryStore();
}

/**
 * The run's session as it stood at the first off-route instant: a fresh
 * controller started like the run's and fed the same events up to that one.
 * (The run's own session has ridden on past it, so it would reject a binding
 * stamped at the off-route instant as a timestamp regression.)
 */
async function sessionAtOffRoute(run: ScenarioRun, state: RideSessionState, atMs: number): Promise<RideSessionController> {
  let clockMs = atMs;
  const controller = createRideSessionController({ now: () => new Date(clockMs).toISOString() });
  const started = await controller.start({
    activity: "guided",
    rideId: state.plan.rideId,
    rideRevision: state.plan.rideRevision,
    route: state.plan.route!,
    at: new Date(run.startMs - 1_000).toISOString(),
  });
  if (started.outcome !== "applied") throw new Error(`${run.track.id}: the replayed session did not start`);
  for (const event of run.events) {
    if (msAt(event.at) > atMs) break;
    clockMs = msAt(event.at);
    await controller.dispatch(event);
  }
  clockMs = atMs;
  return controller;
}

/** Index in `spliced` from which it is the planned line exactly, or null. */
export function plannedTailStart(
  spliced: readonly Coordinate[],
  planned: readonly Coordinate[],
): { readonly joinIndex: number; readonly plannedFrom: number } | null {
  for (let from = 1; from < planned.length; from += 1) {
    const length = planned.length - from;
    const joinIndex = spliced.length - length - 1;
    if (joinIndex < 0) continue;
    const tail = spliced.slice(joinIndex + 1);
    if (!tail.every((point, index) => point.lon === planned[from + index]!.lon && point.lat === planned[from + index]!.lat)) continue;
    // The join point itself lies on the planned segment just before.
    const join = spliced[joinIndex]!;
    const a = planned[from - 1]!;
    const b = planned[from]!;
    if (Math.abs(haversine(a, join) + haversine(join, b) - haversine(a, b)) < 0.5) return { joinIndex, plannedFrom: from };
  }
  return null;
}

/**
 * At the first off-route instant, run the real guided reroute planner against
 * a fake router and bind its answer on the live session: bound in time, the
 * tail is the planned line exactly, and the ride still ahead is kept.
 */
export async function rejoinMeasure(run: ScenarioRun): Promise<RejoinMeasure> {
  const bindViolations: string[] = [];
  const tailViolations: string[] = [];
  const keptViolations: string[] = [];
  const failed = (reason: string): RejoinMeasure => ({
    violations: [reason], bindViolations: [reason], tailViolations: [reason], keptViolations: [reason],
    bindMs: null, routerCalls: 0, keptMeters: 0, rejoinableMeters: 0, aheadMeters: 0,
  });
  if (run.firstOffRoute === null) return failed(`${run.track.id}: no off-route to reroute from`);
  const at = run.firstOffRoute.at;
  const atMs = msAt(at);
  // The last place the engine matched the rider, as the ride screen reads it.
  let along = 0;
  run.fixes.forEach((fix, index) => {
    const frame = run.frames[index];
    if (fix.atMs <= atMs && frame !== null && frame !== undefined) along = Math.max(along, frame.distanceAlongMeters);
  });
  const line = run.route.geometry;
  const provider = createFakeConnectorProvider({ line, instructions: run.route.instructions });
  const geometry = memoryGeometry();
  const state = run.firstOffRoute.state;
  const planner = createGuidedReroutePlanner({
    rides: {
      loadRide: async () => ({ ok: true as const, document: { rideId: state.plan.rideId, revision: state.plan.rideRevision, intent: run.authoredIntent } }),
    } as never,
    geometry,
    provider,
    now: () => at,
  });
  const navigation = deriveSessionNavigation(state, { now: at });
  const started = performance.now();
  const plan = await planner.plan({
    navigation,
    route: { line, alongMeters: along, instructions: run.route.instructions, durationSeconds: run.route.durationSeconds },
    signal: new AbortController().signal,
  });
  if (plan.status !== "planned") return failed(`${run.track.id}: the reroute found no route (${plan.reason})`);
  const planMs = performance.now() - started;
  // Bound on the session as it was when off-route was raised, stamped the
  // planning time later: the binding a rider sees.
  const session = await sessionAtOffRoute(run, state, atMs);
  if (session.snapshot()?.offRouteState !== "off-route") bindViolations.push(`${run.track.id}: the replayed session was not off-route at the reroute`);
  const boundAt = new Date(atMs + Math.ceil(planMs)).toISOString();
  const bound = await session.dispatch(modeChangedEvent("guided", boundAt, plan.route));
  const bindMs = msAt(boundAt) - atMs;
  if (bound.outcome !== "applied" || bound.state?.plan.route?.planningGeneration !== plan.route.planningGeneration) {
    bindViolations.push(`${run.track.id}: the new route was not bound (${bound.code ?? bound.outcome})`);
  }
  if (bindMs > REJOIN_BIND_DEADLINE_MS) bindViolations.push(`${run.track.id}: the new route took ${(bindMs / 1000).toFixed(1)} s to bind (deadline 5 s)`);
  if (plan.rejoin === undefined) tailViolations.push(`${run.track.id}: the reroute replanned the whole ride instead of rejoining it`);

  const stored = await geometry.get(plan.routeGeometryRef);
  const spliced = stored?.payload.kind === "line" ? stored.payload.coordinates : [];
  const tail = plannedTailStart(spliced, line);
  const chain = chainage(line);
  const total = chain.at(-1) as number;
  const position = navigation.position.coordinate!;
  const fromAlong = nearestAlong(line, chain, position, along, along + 2_000);
  const aheadMeters = total - fromAlong;
  const rejoinableMeters = Math.max(0, total - (fromAlong + (REJOIN_OFFSETS_METERS[0] as number)));
  let keptMeters = 0;
  if (tail === null) {
    tailViolations.push(`${run.track.id}: the bound route's tail is not the planned line`);
    keptViolations.push(`${run.track.id}: nothing of the planned ride is kept exactly`);
  } else {
    keptMeters = total - nearestAlong(line, chain, spliced[tail.joinIndex]!, chain[tail.plannedFrom - 1] as number, chain[tail.plannedFrom] as number);
    if (rejoinableMeters > 0 && keptMeters < REJOIN_MIN_KEPT_SHARE * rejoinableMeters - 1) {
      keptViolations.push(`${run.track.id}: kept ${keptMeters.toFixed(0)} m of the ${rejoinableMeters.toFixed(0)} m of planned ride still rejoinable (< 90%)`);
    }
  }
  return {
    violations: [...bindViolations, ...tailViolations, ...keptViolations],
    bindViolations, tailViolations, keptViolations,
    bindMs, routerCalls: provider.requests.length, keptMeters, rejoinableMeters, aheadMeters };
}

/**
 * A spot reported on the line 2 km ahead of a rider who is on the route: the
 * reroute must not enter it and must rejoin the planned line beyond it.
 */
export async function reportRerouteViolations(
  run: ScenarioRun,
  ring: readonly Coordinate[],
  riderAlong: number,
): Promise<{ violations: string[]; joinAlong: number | null; ringLast: number | null }> {
  const violations: string[] = [];
  const line = run.route.geometry;
  const chain = chainage(line);
  const at = new Date(run.startMs).toISOString();
  const provider = createFakeConnectorProvider({ line, instructions: run.route.instructions });
  const geometry = memoryGeometry();
  const state = run.finalState!;
  const planner = createGuidedReroutePlanner({
    rides: {
      loadRide: async () => ({ ok: true as const, document: { rideId: state.plan.rideId, revision: state.plan.rideRevision, intent: run.authoredIntent } }),
    } as never,
    geometry,
    provider,
    now: () => at,
  });
  const here = pointAlong(line, chain, riderAlong);
  const next = line[here.segmentIndex + 1]!;
  const navigation = {
    ...deriveSessionNavigation(state, { now: at }),
    activity: "guided" as const,
    position: {
      coordinate: here.coordinate, observedAt: at, ageMs: 0, accuracyMeters: 5,
      headingDegrees: bearingOf(here.coordinate, next), speedMps: 1, quality: "fresh-good" as const,
    },
  };
  const plan = await planner.plan({
    navigation,
    route: { line, alongMeters: riderAlong, instructions: run.route.instructions, durationSeconds: run.route.durationSeconds },
    reason: "report",
    signal: new AbortController().signal,
  });
  const ringSpan = ringSpanAlong(line, chain, ring, riderAlong);
  if (plan.status !== "planned") return { violations: [`${run.track.id}: no route around the reported spot (${plan.reason})`], joinAlong: null, ringLast: ringSpan?.lastMeters ?? null };
  if (provider.requests.some((request) => !request.avoidPolygons.some((polygon) => polygon.length === ring.length && polygon.every((point, index) => point.lon === ring[index]!.lon && point.lat === ring[index]!.lat)))) {
    violations.push(`${run.track.id}: a reroute request did not carry the reported spot`);
  }
  if (plan.rejoin === undefined) violations.push(`${run.track.id}: the report replanned the whole ride instead of rejoining it`);
  const stored = await geometry.get(plan.routeGeometryRef);
  const spliced = stored?.payload.kind === "line" ? stored.payload.coordinates : [];
  if (ringSpanAlong(spliced, chainage(spliced), ring, 0) !== null) violations.push(`${run.track.id}: the new route enters the reported spot`);
  const tail = plannedTailStart(spliced, line);
  let joinAlong: number | null = null;
  if (tail === null) {
    violations.push(`${run.track.id}: the new route does not rejoin the planned line`);
  } else {
    joinAlong = nearestAlong(line, chain, spliced[tail.joinIndex]!, chain[tail.plannedFrom - 1] as number, chain[tail.plannedFrom] as number);
    if (ringSpan === null || joinAlong <= ringSpan.lastMeters) violations.push(`${run.track.id}: the new route rejoins before the reported spot`);
  }
  return { violations, joinAlong, ringLast: ringSpan?.lastMeters ?? null };
}
