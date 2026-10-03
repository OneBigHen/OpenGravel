import { describe, expect, it } from "vitest";

import {
  planLibraryCorridorTreatment,
  runLibraryCorridorTreatment,
} from "@/application/planner/library-corridor-treatment";
import type { CandidateLane } from "@/application/planner/candidate-lanes";
import type {
  ProviderCandidate,
  ProviderRouteRequest,
  RouteCandidateProvider,
} from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";

function line(
  startLon: number,
  endLon: number,
  lat = 40,
  points = 31,
): readonly Coordinate[] {
  return Array.from({ length: points }, (_, index) => ({
    lon: startLon + ((endLon - startLon) * index) / (points - 1),
    lat,
  }));
}

function request(): ProviderRouteRequest {
  return {
    requestId: "req_corridor_budget",
    origin: { lon: -75.52, lat: 40 },
    destination: { lon: -75.14, lat: 40 },
    stops: [],
    shaping: [],
    profile: "motorcycle_scenic",
    avoidPolygons: [],
    options: {
      includeAlternatives: true,
      avoidHighways: false,
      tollPolicy: "allow-with-warning",
      vehicle: "motorcycle",
    },
  };
}

const lanes: readonly CandidateLane[] = [
  {
    id: "baseline-efficient",
    profile: "motorcycle_fastest",
    purpose: "baseline",
    maxCalls: 1,
    deadlineMs: 15_000,
  },
  {
    id: "balanced",
    profile: "motorcycle_scenic",
    purpose: "middle",
    maxCalls: 1,
    deadlineMs: 20_000,
  },
  {
    id: "curvy",
    profile: "motorcycle_twisty",
    purpose: "twisty",
    maxCalls: 1,
    deadlineMs: 20_000,
  },
];

describe("equal-budget library corridor treatment", () => {
  it("replaces only the generic balanced lane and keeps the call budget equal", () => {
    const result = planLibraryCorridorTreatment({
      request: request(),
      lanes,
      sources: [{ id: "favorite", geometry: line(-75.49, -75.2) }],
      probeOptions: {
        targetCorridorMeters: 10_000,
        minimumCorridorMeters: 4_000,
      },
    });

    expect(result.applied).toBe(true);
    if (!result.applied) return;

    expect(result.plan.providerCallBudget).toBe(lanes.length);
    expect(result.plan.replacedLane.id).toBe("balanced");
    expect(result.plan.normalLanes.map((lane) => lane.id)).toEqual([
      "baseline-efficient",
      "curvy",
    ]);
    expect(result.plan.probeLane.id).toBe("library-corridor");
    expect(result.plan.probeRequest.shaping.length).toBeGreaterThanOrEqual(2);
    expect(result.plan.probeRequest.options.includeAlternatives).toBe(false);
  });

  it("preserves explicit surface and rider-character lanes", () => {
    const expanded: readonly CandidateLane[] = [
      ...lanes,
      {
        id: "surface-targeted",
        profile: "motorcycle_adventure",
        purpose: "surface",
        maxCalls: 1,
        deadlineMs: 20_000,
      },
      {
        id: "rider-character",
        profile: "motorcycle_scenic-plus",
        purpose: "explicit character",
        maxCalls: 1,
        deadlineMs: 20_000,
      },
    ];

    const result = planLibraryCorridorTreatment({
      request: request(),
      lanes: expanded,
      sources: [{ id: "favorite", geometry: line(-75.49, -75.2) }],
    });

    expect(result.applied).toBe(true);
    if (!result.applied) return;

    expect(result.plan.normalLanes.map((lane) => lane.id)).toEqual([
      "baseline-efficient",
      "curvy",
      "surface-targeted",
      "rider-character",
    ]);
    expect(result.plan.providerCallBudget).toBe(expanded.length);
  });

  it("fails closed when there is no generic balanced lane to replace", () => {
    const result = planLibraryCorridorTreatment({
      request: request(),
      lanes: lanes.filter((lane) => lane.id !== "balanced"),
      sources: [{ id: "favorite", geometry: line(-75.49, -75.2) }],
    });

    expect(result).toEqual({
      applied: false,
      reason: "no-balanced-lane",
    });
  });

  it("runs the treatment at the original provider-call budget and measures adherence", async () => {
    const planned = planLibraryCorridorTreatment({
      request: request(),
      lanes,
      sources: [{ id: "favorite", geometry: line(-75.49, -75.2) }],
      probeOptions: {
        targetCorridorMeters: 10_000,
        minimumCorridorMeters: 4_000,
      },
    });
    expect(planned.applied).toBe(true);
    if (!planned.applied) return;

    const seen: ProviderRouteRequest[] = [];
    const provider: RouteCandidateProvider = {
      id: "stub",
      capabilities: () => ({
        profiles: [
          "motorcycle_fastest",
          "motorcycle_scenic",
          "motorcycle_twisty",
        ],
        supportsAlternatives: true,
        supportsAvoidPolygons: true,
      }),
      candidates: async (routeRequest) => {
        seen.push(routeRequest);
        const geometry =
          routeRequest.shaping.length >= 2
            ? routeRequest.shaping
            : [routeRequest.origin, routeRequest.destination];
        const candidate: ProviderCandidate = {
          providerId: "stub",
          profile: routeRequest.profile,
          geometry,
          distanceMeters: 10_000,
          durationSeconds: 900,
        };
        return { candidates: [candidate] };
      },
    };

    const run = await runLibraryCorridorTreatment({
      plan: planned.plan,
      request: request(),
      provider,
      signal: new AbortController().signal,
    });

    expect(seen).toHaveLength(lanes.length);
    expect(run.providerCallBudget).toBe(lanes.length);
    expect(run.replacedLaneId).toBe("balanced");
    expect(run.candidates).toHaveLength(lanes.length);
    expect(seen.every((item) => item.options.includeAlternatives === false)).toBe(true);
    expect(seen.filter((item) => item.shaping.length >= 2)).toHaveLength(1);
    expect(run.adherence).not.toBeNull();
    expect(run.adherence!.share).toBeGreaterThan(0.95);
  });
});
