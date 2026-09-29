import type { GeometryStore } from "@/application/geometry/geometry-store";
import { buildProviderRequest } from "@/application/planner/build-plan-request";
import type { RideRepositoryPort } from "@/application/persistence/ride-repository";
import type { ProviderCandidate } from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";
import type { RouteInstruction } from "@/domain/route/types";
import { asRouteCandidateId, newRouteCandidateId } from "@/domain/route/ids";
import type { SessionNavigationState } from "@/domain/ride-session/navigation";
import type { SessionRouteBinding } from "@/domain/ride-session/types";
import { deepFreeze } from "@/domain/util/freeze";
import type { ExplicitReturnTarget, ReturnMode } from "./return-routing";
import { buildReturnIntent } from "./return-routing";

export type ReturnPlanResult =
  | {
      readonly status: "planned";
      readonly route: SessionRouteBinding;
      readonly routeGeometryRef: import("@/domain/ride/ids").GeometryRef;
      readonly durationSeconds: number;
      readonly distanceMeters: number;
      readonly instructions?: readonly RouteInstruction[];
    }
  | { readonly status: "unavailable"; readonly reason: "not-free" | "gps" | "ride-missing" | "stale-ride" | "invalid-target" | "constraints-unresolved" | "no-route" | "no-lower-workload-route" };

function metadataFlag(candidate: ProviderCandidate, key: string): boolean {
  return candidate.providerMetadata?.[key] === true;
}

function candidateId(candidate: ProviderCandidate): string | null {
  const id = candidate.providerMetadata?.["candidateId"];
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Uses the canonical planner and the server's lower-workload role for returns from Free Ride or a guided ride. */
export function createReturnPlanner(deps: {
  readonly rides: RideRepositoryPort;
  readonly geometry: GeometryStore;
  readonly provider: {
    beginAttempt(identity: { readonly rideId: string; readonly rideRevision: number; readonly planningGeneration: number }): void;
    candidates(request: import("@/application/planner/route-provider").ProviderRouteRequest, signal: AbortSignal): Promise<{ readonly candidates: readonly ProviderCandidate[] }>;
  };
  readonly now?: () => string;
}) {
  let generation = Math.max(1, Date.now());
  const now = deps.now ?? (() => new Date().toISOString());
  return {
    async plan(input: {
      readonly navigation: SessionNavigationState;
      readonly target: ExplicitReturnTarget;
      readonly mode: ReturnMode;
      readonly signal: AbortSignal;
      /** Ride through this place first (a fuel stop). */
      readonly via?: { readonly coordinate: Coordinate; readonly label: string };
      /**
       * Re-planning a return already under way: an easier return keeps its
       * efficient-road request but takes the best route when no separate
       * lower-workload candidate comes back.
       */
      readonly fallbackToBest?: boolean;
      /** `loop` mode: a new loop of this many minutes from here. */
      readonly loopMinutes?: number;
      /** `loop` mode, re-planning: shaping through the rest of the loop. */
      readonly rejoin?: readonly Coordinate[];
    }): Promise<ReturnPlanResult> {
      if (input.navigation.activity !== "free" && input.navigation.activity !== "guided") return { status: "unavailable", reason: "not-free" };
      if (input.navigation.position.quality !== "fresh-good" || input.navigation.position.coordinate === null) {
        return { status: "unavailable", reason: "gps" };
      }
      if (input.signal.aborted) throw input.signal.reason;
      const loaded = await deps.rides.loadRide(input.navigation.plan.rideId);
      if (loaded === null) return { status: "unavailable", reason: "ride-missing" };
      if (!loaded.ok) return { status: "unavailable", reason: "ride-missing" };
      if (loaded.document.revision !== input.navigation.plan.rideRevision) return { status: "unavailable", reason: "stale-ride" };
      const built = buildReturnIntent({
        authoredIntent: loaded.document.intent,
        currentPosition: input.navigation.position.coordinate,
        target: input.target,
        mode: input.mode,
        via: input.via,
        loopMinutes: input.loopMinutes,
        rejoin: input.rejoin,
      });
      if (!built.ok) return { status: "unavailable", reason: "invalid-target" };
      const planningGeneration = ++generation;
      const request = await buildProviderRequest(built.intent, {
        requestId: `return-${planningGeneration}`,
        includeAlternatives: true,
        resolveGeometry: async (ref) => (await deps.geometry.get(ref))?.payload ?? null,
      });
      if (!request.ok || request.unresolvedRefs.length > 0) return { status: "unavailable", reason: "constraints-unresolved" };
      deps.provider.beginAttempt({
        rideId: input.navigation.plan.rideId,
        rideRevision: input.navigation.plan.rideRevision,
        planningGeneration,
      });
      const answer = await deps.provider.candidates(request.request, input.signal);
      if (input.signal.aborted) throw input.signal.reason;
      const best = answer.candidates.find((candidate) => metadataFlag(candidate, "bestRide")) ?? answer.candidates[0];
      const chosen = input.mode === "fatigue"
        ? answer.candidates.find((candidate) => metadataFlag(candidate, "lowerWorkload")) ??
          (input.fallbackToBest === true ? best : undefined)
        : best;
      if (chosen === undefined) {
        return { status: "unavailable", reason: input.mode === "fatigue" ? "no-lower-workload-route" : "no-route" };
      }
      const geometry = await deps.geometry.put(
        { kind: "line", coordinates: chosen.geometry },
        { kind: "route", now: now() },
      );
      const id = candidateId(chosen);
      return deepFreeze({
        status: "planned",
        route: { planningGeneration, routeId: id === null ? newRouteCandidateId() : asRouteCandidateId(id) },
        routeGeometryRef: geometry.geometryRef,
        durationSeconds: chosen.durationSeconds,
        distanceMeters: chosen.distanceMeters,
        ...(chosen.instructions === undefined ? {} : { instructions: chosen.instructions }),
      });
    },
  };
}
