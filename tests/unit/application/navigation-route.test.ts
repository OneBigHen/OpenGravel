import { describe, expect, it } from "vitest";

import { buildGuidedNavigationRoute } from "@/application/ride-session/navigation-route";
import type { ProviderInstruction } from "@/application/planner/route-provider";
import { asRouteCandidateId } from "@/domain/route/ids";

describe("routed instruction normalization", () => {
  it("keeps provider-supplied maneuver semantics and stable identities", () => {
    const binding = {
      planningGeneration: 3,
      routeId: asRouteCandidateId("route_guidance"),
    };
    const geometry = [
      { lon: -75.44, lat: 40.14 },
      { lon: -75.439, lat: 40.14 },
      { lon: -75.438, lat: 40.14 },
    ];
    const instructions: ProviderInstruction[] = [
      {
        text: "Continue",
        distanceMeters: 80,
        durationSeconds: 8,
        type: "continue",
        maneuver: "straight",
        roadName: "Main Street",
        geometryIndex: 0,
      },
      {
        text: "Turn right",
        distanceMeters: 80,
        durationSeconds: 8,
        type: "turn",
        maneuver: "right",
        roadName: "Ridge Road",
        geometryIndex: 1,
      },
    ];

    const route = buildGuidedNavigationRoute(binding, geometry, instructions);

    expect(route.maneuvers).toHaveLength(2);
    expect(route.maneuvers?.[0]).toMatchObject({
      instructionId: "instr_route_guidance_0",
      kind: "continue",
      roadName: "Main Street",
      atDistanceMeters: 0,
    });
    expect(route.maneuvers?.[1]).toMatchObject({
      instructionId: "instr_route_guidance_1",
      kind: "turn",
      maneuver: "right",
      roadName: "Ridge Road",
    });
    expect(route.maneuvers?.[1]?.atDistanceMeters).toBeGreaterThan(80);
  });

  it("drops an opaque provider turn instead of inventing its direction", () => {
    const route = buildGuidedNavigationRoute(
      { planningGeneration: 1, routeId: asRouteCandidateId("route_unknown") },
      [
        { lon: -75.44, lat: 40.14 },
        { lon: -75.43, lat: 40.14 },
      ],
      [
        {
          text: "Take the mystery turn",
          distanceMeters: 100,
          durationSeconds: 10,
          type: "turn",
        },
      ],
    );

    expect(route.maneuvers).toEqual([]);
  });

  it("keeps roundabouts and forks as their own kinds instead of dropping them", () => {
    const geometry = [
      { lon: -75.44, lat: 40.14 },
      { lon: -75.439, lat: 40.14 },
      { lon: -75.438, lat: 40.14 },
      { lon: -75.437, lat: 40.14 },
    ];
    const route = buildGuidedNavigationRoute(
      { planningGeneration: 2, routeId: asRouteCandidateId("route_junctions") },
      geometry,
      [
        {
          text: "At the roundabout, take the 2nd exit",
          distanceMeters: 120,
          durationSeconds: 12,
          type: "roundabout",
          roadName: "PA-23",
          geometryIndex: 2,
          exitNumber: 2,
        },
        {
          text: "Keep left",
          distanceMeters: 90,
          durationSeconds: 9,
          type: "keep-left",
          geometryIndex: 3,
        },
        {
          text: "Keep right",
          distanceMeters: 90,
          durationSeconds: 9,
          type: "keep-right",
          geometryIndex: 3,
        },
      ],
    );

    expect(route.maneuvers).toHaveLength(3);
    expect(route.maneuvers?.[0]).toMatchObject({
      kind: "roundabout",
      maneuver: null,
      roadName: "PA-23",
      exitNumber: 2,
    });
    expect(route.maneuvers?.[1]).toMatchObject({ kind: "keep-left", maneuver: null });
    expect(route.maneuvers?.[2]).toMatchObject({ kind: "keep-right", maneuver: null });
  });

  it("carries no exit number when the provider stated none", () => {
    const route = buildGuidedNavigationRoute(
      { planningGeneration: 2, routeId: asRouteCandidateId("route_roundabout") },
      [
        { lon: -75.44, lat: 40.14 },
        { lon: -75.43, lat: 40.14 },
      ],
      [
        {
          text: "At the roundabout",
          distanceMeters: 120,
          durationSeconds: 12,
          type: "roundabout",
        },
      ],
    );

    expect(route.maneuvers?.[0]).toMatchObject({ kind: "roundabout" });
    expect(route.maneuvers?.[0]?.exitNumber).toBeUndefined();
  });
});
