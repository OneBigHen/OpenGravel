import { describe, expect, it } from "vitest";

import {
  buildProgressModel,
  InvalidProgressRouteError,
  matchRouteProgress,
  type ProgressFrame,
  type ProgressRoute,
} from "@/domain/ride-session/progress";
import { asSessionInstructionId } from "@/domain/ride-session/ids";
import type { Coordinate } from "@/domain/ride/types";
import type { PositionFix } from "@/domain/ride-session/types";

const BASE: Coordinate = { lon: -75.44, lat: 40.14 };
const ONE_METER_LAT = 1 / 111_320;
const ONE_METER_LON = 1 / (111_320 * Math.cos((BASE.lat * Math.PI) / 180));

function metres(east: number, north: number): Coordinate {
  return {
    lon: BASE.lon + east * ONE_METER_LON,
    lat: BASE.lat + north * ONE_METER_LAT,
  };
}

function fix(
  east: number,
  north: number,
  seconds: number,
  headingDegrees: number | null = 90,
): PositionFix {
  return {
    coordinate: metres(east, north),
    observedAt: new Date(Date.UTC(2026, 8, 21, 12, 0, seconds)).toISOString(),
    accuracyMeters: 8,
    headingDegrees,
    speedMps: 10,
  };
}

function match(
  route: ProgressRoute,
  position: PositionFix,
  previous?: ProgressFrame,
): ProgressFrame {
  return matchRouteProgress(buildProgressModel(route), position, previous);
}

describe("route progress continuity", () => {
  it("refuses malformed geometry instead of matching the fix to itself", () => {
    expect(() =>
      buildProgressModel({
        mode: "guided",
        geometry: [metres(0, 0), { lon: Number.NaN, lat: BASE.lat }],
      }),
    ).toThrow(InvalidProgressRouteError);
  });

  it("does not jump to the nearer later parallel road", () => {
    const route: ProgressRoute = {
      mode: "guided",
      geometry: [
        metres(0, 0),
        metres(1_000, 0),
        metres(1_000, 20),
        metres(0, 20),
        metres(0, 40),
        metres(1_000, 40),
      ],
      maneuvers: [],
    };
    const first = match(route, fix(200, 0, 0));
    const second = match(route, fix(220, 35, 1), first);

    expect(first.segmentIndex).toBe(0);
    expect(second.segmentIndex).toBe(0);
    expect(second.distanceAlongMeters).toBeLessThan(300);
  });

  it("uses heading and prior progress instead of jumping across a hairpin", () => {
    const route: ProgressRoute = {
      mode: "guided",
      geometry: [metres(0, 0), metres(1_000, 0), metres(1_000, 10), metres(0, 10)],
      maneuvers: [],
    };
    const first = match(route, fix(850, 0, 0));
    const second = match(route, fix(880, 8, 1, 90), first);

    expect(second.segmentIndex).toBe(0);
    expect(second.distanceAlongMeters).toBeGreaterThan(first.distanceAlongMeters);
    expect(second.distanceAlongMeters).toBeLessThan(1_000);
  });

  it("uses a displacement-derived heading when speed is unreported", () => {
    const route: ProgressRoute = {
      mode: "guided",
      geometry: [metres(0, 0), metres(1_000, 0), metres(1_000, 10), metres(0, 10)],
      maneuvers: [],
    };
    const first = match(route, { ...fix(850, 0, 0), speedMps: null });
    const second = match(
      route,
      { ...fix(880, 8, 1, 90), speedMps: null },
      first,
    );

    expect(second.segmentIndex).toBe(0);
  });
});

describe("off-route continuity", () => {
  it("requires sustained deviation, then reports rejoining before on-route", () => {
    const route: ProgressRoute = {
      mode: "guided",
      geometry: [metres(0, 0), metres(1_000, 0)],
      maneuvers: [],
    };
    const first = match(route, fix(100, 80, 0));
    const second = match(route, fix(110, 80, 1), first);
    const third = match(route, fix(120, 80, 2), second);
    const fourth = match(route, fix(130, 2, 3), third);
    const fifth = match(route, fix(140, 2, 4), fourth);

    expect([first.offRouteState, second.offRouteState, third.offRouteState]).toEqual([
      "uncertain",
      "uncertain",
      "off-route",
    ]);
    expect(fourth.offRouteState).toBe("rejoining");
    expect(fifth.offRouteState).toBe("on-route");
  });
});

describe("route guidance source", () => {
  it("uses routed maneuvers in guided mode and emits none for a track", () => {
    const maneuver = {
      instructionId: asSessionInstructionId("instr_route_1_0"),
      kind: "turn" as const,
      maneuver: "right" as const,
      roadName: "Ridge Road",
      targetStopId: null,
      atDistanceMeters: 500,
    };
    const geometry = [metres(0, 0), metres(1_000, 0)];
    const guided = match(
      { mode: "guided", geometry, maneuvers: [maneuver] },
      fix(100, 0, 0),
    );
    const track = match(
      { mode: "track", geometry, maneuvers: [maneuver] },
      fix(100, 0, 0),
    );

    expect(guided.nextManeuver?.instructionId).toBe(maneuver.instructionId);
    expect(guided.distanceToManeuverMeters).toBeGreaterThan(350);
    expect(track.nextManeuver).toBeNull();
    expect(track.distanceToManeuverMeters).toBeNull();
    expect(track.trackFollowing).toBe(true);
  });
});
