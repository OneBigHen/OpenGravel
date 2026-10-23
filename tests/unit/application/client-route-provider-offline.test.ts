/**
 * The reroute and Free Ride providers must be able to plan from the region the
 * rider downloaded.
 *
 * The planner workspace already wraps its provider with the offline fallback;
 * the single most common offline moment is a missed turn on the ride screen,
 * where "Reroute now", "Fuel ahead" and head-home asked a bare `/api/route-plan`
 * and failed on transport. The browser provider factory therefore carries the
 * fallback itself, so every call site that builds one gets it.
 */

import { describe, expect, it, vi } from "vitest";

import {
  OFFLINE_ROUTING_METADATA_KEY,
  type OfflineRouteEngine,
} from "@/application/offline/offline-route-fallback";
import { createClientRouteCandidateProvider } from "@/application/planner/client-planning-service";
import type { ProviderRouteRequest } from "@/application/planner/route-provider";
import type { OfflineRouteSuccess } from "@/domain/offline/offline-router";

const REQUEST: ProviderRouteRequest = {
  requestId: "reroute-1",
  origin: { lon: -75.7, lat: 40.1 },
  destination: { lon: -75.1, lat: 40.5 },
  stops: [],
  shaping: [],
  profile: "motorcycle_balanced",
  avoidPolygons: [],
  options: { includeAlternatives: false, avoidHighways: false, tollPolicy: "allow-with-warning", vehicle: "motorcycle" },
};

const ROUTE: OfflineRouteSuccess = {
  ok: true,
  edgeIds: ["w1s0f", "w1s1f"],
  osmWayIds: ["1"],
  geometry: [REQUEST.origin, REQUEST.destination],
  distanceMeters: 2_400,
  visitedStates: 30,
};

function offlineEngine(route: OfflineRouteSuccess | null): OfflineRouteEngine {
  return { route: vi.fn<OfflineRouteEngine["route"]>(async () => route) };
}

/** The transport failure a rider with no signal gets from the bridge. */
function unreachableFetcher(): typeof fetch {
  return vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch;
}

describe("createClientRouteCandidateProvider", () => {
  it("plans the reroute from the downloaded region when the planner cannot be reached", async () => {
    const engine = offlineEngine(ROUTE);
    const provider = createClientRouteCandidateProvider({ fetcher: unreachableFetcher(), offlineEngine: engine });
    provider.beginAttempt({ rideId: "ride_1", rideRevision: 2, planningGeneration: 3 });

    const answer = await provider.candidates(REQUEST, new AbortController().signal);

    expect(engine.route).toHaveBeenCalledTimes(1);
    expect(answer.candidates).toHaveLength(1);
    expect(answer.candidates[0]).toMatchObject({
      providerId: "api",
      distanceMeters: 2_400,
      providerMetadata: { [OFFLINE_ROUTING_METADATA_KEY]: true },
    });
    // The reroute planner requires the identity-scoped attempt to survive the wrap.
    expect(provider.beginAttempt).toBeTypeOf("function");
  }, 10_000);

  it("does not second-guess an answer the planner did give", async () => {
    const engine = offlineEngine(ROUTE);
    // A 200 that is not a plan is the deployment's fault, not the signal's:
    // offline must not answer when the planner was reachable.
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } }),
    ) as unknown as typeof fetch;
    const provider = createClientRouteCandidateProvider({ fetcher, offlineEngine: engine });
    provider.beginAttempt({ rideId: "ride_1", rideRevision: 2, planningGeneration: 3 });

    await expect(provider.candidates(REQUEST, new AbortController().signal)).rejects.toMatchObject({
      code: "provider-unavailable",
    });
    expect(engine.route).not.toHaveBeenCalled();
  }, 10_000);
});
