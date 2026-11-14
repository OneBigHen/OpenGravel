/**
 * Basic routes: a plain motorcycle line where OpenGravel's own graph cannot
 * answer, instead of "No route yet".
 *
 * GraphHopper stays the authority wherever its graph covers the ride. When any
 * point of a ride is outside that graph's box (read from the router itself), or
 * when our router is down, the ride is planned once through Valhalla with the
 * rider's style mapped onto its motorcycle costing. The answer skips every
 * OpenGravel lane, search and score: it carries no surface, closure, access or
 * curvature evidence (all stay unknown), a zero score, and a plain-English label
 * saying it is a basic route. It is never a tuned result.
 */

import { fnv1a64Hex } from "@/application/planner/build-plan-request";
import type { RoutePlanCandidate } from "@/application/planner/ports/route-plan-contract";
import type { ProviderRouteRequest } from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";
import { newRouteCandidateId } from "@/domain/route/ids";
import { MAX_ROUTE_INSTRUCTIONS, type RouteScoreComponents, type RouteWarning } from "@/domain/route/types";
import type { CoverageBox } from "@/infrastructure/routing/graphhopper/fallback-provider";
import { ValhallaRoutingError, type ValhallaRouter } from "@/infrastructure/routing/valhalla/router";

import type { PlanRideInput, PlanServiceResult } from "./plan-service";

/** Why a ride got a basic route. */
export type BasicRouteReason = "outside-coverage" | "router-down";

export const BASIC_POLICY_VERSION = "basic-v1";

export const BASIC_ROUTE_COPY: Readonly<Record<BasicRouteReason, string>> = {
  "outside-coverage": "Basic route — OpenGravel's curvy and gravel tuning covers PA, NJ and NY only.",
  "router-down": "Basic route — OpenGravel's own planner didn't answer, so curvy and gravel tuning wasn't applied.",
};

export const BASIC_LOOP_COPY =
  "Loops are planned only in PA, NJ and NY for now. Pick a destination to get a basic route here.";
export const BASIC_ROAD_CHOICES_COPY =
  "Must-ride and avoid-road choices work only in PA, NJ and NY. Remove them to get a basic route here.";

/** Every point the ride asks the router to reach, in the builder's order. */
export function ridePoints(request: ProviderRouteRequest): readonly Coordinate[] {
  return [
    request.origin,
    ...request.stops,
    ...request.shaping,
    ...(request.sketch?.anchors ?? []),
    request.destination,
  ];
}

function inside(box: CoverageBox, point: Coordinate): boolean {
  const [minLon, minLat, maxLon, maxLat] = box;
  return point.lon >= minLon && point.lon <= maxLon && point.lat >= minLat && point.lat <= maxLat;
}

/**
 * True when any point is outside the router's coverage box. An unknown box
 * (the router did not say) is not "outside": GraphHopper is asked first, and an
 * off-graph answer from it still falls through to a basic route.
 */
export function leavesCoverage(request: ProviderRouteRequest, box: CoverageBox | null): boolean {
  if (box === null) return false;
  return ridePoints(request).some((point) => !inside(box, point));
}

const UNSCORED_KEYS = [
  "curvature", "backroad", "surfaceFit", "elevation", "traffic", "junctionFriction",
  "novelty", "closureRisk", "timeCost", "confidence",
] as const;

function unscored(): RouteScoreComponents {
  return Object.fromEntries(UNSCORED_KEYS.map((key) => [key, {
    input: null, weight: 0, contribution: 0, explanationKey: "basic.unscored", evidenceStatus: "unknown",
  }])) as unknown as RouteScoreComponents;
}

export function basicRouteWarning(reason: BasicRouteReason): RouteWarning {
  return { id: "provider:basic-routing", code: "basic-routing", severity: "info", message: BASIC_ROUTE_COPY[reason] };
}

export async function planBasicRide(
  input: PlanRideInput,
  router: ValhallaRouter,
  reason: BasicRouteReason,
  options: { readonly signal: AbortSignal; readonly graphVersion: string },
): Promise<PlanServiceResult> {
  const request = input.request;
  if (request.discovery !== undefined) {
    return { ok: false, error: { code: "outside-coverage", message: BASIC_LOOP_COPY, recoverable: false } };
  }
  if ((request.roadSpans?.length ?? 0) > 0) {
    return { ok: false, error: { code: "constraint-conflict", message: BASIC_ROAD_CHOICES_COPY, recoverable: false } };
  }
  try {
    const route = await router.route(request, options.signal);
    const candidate: RoutePlanCandidate = {
      id: newRouteCandidateId(),
      provider: { providerId: `valhalla-${router.upstream}`, profile: request.profile },
      geometry: route.geometry.map((point) => ({ lon: point.lon, lat: point.lat })),
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      ...(route.instructions.length === 0
        ? {}
        : {
            instructions: route.instructions.slice(0, MAX_ROUTE_INSTRUCTIONS).map((instruction) => ({
              ...instruction,
              text: instruction.text.slice(0, 512),
              ...(instruction.roadName === undefined ? {} : { roadName: instruction.roadName.slice(0, 160) }),
            })),
          }),
      eligibility: { eligible: true, failures: [] },
      // Nothing about surface, closures, access or curvature was checked.
      evidence: {},
      score: { policyVersion: BASIC_POLICY_VERSION, total: 0, components: unscored() },
      warnings: [basicRouteWarning(reason)],
      fingerprint: `basic:${fnv1a64Hex(JSON.stringify(route.geometry))}`,
    };
    return {
      ok: true,
      identity: input.identity,
      bundle: {
        policyVersion: BASIC_POLICY_VERSION,
        graphVersion: options.graphVersion,
        evidenceVersion: "unknown",
        candidates: [candidate],
        roles: {
          "best-ride": candidate.id, fastest: candidate.id, "fast-and-fun": null,
          "more-twisties": null, "more-dirt": null, "lower-workload": null,
        },
        selectedRouteId: candidate.id,
        selectionSource: "automatic",
      },
      diagnostics: {
        optionalProvidersUnavailable: [],
        providers: [{ providerId: `valhalla-${router.upstream}`, outcome: "ok", note: `basic-route:${reason}` }],
      },
    };
  } catch (error) {
    if (options.signal.aborted) return { ok: false, error: { code: "cancelled", message: "The planning request was cancelled.", recoverable: false } };
    if (error instanceof ValhallaRoutingError) {
      return { ok: false, error: { code: error.code, message: error.message, recoverable: error.recoverable } };
    }
    return { ok: false, error: { code: "provider-unavailable", message: "The basic route service could not be reached. Try again in a few minutes.", recoverable: true } };
  }
}
