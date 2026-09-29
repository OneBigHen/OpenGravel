import { describe, expect, it, vi } from "vitest";

import {
  isPlannerUnreachable,
  OFFLINE_ROUTING_METADATA_KEY,
  toOfflineRequest,
  withOfflineFallback,
  type OfflineRouteEngine,
} from "@/application/offline/offline-route-fallback";
import type {
  ProviderCandidateSet,
  ProviderRouteRequest,
  RouteCandidateProvider,
} from "@/application/planner/route-provider";
import type { OfflineRouteSuccess } from "@/domain/offline/offline-router";

const REQUEST: ProviderRouteRequest = {
  requestId: "r1",
  origin: { lon: -75.4385, lat: 40.1385 },
  destination: { lon: -75.4335, lat: 40.1325 },
  stops: [{ lon: -75.436, lat: 40.135 }],
  shaping: [],
  profile: "motorcycle_twisty",
  avoidPolygons: [],
  options: { includeAlternatives: true, avoidHighways: true, tollPolicy: "avoid", vehicle: "motorcycle" },
};

const ROUTE: OfflineRouteSuccess = {
  ok: true,
  edgeIds: ["w1s0f", "w1s1f"],
  osmWayIds: ["1"],
  geometry: [REQUEST.origin, REQUEST.destination],
  distanceMeters: 1_560,
  visitedStates: 40,
};

const unreachable = Object.assign(new Error("The route planner could not be reached."), {
  code: "provider-unavailable",
  httpStatus: null,
});

type Candidates = (request: ProviderRouteRequest, signal: AbortSignal) => Promise<ProviderCandidateSet>;

function primary(result: () => Promise<ProviderCandidateSet>) {
  return {
    id: "api",
    beginAttempt: vi.fn<(identity: unknown) => void>(),
    capabilities: () => ({ profiles: [], supportsAlternatives: true, supportsAvoidPolygons: true }),
    candidates: vi.fn<Candidates>(result),
  } satisfies RouteCandidateProvider & { beginAttempt: unknown };
}

function engine(route: OfflineRouteSuccess | null) {
  return { route: vi.fn<OfflineRouteEngine["route"]>(async () => route) };
}

describe("withOfflineFallback", () => {
  it("passes planner answers through and never asks the offline engine", async () => {
    const offline = engine(ROUTE);
    const wrapped = withOfflineFallback(primary(async () => ({ candidates: [] })), offline);
    await expect(wrapped.candidates(REQUEST, new AbortController().signal)).resolves.toEqual({ candidates: [] });
    expect(offline.route).not.toHaveBeenCalled();
  });

  it("keeps the wrapped provider's other methods", () => {
    const api = primary(async () => ({ candidates: [] }));
    const wrapped = withOfflineFallback(api, engine(null));
    wrapped.beginAttempt({ rideId: "x" });
    expect(api.beginAttempt).toHaveBeenCalledWith({ rideId: "x" });
    expect(wrapped.id).toBe("api");
  });

  it("plans from the downloaded region when the planner cannot be reached, marked as offline", async () => {
    const offline = engine(ROUTE);
    const wrapped = withOfflineFallback(primary(() => Promise.reject(unreachable)), offline);
    const answer = await wrapped.candidates(REQUEST, new AbortController().signal);
    expect(answer.candidates).toHaveLength(1);
    const [candidate] = answer.candidates;
    expect(candidate!.providerId).toBe("api");
    expect(candidate!.distanceMeters).toBe(1_560);
    expect(candidate!.durationSeconds).toBeGreaterThan(0);
    expect(candidate!.providerMetadata?.[OFFLINE_ROUTING_METADATA_KEY]).toBe(true);
    expect(offline.route.mock.calls[0]![0]).toMatchObject({
      waypoints: [REQUEST.origin, REQUEST.stops[0], REQUEST.destination],
      profile: "twisty",
      bike: "street",
      avoidHighways: true,
    });
  });

  it("routes a repeated offline request once across lanes", async () => {
    const offline = engine(ROUTE);
    const wrapped = withOfflineFallback(primary(() => Promise.reject(unreachable)), offline);
    const signal = new AbortController().signal;
    await Promise.all([wrapped.candidates(REQUEST, signal), wrapped.candidates({ ...REQUEST, requestId: "r2" }, signal)]);
    expect(offline.route).toHaveBeenCalledTimes(1);
  });

  it("shows the original failure when no downloaded region covers the ride", async () => {
    const wrapped = withOfflineFallback(primary(() => Promise.reject(unreachable)), engine(null));
    await expect(wrapped.candidates(REQUEST, new AbortController().signal)).rejects.toBe(unreachable);
  });

  it("does not second-guess an answer from the planner", async () => {
    const refused = Object.assign(new Error("No route"), { code: "no-route", httpStatus: 422 });
    const offline = engine(ROUTE);
    const wrapped = withOfflineFallback(primary(() => Promise.reject(refused)), offline);
    await expect(wrapped.candidates(REQUEST, new AbortController().signal)).rejects.toBe(refused);
    expect(offline.route).not.toHaveBeenCalled();
  });

  it("lets a cancelled plan stay cancelled", async () => {
    const controller = new AbortController();
    const reason = new Error("superseded");
    const wrapped = withOfflineFallback(
      primary(() => {
        controller.abort(reason);
        return Promise.reject(unreachable);
      }),
      engine(ROUTE),
    );
    await expect(wrapped.candidates(REQUEST, controller.signal)).rejects.toBe(unreachable);
  });
});

describe("isPlannerUnreachable", () => {
  it("counts a dropped connection and gateway errors, nothing else", () => {
    expect(isPlannerUnreachable(unreachable)).toBe(true);
    expect(isPlannerUnreachable({ code: "provider-unavailable", httpStatus: 502 })).toBe(true);
    expect(isPlannerUnreachable({ code: "provider-unavailable", httpStatus: 500 })).toBe(false);
    expect(isPlannerUnreachable({ code: "rate-limited", httpStatus: null })).toBe(false);
    expect(isPlannerUnreachable("offline")).toBe(false);
  });
});

describe("toOfflineRequest", () => {
  it("maps each lane's engine profile onto an offline profile", () => {
    expect(toOfflineRequest({ ...REQUEST, profile: "motorcycle_fastest" }).profile).toBe("quick");
    expect(toOfflineRequest({ ...REQUEST, profile: "motorcycle_scenic" }).profile).toBe("scenic");
    expect(toOfflineRequest({ ...REQUEST, profile: "motorcycle_adventure" })).toMatchObject({ profile: "adventure", bike: "adventure" });
    expect(
      toOfflineRequest({ ...REQUEST, profile: "motorcycle_adventure", options: { ...REQUEST.options, surfacePreference: "dirt-preferred" } }),
    ).toMatchObject({ profile: "gravel", bike: "adventure" });
  });
});
