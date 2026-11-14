/**
 * Mid-ride replanning for a guided ride (UX rework phase 9; SwitchBack parity
 * for off-route recovery and "detour to fuel").
 *
 * The same shape as Free Ride's return planner: project the live session onto
 * a planning-only intent (`buildRerouteRequest`: the rider's position as the
 * start, only the stops still ahead, every authored constraint kept), ask the
 * canonical provider, persist the chosen line and hand back a binding. The
 * caller binds it with one `mode.changed` event; nothing here touches session
 * or document state, so a failed plan leaves the current route in charge.
 */

import type { GeometryStore } from "@/application/geometry/geometry-store";
import { currentRiderReportRings } from "@/application/persistence/rider-report-repository";
import type { RideRepositoryPort } from "@/application/persistence/ride-repository";
import type { ProviderCandidate, ProviderRouteRequest } from "@/application/planner/route-provider";
import { isUsableEvidence } from "@/domain/evidence/types";
import { haversine } from "@/domain/geometry/analysis";
import type { GeometryRef } from "@/domain/ride/ids";
import type { Coordinate, RideIntent } from "@/domain/ride/types";
import type { SessionNavigationState } from "@/domain/ride-session/navigation";
import type { SessionRouteBinding } from "@/domain/ride-session/types";
import { asRouteCandidateId, newRouteCandidateId } from "@/domain/route/ids";
import type { RouteInstruction, SpeedLimitSpan } from "@/domain/route/types";
import { deepFreeze } from "@/domain/util/freeze";
import { profileFor as graphHopperProfileFor } from "@/infrastructure/routing/graphhopper/profiles";

import {
  bendMetersBetween,
  chainage,
  chooseRejoin,
  connectorProblem,
  dirtMetersBetween,
  nearestAlong,
  plannedSecondsBetween,
  rejoinTargets,
  splice,
  type ConnectorRoute,
  type PlannedRoute,
  type RejoinOption,
  type SplicedRoute,
} from "./rejoin-splice";
import { buildRerouteRequest } from "./reroute";
import type { SurfaceRunSpan } from "./surface-ahead";

export interface RerouteDetour {
  readonly coordinate: Coordinate;
  /** What the rider chose, e.g. "Sunoco": carried into the stop's label. */
  readonly label: string;
}

export type GuidedRerouteResult =
  | {
      readonly status: "planned";
      readonly route: SessionRouteBinding;
      readonly routeGeometryRef: GeometryRef;
      readonly durationSeconds: number;
      readonly distanceMeters: number;
      readonly instructions?: readonly RouteInstruction[];
      /** Carried over from the planned line when the reroute rejoined it (RM-6). */
      readonly speedLimits?: readonly SpeedLimitSpan[];
      readonly surfaceRuns?: readonly SurfaceRunSpan[];
      /**
       * Present when only the way back is new: the rest of the ride is the
       * planned line, unchanged. Absent after a full replan.
       */
      readonly rejoin?: {
        /** Metres of new road before the rider is back on the planned line. */
        readonly connectorMeters: number;
        /** Router calls this reroute made. */
        readonly routerCalls: number;
        /** False when the closure check did not answer for the way back: never shown as clear. */
        readonly closureChecked: boolean;
      };
    }
  | {
      readonly status: "unavailable";
      readonly reason: "not-guided" | "gps" | "ride-missing" | "stale-ride" | "constraints-unresolved" | "no-route";
    };

export interface GuidedReroutePlanner {
  plan(input: {
    readonly navigation: SessionNavigationState;
    readonly detour?: RerouteDetour;
    /** The bound route ahead of the rider; a loop rides back onto it. */
    readonly aheadLine?: readonly Coordinate[];
    /** Ride all of `aheadLine` from its start (DV-07, "Head to the start"). */
    readonly followLine?: boolean;
    /**
     * The bound route and where the rider last matched it (RM-6). With it, a
     * missed turn routes only the way back onto this line and keeps the rest.
     */
    readonly route?: RerouteBoundRoute;
    /** Why this reroute was asked for; a report reroutes around the reported spot. */
    readonly reason?: "off-route" | "report";
    readonly signal: AbortSignal;
  }): Promise<GuidedRerouteResult>;
}

export interface RerouteBoundRoute {
  readonly line: readonly Coordinate[];
  /** The rider's last matched distance along `line`. */
  readonly alongMeters: number;
  readonly instructions?: readonly RouteInstruction[];
  readonly durationSeconds?: number;
  readonly speedLimits?: readonly SpeedLimitSpan[];
  readonly surfaceRuns?: readonly SurfaceRunSpan[];
}

