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
import type { RideRepositoryPort } from "@/application/persistence/ride-repository";
import type { ProviderCandidate, ProviderRouteRequest } from "@/application/planner/route-provider";
import type { GeometryRef } from "@/domain/ride/ids";
import type { Coordinate } from "@/domain/ride/types";
import type { SessionNavigationState } from "@/domain/ride-session/navigation";
import type { SessionRouteBinding } from "@/domain/ride-session/types";
import { asRouteCandidateId, newRouteCandidateId } from "@/domain/route/ids";
import type { RouteInstruction } from "@/domain/route/types";
import { deepFreeze } from "@/domain/util/freeze";

import { buildRerouteRequest } from "./reroute";

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
    readonly signal: AbortSignal;
  }): Promise<GuidedRerouteResult>;
}

function candidateId(candidate: ProviderCandidate): string | null {
  const id = candidate.providerMetadata?.["candidateId"];
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function createGuidedReroutePlanner(deps: {
  readonly rides: RideRepositoryPort;
  readonly geometry: GeometryStore;
  readonly provider: {
    beginAttempt(identity: { readonly rideId: string; readonly rideRevision: number; readonly planningGeneration: number }): void;
    candidates(request: ProviderRouteRequest, signal: AbortSignal): Promise<{ readonly candidates: readonly ProviderCandidate[] }>;
  };
  readonly now?: () => string;
}): GuidedReroutePlanner {
  const now = deps.now ?? (() => new Date().toISOString());
  let generation = 0;
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
          resolveGeometry: async (ref) => (await deps.geometry.get(ref))?.payload ?? null,
        },
      );
      if (!built.ok) return { status: "unavailable", reason: "constraints-unresolved" };
      deps.provider.beginAttempt({
        rideId: navigation.plan.rideId,
        rideRevision: navigation.plan.rideRevision,
        planningGeneration,
      });
      const answer = await deps.provider.candidates(built.request, input.signal);
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
