/**
 * Ride style reaches the engine (MVP parity M2, OGV-D-262).
 *
 * Each rider choice must change what is asked of the router — or it is a
 * decorative control. These pin the request side; `tests/real-router/
 * ride-style-live.test.ts` proves GraphHopper answers differently.
 */

import { describe, expect, it } from "vitest";

import {
  buildProviderRequest,
  DEFAULT_LOOP_MINUTES,
  defaultLoopToleranceMinutes,
} from "@/application/planner/build-plan-request";
import { resolveLanes } from "@/application/planner/candidate-lanes";
import type { ProviderRouteRequest } from "@/application/planner/route-provider";
import { defaultRideIntent } from "@/domain/ride/create";
import type { PointId } from "@/domain/ride/ids";
import type { RideIntent } from "@/domain/ride/types";
import { profileFor } from "@/infrastructure/routing/graphhopper/profiles";
import {
  createGraphHopperRequest,
  REQUESTED_DETAILS,
  UNPAVED_SURFACE_CONDITION,
} from "@/infrastructure/routing/graphhopper/request-builder";
import { parseRoutePlanRequestBody } from "@/server/planning/validation";

const START = { lon: -75.7387, lat: 40.8636 };
const FINISH = { lon: -75.9832, lat: 40.6364 };

function intent(overrides: Partial<RideIntent> = {}): RideIntent {
  return {
    ...defaultRideIntent(),
    start: { id: "point_a" as PointId, kind: "start", coordinate: START, provenance: { type: "map", selectedAt: "2026-09-23T00:00:00Z" } },
    finish: { id: "point_b" as PointId, kind: "finish", coordinate: FINISH, provenance: { type: "map", selectedAt: "2026-09-23T00:00:00Z" } },
    ...overrides,
  };
}

async function requestFor(value: RideIntent): Promise<ProviderRouteRequest> {
  const result = await buildProviderRequest(value, {
    resolveGeometry: async () => null,
    profileFor,
    requestId: "req_style",
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.request;
}

describe("road character", () => {
  it("each character resolves to its own engine profile on the default surface", async () => {
    expect((await requestFor(intent({ roadCharacter: "efficient" }))).profile).toBe("motorcycle_fastest");
    expect((await requestFor(intent({ roadCharacter: "curvy" }))).profile).toBe("motorcycle_twisty");
    expect((await requestFor(intent({ roadCharacter: "backroads" }))).profile).toBe("motorcycle_scenic");
  });

  it("the rider's profile runs as a lane when no default lane asks for it", () => {
    const lanes = resolveLanes({
      capabilities: { profiles: [] } as never,
      intent: {},
      requestedProfile: "motorcycle_scenic",
      includeAlternatives: true,
    });
    expect(lanes.map((lane) => lane.profile)).toContain("motorcycle_scenic");
    expect(lanes.find((lane) => lane.profile === "motorcycle_scenic")?.id).toBe("rider-character");
  });

  it("does not duplicate a lane the defaults already run", () => {
    const lanes = resolveLanes({
      capabilities: { profiles: [] } as never,
      intent: {},
      requestedProfile: "motorcycle_twisty",
      includeAlternatives: true,
    });
    expect(lanes.filter((lane) => lane.profile === "motorcycle_twisty")).toHaveLength(1);
  });
});

describe("surface preference", () => {
  it("travels in the request options", async () => {
    const request = await requestFor(intent({ surface: { preference: "pavement", unknownSurfacePolicy: "allow-with-warning" } }));
    expect(request.options.surfacePreference).toBe("pavement");
  });

  it("becomes a GraphHopper priority rule for pavement and mostly-pavement only", () => {
    const base = {
      requestId: "r",
      origin: START,
      destination: FINISH,
      stops: [],
      shaping: [],
      profile: "motorcycle_fastest",
      avoidPolygons: [],
    } as const;
    const bodyFor = (surfacePreference: "pavement" | "mostly-pavement" | "mixed" | "dirt-preferred") =>
      createGraphHopperRequest(
        {
          ...base,
          options: { includeAlternatives: false, avoidHighways: false, tollPolicy: "allow-with-warning", surfacePreference, vehicle: "motorcycle" },
        },
        { details: REQUESTED_DETAILS },
      );
    expect(bodyFor("pavement").custom_model?.priority).toContainEqual({ if: UNPAVED_SURFACE_CONDITION, multiply_by: "0.05" });
    expect(bodyFor("mostly-pavement").custom_model?.priority).toContainEqual({ if: UNPAVED_SURFACE_CONDITION, multiply_by: "0.4" });
    expect(bodyFor("mixed").custom_model).toBeUndefined();
    expect(bodyFor("dirt-preferred").custom_model).toBeUndefined();
  });

  it("dirt-preferred selects the adventure model", async () => {
    const request = await requestFor(intent({ roadCharacter: "curvy", surface: { preference: "dirt-preferred", unknownSurfacePolicy: "allow-with-warning" } }));
    expect(request.profile).toBe("motorcycle_adventure");
  });
});

describe("loop", () => {
  it("a bare loop without a ride time asks for a default two-hour round trip", async () => {
    const request = await requestFor(intent({ shape: "loop", finish: null }));
    expect(request.destination).toEqual(START);
    expect(request.discovery).toEqual({
      targetMinutes: DEFAULT_LOOP_MINUTES,
      toleranceMinutes: defaultLoopToleranceMinutes(DEFAULT_LOOP_MINUTES),
    });
  });

  it("a chosen ride time is the loop's budget", async () => {
    const request = await requestFor(
      intent({ shape: "loop", finish: null, time: { kind: "budget", targetMinutes: 240, toleranceMinutes: 36 } }),
    );
    expect(request.discovery).toEqual({ targetMinutes: 240, toleranceMinutes: 36 });
  });

  it("a loop through a stop without a ride time stays a plain round trip", async () => {
    const request = await requestFor(
      intent({
        shape: "loop",
        finish: null,
        stops: [{ id: "stop_1" as never, kind: "stop", coordinate: FINISH, provenance: { type: "map", selectedAt: "2026-09-23T00:00:00Z" } }],
      }),
    );
    expect(request.discovery).toBeUndefined();
  });
});

describe("the server contract", () => {
  function body(options: Record<string, unknown>) {
    return {
      identity: { rideId: "ride_x", rideRevision: 1, planningGeneration: 1 },
      versions: { policyVersion: "PA_NJ_ROUTE_POLICY_VNEXT_1", evidenceVersion: "e1", providerVersion: "p1", clientVersion: "c1" },
      request: {
        requestId: "req_x",
        origin: START,
        destination: FINISH,
        stops: [],
        shaping: [],
        profile: "motorcycle_fastest",
        avoidPolygons: [],
        options: { includeAlternatives: true, avoidHighways: false, tollPolicy: "avoid", vehicle: "motorcycle", ...options },
      },
    };
  }

  it("accepts a known surface preference and an absent one", () => {
    const withPref = parseRoutePlanRequestBody(body({ surfacePreference: "pavement" }));
    const without = parseRoutePlanRequestBody(body({}));
    expect(withPref.ok && withPref.value.request.options.surfacePreference).toBe("pavement");
    expect(without.ok && without.value.request.options.surfacePreference).toBeUndefined();
  });

  it("rejects an unknown surface preference", () => {
    const parsed = parseRoutePlanRequestBody(body({ surfacePreference: "cobbles" }));
    expect(parsed.ok).toBe(false);
  });
});
