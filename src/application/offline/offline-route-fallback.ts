/**
 * Offline route fallback (WORK-ORDER §2.4, Lane A1).
 *
 * When the route planner cannot be reached at all, a ride can still be planned
 * from an offline road-graph region the rider downloaded. This wraps the
 * deployment's provider: every answer the planner gives passes through
 * untouched, and only a transport failure (no signal, or the server is down)
 * asks the offline engine. If no downloaded region covers the ride, the
 * original failure is what the rider sees; nothing is invented.
 *
 * An offline candidate is marked `offlineRouting`, so the pipeline attaches a
 * warning that says plainly what an offline plan cannot know.
 */

import type {
  ProviderCandidate,
  ProviderCandidateSet,
  ProviderRouteRequest,
  RouteCandidateProvider,
} from "@/application/planner/route-provider";
import type { RouteWarning } from "@/domain/route/types";
import { offlineProfileFor, type OfflineRouteRequest, type OfflineRouteSuccess } from "@/domain/offline/offline-router";

/** The worker-backed engine the fallback asks; `null` means no region covers the ride. */
export interface OfflineRouteEngine {
  route(request: OfflineRouteRequest, signal: AbortSignal): Promise<OfflineRouteSuccess | null>;
}

/**
 * A candidate the device planned from a downloaded offline region, because the
 * route planner could not be reached (this module).
 */
export const OFFLINE_ROUTING_WARNING: RouteWarning = {
  id: "provider:offline-routing",
  code: "offline-routing",
  severity: "info",
  message:
    "Planned offline from your downloaded map: the time is an estimate, and traffic, weather, turn cues and avoid areas need signal.",
};

/** Marks a candidate that was planned on the device from a downloaded region. */
export const OFFLINE_ROUTING_METADATA_KEY = "offlineRouting";

/**
 * Planning speeds for the time estimate. The offline graph carries no
 * per-edge travel times, so the duration is a plain average, not a claim.
 */
const STREET_METERS_PER_SECOND = 56_000 / 3600;
const DIRT_METERS_PER_SECOND = 40_000 / 3600;

interface TransportFailure {
  readonly code: string;
  readonly httpStatus: number | null;
}

/**
 * Whether a provider error means "the planner could not be reached", as
 * opposed to an answer (a 4xx, a no-route verdict) that offline must not
 * second-guess. Gateway errors count: the proxy answers them when the app
 * server is down.
 */
export function isPlannerUnreachable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, httpStatus } = error as Partial<TransportFailure>;
  if (code !== "provider-unavailable") return false;
  return httpStatus === null || httpStatus === undefined || httpStatus === 502 || httpStatus === 503 || httpStatus === 504;
}

/** Which road character an engine profile stands for; the request's own when it names none. */
function characterFor(request: ProviderRouteRequest) {
  const profile = request.profile;
  if (profile.includes("fastest")) return "efficient" as const;
  if (profile.includes("twisty")) return "curvy" as const;
  if (profile.includes("scenic")) return request.options.roadCharacter === "balanced" ? ("balanced" as const) : ("backroads" as const);
  return request.options.roadCharacter ?? "balanced";
}

/**
 * The surface an offline search honours. The adventure lane is the one that
 * carries a dirt preference; every other lane is the paved answer, so an
 * absent or `mixed` preference rides pavement there.
 */
function surfaceFor(request: ProviderRouteRequest) {
  const preference = request.options.surfacePreference;
  if (request.profile.includes("adventure")) return preference === "dirt-preferred" ? ("dirt-preferred" as const) : ("mixed" as const);
  return preference === "mostly-pavement" || preference === "dirt-preferred" ? ("mostly-pavement" as const) : ("pavement" as const);
}

/** The offline request for one provider request: its stops in order, its character and surface. */
export function toOfflineRequest(request: ProviderRouteRequest): OfflineRouteRequest {
  const { profile, bike } = offlineProfileFor(characterFor(request), surfaceFor(request));
  return {
    waypoints: [request.origin, ...request.stops, request.destination],
    profile,
    bike,
    avoidHighways: request.options.avoidHighways,
  };
}

export function offlineCandidate(
  providerId: string,
  request: ProviderRouteRequest,
  offline: OfflineRouteRequest,
  route: OfflineRouteSuccess,
): ProviderCandidate {
  const speed = offline.bike === "adventure" ? DIRT_METERS_PER_SECOND : STREET_METERS_PER_SECOND;
  return {
    providerId,
    profile: request.profile,
    geometry: route.geometry.map((point) => ({ lon: point.lon, lat: point.lat })),
    distanceMeters: route.distanceMeters,
    durationSeconds: Math.round(route.distanceMeters / speed),
    providerMetadata: {
      [OFFLINE_ROUTING_METADATA_KEY]: true,
      fingerprint: `offline:${offline.profile}:${route.edgeIds.length}:${Math.round(route.distanceMeters)}`,
    },
  };
}

/**
 * Wraps `primary` so an unreachable planner falls back to the offline engine.
 * Several lanes can map onto one offline profile; each distinct offline request
 * is routed once per attempt.
 */
export function withOfflineFallback<P extends RouteCandidateProvider>(primary: P, engine: OfflineRouteEngine): P {
  const inFlight = new Map<string, Promise<OfflineRouteSuccess | null>>();

  async function fallback(
    request: ProviderRouteRequest,
    signal: AbortSignal,
    original: unknown,
  ): Promise<ProviderCandidateSet> {
    const offline = toOfflineRequest(request);
    const key = JSON.stringify(offline);
    let pending = inFlight.get(key);
    if (pending === undefined) {
      pending = engine.route(offline, signal);
      inFlight.set(key, pending);
      // A cached answer lives only for this burst of lane calls.
      void pending.finally(() => setTimeout(() => inFlight.delete(key), 0)).catch(() => undefined);
    }
    let route: OfflineRouteSuccess | null;
    try {
      route = await pending;
    } catch {
      if (signal.aborted) throw signal.reason;
      throw original;
    }
    if (signal.aborted) throw signal.reason;
    if (route === null) throw original;
    return { candidates: [offlineCandidate(primary.id, request, offline, route)] };
  }

  // Providers are closures over their own state, so a shallow copy keeps
  // every other method (the API bridge's `beginAttempt`) working.
  return {
    ...primary,
    async candidates(request: ProviderRouteRequest, signal: AbortSignal): Promise<ProviderCandidateSet> {
      try {
        return await primary.candidates(request, signal);
      } catch (error) {
        if (signal.aborted || !isPlannerUnreachable(error)) throw error;
        return fallback(request, signal, error);
      }
    },
  };
}