/** How far ahead of the last match the rider's nearest point on the line is looked for. */
const NEAREST_AHEAD_WINDOW_METERS = 2_000;
/** A way back that adds more than this share of the time left is not worth it: replan instead. */
const MAX_CONNECTOR_SHARE_OF_TIME_LEFT = 0.25;
/** Off route again this close to the last way back's start: the rider rode away from it. */
const IGNORED_REROUTE_METERS = 1_000;
/** Ignored reroutes in a row before the targets start further on. */
const IGNORED_BEFORE_FAR = 2;

function candidateId(candidate: ProviderCandidate): string | null {
  const id = candidate.providerMetadata?.["candidateId"];
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Below this speed a GPS heading is noise, so the route may leave any way. */
const HEADING_MIN_SPEED_MPS = 2;

/**
 * A moving rider's heading on the request's origin: the new route carries on
 * the way they are riding (a sat-nav reroute) instead of "turn around" back to
 * the line they left.
 */
function withRiderHeading(request: ProviderRouteRequest, navigation: SessionNavigationState): ProviderRouteRequest {
  const { headingDegrees, speedMps } = navigation.position;
  if (headingDegrees === null || !Number.isFinite(headingDegrees)) return request;
  if (speedMps !== null && speedMps < HEADING_MIN_SPEED_MPS) return request;
  return { ...request, originHeadingDegrees: ((headingDegrees % 360) + 360) % 360 };
}

export function createGuidedReroutePlanner(deps: {
  readonly rides: RideRepositoryPort;
  readonly geometry: GeometryStore;
  readonly provider: {
    beginAttempt(identity: { readonly rideId: string; readonly rideRevision: number; readonly planningGeneration: number }): void;
    candidates(request: ProviderRouteRequest, signal: AbortSignal): Promise<{ readonly candidates: readonly ProviderCandidate[] }>;
  };
  readonly now?: () => string;
  /**
   * The ride's routing profile, as the planner picked it (curvy → twisty, dirt
   * → adventure). Without it a reroute asked for a placeholder profile the
   * router does not serve, so the way back never kept the ride's character.
   */
  readonly profileFor?: (intent: RideIntent) => string;
}): GuidedReroutePlanner {
  const now = deps.now ?? (() => new Date().toISOString());
  const profileFor = deps.profileFor ?? graphHopperProfileFor;
  let generation = 0;
  let ignoredInARow = 0;
  let lastRejoin: { readonly planningGeneration: number; readonly connectorStart: Coordinate } | null = null;

  /**
   * The way to the start of the planned line, then the line exactly (QA-18).
   * Null means "do the full replan instead": no line facts, no usable way.
   */
  async function planToStart(args: {
    readonly navigation: SessionNavigationState;
    readonly intent: RideIntent;
    readonly route: RerouteBoundRoute;
    readonly planningGeneration: number;
    readonly signal: AbortSignal;
  }): Promise<GuidedRerouteResult | null> {
    const { navigation, route, planningGeneration, signal } = args;
    const position = navigation.position.coordinate;
    const line = route.line;
    const instructions = route.instructions;
    const start = line[0];
    if (position === null || start === undefined || line.length < 2 || instructions === undefined || instructions.length === 0) return null;
    if (instructions.some((instruction) => instruction.geometryIndex === undefined || instruction.geometryIndex >= line.length)) return null;
    const base = await buildRerouteRequest(
      {
        currentPosition: position,
        authoredIntent: args.intent,
        remainingStopIds: navigation.remainingStopIds,
        completedStopIds: navigation.completedStopIds,
      },
      {
        requestId: `reroute-${planningGeneration}`,
        includeAlternatives: false,
        profileFor,
        extraAvoidRings: currentRiderReportRings(),
        resolveGeometry: async (ref) => (await deps.geometry.get(ref))?.payload ?? null,
      },
    );
    if (!base.ok) return null;
    deps.provider.beginAttempt({
      rideId: navigation.plan.rideId,
      rideRevision: navigation.plan.rideRevision,
      planningGeneration,
    });
    const connectorRequest: ProviderRouteRequest = {
      requestId: `${base.request.requestId}-start`,
      origin: base.request.origin,
      destination: start,
      stops: [],
      shaping: [],
      profile: base.request.profile,
      avoidPolygons: base.request.avoidPolygons,
      roadSpans: [],
      options: { ...base.request.options, includeAlternatives: false },
    };
    let answer: Awaited<ReturnType<typeof deps.provider.candidates>>;
    try {
      answer = await deps.provider.candidates(withRiderHeading(connectorRequest, navigation), signal);
    } catch (caught) {
      if (signal.aborted) throw caught;
      return null;
    }
    if (signal.aborted) throw signal.reason;
    const connector = answer.candidates.find((entry) => entry.providerMetadata?.["bestRide"] === true) ?? answer.candidates[0];
    if (connector === undefined || connector.geometry.length < 2) return null;
    // The way must really end at the line's start, or the join would jump.
    if (haversine(connector.geometry[connector.geometry.length - 1] as Coordinate, start) > 30) return null;
    const head = connector.geometry.slice(0, -1);
    const offset = head.length;
    const geometry = [...head, ...line];
    const connectorInstructions = (connector.instructions ?? [])
      .filter((instruction) => instruction.type !== "finish" && instruction.type !== "arrive");
    const plannedInstructions = instructions.map((instruction) => ({
      ...instruction,
      geometryIndex: (instruction.geometryIndex as number) + offset,
    }));
    const joined: RouteInstruction[] = [...connectorInstructions, ...plannedInstructions];
    const connectorMeters = chainage(connector.geometry).at(-1) ?? connector.distanceMeters;
    const lineMeters = chainage(line).at(-1) ?? 0;
    const lineSeconds = route.durationSeconds ?? instructions.reduce((sum, instruction) => sum + instruction.durationSeconds, 0);
    const stored = await deps.geometry.put(
      { kind: "line", coordinates: geometry },
      { kind: "route", now: now() },
    );
    return deepFreeze({
      status: "planned" as const,
      route: { planningGeneration, routeId: newRouteCandidateId() },
      routeGeometryRef: stored.geometryRef,
      durationSeconds: connector.durationSeconds + lineSeconds,
      distanceMeters: connectorMeters + lineMeters,
      instructions: joined,
      ...(route.speedLimits === undefined ? {} : {
        speedLimits: route.speedLimits.map((span) => ({ ...span, fromIndex: span.fromIndex + offset, toIndex: span.toIndex + offset })),
      }),
      ...(route.surfaceRuns === undefined ? {} : {
        surfaceRuns: route.surfaceRuns.map((run) => ({ ...run, from: run.from + connectorMeters, to: run.to + connectorMeters })),
      }),
    });
  }

  /**
   * Route only the way back onto the planned line and keep the rest exactly
   * (RM-6). Null means "do today's full replan instead": no usable target, no
   * connector passed, the best one costs too much, or the splice is not exact.
   */
  async function planRejoin(args: {
    readonly navigation: SessionNavigationState;
    readonly intent: RideIntent;
    readonly route: RerouteBoundRoute;
    readonly planningGeneration: number;
    readonly far: boolean;
    readonly signal: AbortSignal;
  }): Promise<GuidedRerouteResult | null> {
    const { navigation, route, planningGeneration, signal } = args;
    const position = navigation.position.coordinate;
    const instructions = route.instructions;
    if (position === null || route.line.length < 2 || instructions === undefined || instructions.length === 0) return null;
    if (instructions.some((instruction) => instruction.geometryIndex === undefined || instruction.geometryIndex >= route.line.length)) return null;
    const chain = chainage(route.line);
    const total = chain.at(-1) ?? 0;
    const lineMeters = instructions.reduce((sum, instruction) => sum + instruction.distanceMeters, 0);
    const planned: PlannedRoute = {
      geometry: route.line,
      instructions,
      distanceMeters: lineMeters,
      durationSeconds: route.durationSeconds ?? instructions.reduce((sum, instruction) => sum + instruction.durationSeconds, 0),
      ...(route.speedLimits === undefined ? {} : { speedLimits: route.speedLimits }),
      ...(route.surfaceRuns === undefined ? {} : { surfaceRuns: route.surfaceRuns }),
    };

    // The ride's own request (profile, options, bike limits, avoid areas and
    // the rider's reported spots); only its endpoints change per connector.
    const base = await buildRerouteRequest(
      {
        currentPosition: position,
        authoredIntent: args.intent,
        remainingStopIds: navigation.remainingStopIds,
        completedStopIds: navigation.completedStopIds,
      },
      {
        requestId: `reroute-${planningGeneration}`,
        includeAlternatives: false,
        profileFor,
        extraAvoidRings: currentRiderReportRings(),
        resolveGeometry: async (ref) => (await deps.geometry.get(ref))?.payload ?? null,
      },
    );
    if (!base.ok) return null;
    const request = base.request;

    const matched = Math.min(total, Math.max(0, route.alongMeters));
    const fromAlong = nearestAlong(route.line, chain, position, matched, matched + NEAREST_AHEAD_WINDOW_METERS);
    const nextStop = request.stops[0];
    const nextStopAlong = nextStop === undefined ? null : nearestAlong(route.line, chain, nextStop, fromAlong);
    const targets = rejoinTargets(route.line, {
      fromAlongMeters: fromAlong,
      nextStopAlongMeters: nextStopAlong,
      blockedRings: request.avoidPolygons,
      turnAlongMeters: instructions
        .filter((instruction) => instruction.type !== "depart" && instruction.type !== "finish")
        .map((instruction) => chain[instruction.geometryIndex as number] as number),
      far: args.far,
    });
    if (targets.length === 0) return null;

    deps.provider.beginAttempt({
      rideId: navigation.plan.rideId,
      rideRevision: navigation.plan.rideRevision,
      planningGeneration,
    });
    const answers = await Promise.allSettled(
      targets.map((target, index) => {
        // The ride's profile, options (bike limits included) and avoided spots;
        // no sketch, discovery, stops or road spans: the planned line already
        // rides the chosen roads, and the way back needs none of them.
        const connectorRequest: ProviderRouteRequest = {
          requestId: `${request.requestId}-rejoin-${index}`,
          origin: request.origin,
          destination: target.coordinate,
          stops: [],
          shaping: [],
          profile: request.profile,
          avoidPolygons: request.avoidPolygons,
          roadSpans: [],
          options: { ...request.options, includeAlternatives: false },
        };
        return deps.provider.candidates(withRiderHeading(connectorRequest, navigation), signal);
      }),
    );
    if (signal.aborted) throw signal.reason;

    const options: { option: RejoinOption; spliced: SplicedRoute; candidate: ProviderCandidate }[] = [];
    answers.forEach((answer, index) => {
      const target = targets[index];
      if (answer.status !== "fulfilled" || target === undefined) return;
      const candidate =
        answer.value.candidates.find((entry) => entry.providerMetadata?.["bestRide"] === true) ?? answer.value.candidates[0];
      if (candidate === undefined) return;
      const connector: ConnectorRoute = {
        geometry: candidate.geometry,
        distanceMeters: candidate.distanceMeters,
        durationSeconds: candidate.durationSeconds,
        ...(candidate.instructions === undefined ? {} : { instructions: candidate.instructions }),
        ...(candidate.speedLimits === undefined ? {} : { speedLimits: candidate.speedLimits }),
      };
      if (connectorProblem(connector, route.line, target) !== null) return;
      const spliced = splice(connector, planned, target);
      // Stop rule: a join that cannot be spliced exactly is not used at all.
      if (spliced === null) return;
      options.push({ option: { target, connector }, spliced, candidate });
    });
    const plannedSeconds = plannedSecondsBetween(planned);
    const dirtRide = request.options.surfacePreference === "dirt-preferred" && route.surfaceRuns !== undefined;
    const chosen = chooseRejoin(options.map((entry) => entry.option), route.line, {
      plannedSeconds,
      goodMeters: dirtRide ? dirtMetersBetween(route.surfaceRuns ?? []) : bendMetersBetween(planned),
    });
    const picked = chosen === null ? undefined : options.find((entry) => entry.option === chosen);
    if (picked === undefined) return null;
    // What the way back costs is the time it adds: the planned line from the
    // rider's nearest point to the rejoin would have taken some of it anyway.
    const timeLeft = plannedSeconds(fromAlong, total);
    const addedSeconds = picked.option.connector.durationSeconds - plannedSeconds(fromAlong, picked.option.target.alongMeters);
    if (addedSeconds > timeLeft * MAX_CONNECTOR_SHARE_OF_TIME_LEFT) return null;

    const stored = await deps.geometry.put(
      { kind: "line", coordinates: picked.spliced.geometry },
      { kind: "route", now: now() },
    );
    const closures = picked.candidate.assessment?.evidence["closures"];
    // Unknown is never shown as clear: no usable closure evidence → "not checked".
    const closureChecked = closures !== undefined && isUsableEvidence(closures);
    return deepFreeze({
      status: "planned" as const,
      route: { planningGeneration, routeId: newRouteCandidateId() },
      routeGeometryRef: stored.geometryRef,
      durationSeconds: picked.spliced.durationSeconds,
      distanceMeters: picked.spliced.distanceMeters,
      instructions: picked.spliced.instructions,
      ...(picked.spliced.speedLimits === undefined ? {} : { speedLimits: picked.spliced.speedLimits }),
      ...(picked.spliced.surfaceRuns === undefined ? {} : { surfaceRuns: picked.spliced.surfaceRuns }),
      rejoin: { connectorMeters: picked.spliced.connectorMeters, routerCalls: targets.length, closureChecked },
    });
  }

  return {
    async plan(input) {
      const { navigation } = input;
      const activity = navigation.activity === "paused" ? navigation.resumeActivity : navigation.activity;
      if (activity !== "guided" || navigation.plan.route === null) return { status: "unavailable", reason: "not-guided" };
      if (navigation.position.quality !== "fresh-good" || navigation.position.coordinate === null) {
        return { status: "unavailable", reason: "gps" };
      }
      if (input.signal.aborted) throw input.signal.reason;
      const loaded = await deps.rides.loadRide(navigation.plan.rideId);
      if (loaded === null || !loaded.ok) return { status: "unavailable", reason: "ride-missing" };
      if (loaded.document.revision !== navigation.plan.rideRevision) return { status: "unavailable", reason: "stale-ride" };
      // Each answer must outrank the binding it replaces, including one a
      // Free Ride return planner minted from the clock.
      generation = Math.max(generation + 1, navigation.plan.route.planningGeneration + 1);
      const planningGeneration = generation;

      // RM-6: two reroutes in a row that the rider rode away from → rejoin further on.
      const position = navigation.position.coordinate;
      ignoredInARow =
        lastRejoin !== null &&
        navigation.plan.route.planningGeneration === lastRejoin.planningGeneration &&
        haversine(position, lastRejoin.connectorStart) <= IGNORED_REROUTE_METERS
          ? ignoredInARow + 1
          : 0;
      lastRejoin = null;

      if (
        input.route !== undefined &&
        input.detour === undefined &&
        input.followLine !== true &&
        loaded.document.intent.sketch === null
      ) {
        const rejoined = await planRejoin({
          navigation,
          intent: loaded.document.intent,
          route: input.route,
          planningGeneration,
          far: ignoredInARow >= IGNORED_BEFORE_FAR,
          signal: input.signal,
        });
        if (rejoined !== null) {
          lastRejoin = { planningGeneration, connectorStart: position };
          return rejoined;
        }
      }

      // "Head to the start": route only the way to the line's start, then ride
      // the planned line itself. A fresh route shaped through points on the
      // line is free to take other roads between them, so a rider on the
      // planned line could be called off the route (QA-18).
      if (input.followLine === true && input.route !== undefined && input.detour === undefined) {
        const toStart = await planToStart({ navigation, intent: loaded.document.intent, route: input.route, planningGeneration, signal: input.signal });
        if (toStart !== null) return toStart;
      }

      const built = await buildRerouteRequest(
        {
          currentPosition: navigation.position.coordinate,
          authoredIntent: loaded.document.intent,
          remainingStopIds: navigation.remainingStopIds,
          completedStopIds: navigation.completedStopIds,
          detour: input.detour,
          aheadLine: input.aheadLine,
          followLine: input.followLine,
        },
        {
          requestId: `reroute-${planningGeneration}`,
          // One answer, fast: a rider waiting at a junction wants the route, not choices.
          includeAlternatives: false,
          profileFor,
          // The rider's own reported spots stay avoided on the way home too.
          extraAvoidRings: currentRiderReportRings(),
          resolveGeometry: async (ref) => (await deps.geometry.get(ref))?.payload ?? null,
        },
      );
      if (!built.ok) return { status: "unavailable", reason: "constraints-unresolved" };
      deps.provider.beginAttempt({
        rideId: navigation.plan.rideId,
        rideRevision: navigation.plan.rideRevision,
        planningGeneration,
      });
      const answer = await deps.provider.candidates(withRiderHeading(built.request, navigation), input.signal);
      if (input.signal.aborted) throw input.signal.reason;
      const chosen =
        answer.candidates.find((candidate) => candidate.providerMetadata?.["bestRide"] === true) ??
        answer.candidates[0];
      if (chosen === undefined || chosen.geometry.length < 2) return { status: "unavailable", reason: "no-route" };
      const stored = await deps.geometry.put(
        { kind: "line", coordinates: chosen.geometry },
        { kind: "route", now: now() },
      );
      const id = candidateId(chosen);
      return deepFreeze({
        status: "planned" as const,
        route: { planningGeneration, routeId: id === null ? newRouteCandidateId() : asRouteCandidateId(id) },
        routeGeometryRef: stored.geometryRef,
        durationSeconds: chosen.durationSeconds,
        distanceMeters: chosen.distanceMeters,
        ...(chosen.instructions === undefined ? {} : { instructions: chosen.instructions }),
      });
    },
  };
}
