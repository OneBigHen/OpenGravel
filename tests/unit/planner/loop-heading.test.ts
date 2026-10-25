/**
 * "Which way?" for a loop (04 §3).
 *
 * A heading is a preference on the answer, so the math has to be exact at the
 * seams a compass has: 0/360 is one direction, not two, and a loop asked for
 * north must accept a line that heads a little west of north. These pin the
 * bearing, the wrap-around, and the ranking that keeps the preference from ever
 * turning a legal loop into "no route".
 */

import { describe, expect, it } from "vitest";

import { intersectPreferred } from "@/application/planner/pipeline";
import {
  bearingDegrees,
  bearingOffsetDegrees,
  LOOP_HEADING_MAX_OFFSET_DEGREES,
  loopCentroid,
  loopHeadingDegrees,
  loopHeadingOffsetDegrees,
  loopHeadingPreferredIndexes,
  loopMatchesHeading,
} from "@/application/planner/loop-heading";
import type { Coordinate } from "@/domain/ride/types";

const START: Coordinate = { lon: -75.7387, lat: 40.8636 };

/** A point roughly `kilometers` away from the start on `bearing`. */
function pointAt(bearing: number, kilometers: number): Coordinate {
  const radians = (bearing * Math.PI) / 180;
  const north = Math.cos(radians) * kilometers;
  const east = Math.sin(radians) * kilometers;
  const lat = START.lat + north / 111.32;
  const lon = START.lon + east / (111.32 * Math.cos((START.lat * Math.PI) / 180));
  return { lon, lat };
}

/** A square loop around a centre offset from the start on `bearing`. */
function loopAround(bearing: number, kilometers: number): readonly Coordinate[] {
  const centre = pointAt(bearing, kilometers);
  const side = 0.03;
  return [
    START,
    { lon: centre.lon - side, lat: centre.lat - side },
    { lon: centre.lon + side, lat: centre.lat - side },
    { lon: centre.lon + side, lat: centre.lat + side },
    { lon: centre.lon - side, lat: centre.lat + side },
    START,
  ];
}

describe("loop heading choices", () => {
  it("maps the compass words to bearings and leaves Any to the engine", () => {
    expect(loopHeadingDegrees("any")).toBeNull();
    expect(loopHeadingDegrees(undefined)).toBeNull();
    expect(loopHeadingDegrees("north")).toBe(0);
    expect(loopHeadingDegrees("east")).toBe(90);
    expect(loopHeadingDegrees("south")).toBe(180);
    expect(loopHeadingDegrees("west")).toBe(270);
  });
});

describe("bearings", () => {
  it("reads the four cardinal directions from a start", () => {
    expect(bearingDegrees(START, pointAt(0, 5))).toBeCloseTo(0, 1);
    expect(bearingDegrees(START, pointAt(90, 5))).toBeCloseTo(90, 1);
    expect(bearingDegrees(START, pointAt(180, 5))).toBeCloseTo(180, 1);
    expect(bearingDegrees(START, pointAt(270, 5))).toBeCloseTo(270, 1);
  });

  it("is within 360 degrees for every direction", () => {
    for (const heading of [0.5, 45, 180, 270, 359.5]) {
      const bearing = bearingDegrees(START, pointAt(heading, 3));
      expect(bearing).toBeGreaterThanOrEqual(0);
      expect(bearing).toBeLessThan(360);
    }
  });

  it("wraps the offset across north in both directions", () => {
    // Both are 20° away from north, though the raw subtraction says 340° the
    // other way; the wrap is what a magnetic-compass preference needs.
    expect(bearingOffsetDegrees(350, 10)).toBeCloseTo(20, 6);
    expect(bearingOffsetDegrees(10, 350)).toBeCloseTo(20, 6);
    expect(bearingOffsetDegrees(359, 0)).toBeCloseTo(1, 6);
    expect(bearingOffsetDegrees(0, 359)).toBeCloseTo(1, 6);
    // A bearing outside [0, 360) is normalized rather than trusted.
    expect(bearingOffsetDegrees(370, 10)).toBeCloseTo(0, 6);
    expect(bearingOffsetDegrees(-10, 350)).toBeCloseTo(0, 6);
  });

  it("never reports more than a half turn", () => {
    expect(bearingOffsetDegrees(0, 180)).toBe(180);
    expect(bearingOffsetDegrees(90, 270)).toBe(180);
    expect(bearingOffsetDegrees(180, 180)).toBe(0);
  });
});

