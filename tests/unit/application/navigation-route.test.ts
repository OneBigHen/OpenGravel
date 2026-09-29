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
});
