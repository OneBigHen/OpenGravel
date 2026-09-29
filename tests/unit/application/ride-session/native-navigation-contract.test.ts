import { describe, expect, it } from "vitest";

import {
  buildNativeNavigationPayload,
  guidedNativeNavigationPayload,
  NATIVE_REROUTE_POLICY_VERSION,
  NATIVE_NAVIGATION_SCHEMA_VERSION,
} from "@/application/ride-session/native-navigation-contract";
import type { ResolvedNavigationRoute } from "@/application/ride-session/navigation-engine";
import { asSessionInstructionId } from "@/domain/ride-session/ids";
import { asRouteCandidateId } from "@/domain/route/ids";

function guidedRoute(): ResolvedNavigationRoute {
  return {
    mode: "guided",
    binding: {
      routeId: asRouteCandidateId("route_native_fixture"),
      planningGeneration: 7,
    },
    geometry: [
      { lat: 40.177, lon: -75.106 },
      { lat: 40.181, lon: -75.098 },
      { lat: 40.188, lon: -75.087 },
    ],
    maneuvers: [
      {
        instructionId: asSessionInstructionId("instr_native_1"),
        kind: "turn",
        maneuver: "right",
        roadName: "County Line Road",
        targetStopId: null,
        atDistanceMeters: 550,
      },
      {
        instructionId: asSessionInstructionId("instr_native_2"),
        kind: "arrive",
        maneuver: null,
        roadName: null,
        targetStopId: null,
        atDistanceMeters: 1_200,
      },
    ],
  };
}

const metadata = {
  fingerprint: "fp_native_fixture",
  title: "via County Line Road",
  distanceMeters: 1_200,
  durationSeconds: 110,
  reroutePolicyVersion: "reroute-v1",
} as const;

describe("native navigation contract", () => {
  it("preserves OpenGravel route identity and normalized guidance", () => {
    const payload = buildNativeNavigationPayload(guidedRoute(), metadata);

    expect(payload.schemaVersion).toBe(NATIVE_NAVIGATION_SCHEMA_VERSION);
    expect(payload.schema).toBe("native-navigation/v1");
    expect(payload.mode).toBe("guided");
    expect(payload.routeId).toBe("route_native_fixture");
    expect(payload.planningGeneration).toBe(7);
    expect(payload.fingerprint).toBe("fp_native_fixture");
    expect(payload.geometry).toEqual(guidedRoute().geometry);
    expect(payload.maneuvers).toEqual([
      {
        id: "instr_native_1",
        kind: "turn",
        maneuver: "right",
        roadName: "County Line Road",
        atDistanceMeters: 550,
      },
      {
        id: "instr_native_2",
        kind: "arrive",
        maneuver: null,
        roadName: null,
        atDistanceMeters: 1_200,
      },
    ]);
  });

  it("refuses an unbound track instead of pretending it is guided navigation", () => {
    expect(() =>
      buildNativeNavigationPayload(
        {
          mode: "track",
          geometry: [
            { lat: 40, lon: -75 },
            { lat: 40.1, lon: -75.1 },
          ],
        },
        metadata,
      ),
    ).toThrow(/guided route binding/i);
  });

  it("refuses invalid coordinates at the native boundary", () => {
    const route = guidedRoute();
    expect(() =>
      buildNativeNavigationPayload(
        { ...route, geometry: [{ lat: 95, lon: -75 }, route.geometry[1]!] },
        metadata,
      ),
    ).toThrow(/invalid coordinate/i);
  });

  it("refuses maneuver order that would make native guidance ambiguous", () => {
    const route = guidedRoute();
    expect(() =>
      buildNativeNavigationPayload(
        {
          ...route,
          maneuvers: [
            route.maneuvers![1]!,
            route.maneuvers![0]!,
          ],
        },
        metadata,
      ),
    ).toThrow(/ordered along the route/i);
  });

  it("refuses a maneuver beyond the authoritative route distance", () => {
    const route = guidedRoute();
    expect(() =>
      buildNativeNavigationPayload(
        {
          ...route,
          maneuvers: [
            {
              ...route.maneuvers![0]!,
              atDistanceMeters: 2_000,
            },
          ],
        },
        metadata,
      ),
    ).toThrow(/beyond the route distance/i);
  });

  it("builds the starting ride's payload from its route: measured length, binding fingerprint", () => {
    const payload = guidedNativeNavigationPayload(guidedRoute(), 600);
    expect(payload.distanceMeters).toBeGreaterThan(1_900);
    expect(payload.distanceMeters).toBeLessThan(2_100);
    expect(payload.durationSeconds).toBe(600);
    expect(payload.fingerprint).toBe("route_native_fixture:7:3");
    expect(payload.reroutePolicyVersion).toBe(NATIVE_REROUTE_POLICY_VERSION);
    expect(guidedNativeNavigationPayload(guidedRoute(), undefined).durationSeconds).toBe(0);
  });
});