describe("a returned loop against the asked-for heading", () => {
  it("reads the loop's centre, not its first vertex", () => {
    const centroid = loopCentroid(loopAround(0, 8));
    expect(centroid).not.toBeNull();
    expect(centroid!.lat).toBeGreaterThan(START.lat);
  });

  it("accepts a loop that heads the asked-for way and rejects the opposite one", () => {
    const north = loopAround(0, 8);
    const south = loopAround(180, 8);

    expect(loopMatchesHeading(north, START, 0)).toBe(true);
    expect(loopMatchesHeading(south, START, 0)).toBe(false);
    expect(loopMatchesHeading(south, START, 180)).toBe(true);
    expect(loopHeadingOffsetDegrees(north, START, 0)).toBeLessThan(30);
    expect(loopHeadingOffsetDegrees(south, START, 0)).toBeGreaterThan(
      LOOP_HEADING_MAX_OFFSET_DEGREES,
    );
  });

  it("accepts a loop just inside a quarter turn and rejects one just outside", () => {
    const almostEast = loopAround(89, 8);
    const northEast = loopAround(45, 8);
    const north = loopAround(0, 8);

    expect(loopMatchesHeading(almostEast, START, 0)).toBe(true);
    expect(loopMatchesHeading(northEast, START, 0)).toBe(true);
    // 90° itself still counts: the bound is "more than a quarter turn off".
    expect(loopHeadingOffsetDegrees(almostEast, START, 0)).toBeGreaterThan(80);
    expect(loopHeadingOffsetDegrees(almostEast, START, 0)).toBeLessThanOrEqual(90);
    // Due north is allowed for both edges of the wrap.
    expect(loopMatchesHeading(north, START, 10)).toBe(true);
    expect(loopMatchesHeading(north, START, 350)).toBe(true);
  });

  it("does not invent a heading for a loop it cannot measure", () => {
    expect(loopCentroid([])).toBeNull();
    expect(loopHeadingOffsetDegrees([], START, 0)).toBeNull();
    // A line that never leaves the start has no centre to read.
    expect(loopHeadingOffsetDegrees([START, START], START, 0)).toBeNull();
    expect(loopMatchesHeading([START], START, 0)).toBe(true);
  });
});

describe("ranking a plan by its heading", () => {
  const candidate = (geometry: readonly Coordinate[]) => ({ geometry });

  it("prefers the loops heading the asked-for way", () => {
    const preferred = loopHeadingPreferredIndexes(
      [candidate(loopAround(180, 8)), candidate(loopAround(0, 8))],
      { origin: START, headingDegrees: 0 },
    );
    expect(preferred).toEqual(new Set([1]));
  });

  it("falls back to the closest loops when none head that way", () => {
    const preferred = loopHeadingPreferredIndexes(
      [candidate(loopAround(180, 8)), candidate(loopAround(135, 8))],
      { origin: START, headingDegrees: 0 },
    );
    // Nothing is within a quarter turn of north: the least-wrong loop is kept,
    // so the preference never becomes an empty plan.
    expect(preferred).toEqual(new Set([1]));
  });

  it("leaves ordinary planning alone for Any", () => {
    expect(
      loopHeadingPreferredIndexes([candidate(loopAround(0, 8))], undefined),
    ).toBeNull();
  });

  it("keeps the ride time first when the two preferences disagree", () => {
    expect(intersectPreferred(new Set([0]), new Set([1]))).toEqual(new Set([1]));
    expect(intersectPreferred(new Set([0, 1]), new Set([1]))).toEqual(new Set([1]));
    expect(intersectPreferred(null, new Set([1]))).toEqual(new Set([1]));
    expect(intersectPreferred(new Set([0]), null)).toEqual(new Set([0]));
    expect(intersectPreferred(null, null)).toBeNull();
  });
});
