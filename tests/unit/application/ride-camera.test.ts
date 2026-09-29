/**
 * The heading-up ride camera (DV-10): bearing, zoom and tilt rules, without a
 * renderer.
 */

import { describe, expect, it } from "vitest";

import {
  RIDE_CAMERA_PITCH,
  bearingBetween,
  nearestOnLine,
  rideCameraFor,
  routeBearingAt,
  zoomForSpeed,
} from "@/application/map/ride-camera";

/** A straight line heading due east along 40.13° N, about 850 m per 0.01°. */
const EAST = [
  { lon: -75.45, lat: 40.13 },
  { lon: -75.44, lat: 40.13 },
  { lon: -75.43, lat: 40.13 },
];

describe("ride camera (DV-10)", () => {
  it("reads bearings clockwise from north", () => {
    expect(bearingBetween({ lon: 0, lat: 0 }, { lon: 0, lat: 1 })).toBeCloseTo(0, 5);
    expect(bearingBetween({ lon: 0, lat: 0 }, { lon: 1, lat: 0 })).toBeCloseTo(90, 5);
    expect(bearingBetween({ lon: 0, lat: 0 }, { lon: -1, lat: 0 })).toBeCloseTo(270, 5);
  });

  it("finds the nearest point on the line and how far off it the rider is", () => {
    const nearest = nearestOnLine(EAST, { lon: -75.445, lat: 40.131 });
    expect(nearest?.index).toBe(0);
    expect(nearest?.point.lat).toBeCloseTo(40.13, 6);
    expect(nearest?.meters).toBeGreaterThan(100);
    expect(nearest?.meters).toBeLessThan(120);
  });

  it("turns the route ahead up the screen when the rider is on it", () => {
    expect(routeBearingAt(EAST, { lon: -75.445, lat: 40.1301 })).toBeCloseTo(90, 0);
    // Far off the line, its direction says nothing about the rider.
    expect(routeBearingAt(EAST, { lon: -75.445, lat: 40.2 })).toBeNull();
  });

  it("prefers the GPS course while moving, and keeps the last bearing when stopped off-route", () => {
    const moving = rideCameraFor({
      position: { lon: -75.445, lat: 40.13 },
      headingDegrees: 120,
      speedMps: 15,
      routeLine: EAST,
      maneuverMeters: null,
      previousBearing: null,
    });
    expect(moving.bearing).toBe(120);

    const stoppedOnRoute = rideCameraFor({
      position: { lon: -75.445, lat: 40.13 },
      headingDegrees: 300,
      speedMps: 0.4,
      routeLine: EAST,
      maneuverMeters: null,
      previousBearing: 10,
    });
    expect(stoppedOnRoute.bearing).toBeCloseTo(90, 0);

    const stoppedAway = rideCameraFor({
      position: { lon: -75.445, lat: 40.2 },
      headingDegrees: 300,
      speedMps: null,
      routeLine: EAST,
      maneuverMeters: null,
      previousBearing: 10,
    });
    expect(stoppedAway.bearing).toBe(10);
    expect(stoppedAway.pitch).toBe(RIDE_CAMERA_PITCH);
  });

  it("sees further at speed and zooms in for a close turn", () => {
    expect(zoomForSpeed(5)).toBeGreaterThan(zoomForSpeed(30));
    const openRoad = rideCameraFor({
      position: { lon: -75.445, lat: 40.13 },
      headingDegrees: 90,
      speedMps: 27,
      routeLine: EAST,
      maneuverMeters: 2_000,
      previousBearing: null,
    });
    const turning = rideCameraFor({
      position: { lon: -75.445, lat: 40.13 },
      headingDegrees: 90,
      speedMps: 27,
      routeLine: EAST,
      maneuverMeters: 150,
      previousBearing: null,
    });
    expect(turning.zoom).toBeGreaterThan(openRoad.zoom);
  });
});
