import { describe, expect, it } from "vitest";

import { classifyShape, SHAPE_LIMITS } from "@/domain/hike";
import type { Coordinate } from "@/domain/ride/types";

const SOUTH_WEST: Coordinate = { lon: -77, lat: 40 };

/** A ~1 km square walked north, east, south and west back to the start. */
const SQUARE: readonly Coordinate[] = [
  SOUTH_WEST,
  { lon: -77, lat: 40.009 },
  { lon: -77.012, lat: 40.009 },
  { lon: -77.012, lat: 40 },
  SOUTH_WEST,
];

/** North 1 km and back down the same line. */
const OUT_AND_BACK: readonly Coordinate[] = [SOUTH_WEST, { lon: -77, lat: 40.009 }, SOUTH_WEST];

/** North 1 km and back down a line about 20 m to the east (GPS offset). */
const OFFSET_RETURN: readonly Coordinate[] = [
  SOUTH_WEST,
  { lon: -77, lat: 40.009 },
  { lon: -76.99977, lat: 40.009 },
  { lon: -76.99977, lat: 40 },
];

/** North 1 km, then east 1 km, ending far from the start. */
const TRAVERSE: readonly Coordinate[] = [
  SOUTH_WEST,
  { lon: -77, lat: 40.009 },
  { lon: -76.988, lat: 40.009 },
];

describe("classifyShape", () => {
  it("calls a closed circuit a loop", () => {
    const classification = classifyShape(SQUARE);

    expect(classification.shape).toBe("loop");
    expect(classification.lengthMeters).toBeGreaterThan(3900);
    expect(classification.endpointDistanceMeters).toBe(0);
    expect(classification.endpointClosureRatio).toBe(0);
    // Only the few metres where the closing side meets the first one retrace.
    expect(classification.retracedShare).toBeLessThan(0.1);
    expect(classification.explanation).toContain("Loop");
  });

  it("separates an out-and-back from a loop by retracing, not by closure", () => {
    const classification = classifyShape(OUT_AND_BACK);

    expect(classification.endpointDistanceMeters).toBe(0);
    expect(classification.shape).toBe("out-and-back");
    // Slightly under half: the turnaround and the last 100 m of each leg are
    // excluded by the minimum separation and the sampling.
    expect(classification.retracedShare).toBeGreaterThan(0.45);
    expect(classification.retracedShare).toBeLessThan(0.5);
    expect(classification.explanation).toContain("Out and back");
  });

  it("still sees an out-and-back when the return leg is a GPS offset", () => {
    const classification = classifyShape(OFFSET_RETURN);

    expect(classification.endpointDistanceMeters).toBeCloseTo(19.6, 0);
    expect(classification.shape).toBe("out-and-back");
    expect(classification.retracedShare).toBeGreaterThan(0.4);
  });

  it("calls a one-way line point-to-point", () => {
    const classification = classifyShape(TRAVERSE);

    expect(classification.shape).toBe("point-to-point");
    expect(classification.endpointDistanceMeters).toBeGreaterThan(1300);
    expect(classification.endpointClosureRatio).toBeGreaterThan(0.5);
    expect(classification.retracedShare).toBeLessThan(0.1);
    expect(classification.explanation).toContain("Point to point");
  });

  it("does not guess a shape from a line too short to tell", () => {
    const short: Coordinate[] = [{ lon: -77, lat: 40 }, { lon: -77, lat: 40.0009 }];
    const classification = classifyShape(short);

    expect(classification.lengthMeters).toBeLessThan(SHAPE_LIMITS.minClassifiableLengthMeters);
    expect(classification.shape).toBe("unknown");
    expect(classification.explanation).toContain("too short");
  });

  it("does not guess a shape from a line with no length", () => {
    const classification = classifyShape([SOUTH_WEST]);

    expect(classification.lengthMeters).toBe(0);
    expect(classification.shape).toBe("unknown");
    expect(classification.explanation).toContain("no measurable length");
  });

  it("reports a malformed line as unknown instead of a fabricated shape", () => {
    const classification = classifyShape([
      { lon: -77, lat: Number.NaN },
      { lon: -77, lat: 40 },
    ]);

    expect(Number.isFinite(classification.lengthMeters)).toBe(false);
    expect(classification.shape).toBe("unknown");
    expect(classification.explanation).toContain("no measurable length");
  });

  it("handles an empty line", () => {
    const classification = classifyShape([]);

    expect(classification.shape).toBe("unknown");
    expect(classification.lengthMeters).toBe(0);
    expect(classification.endpointClosureRatio).toBe(0);
    expect(classification.retracedShare).toBe(0);
  });

  it("reports the evidence behind the call", () => {
    const classification = classifyShape(SQUARE);
    expect(classification.retracedShare).toBeGreaterThanOrEqual(0);
    expect(classification.retracedShare).toBeLessThanOrEqual(1);
    expect(classification.explanation).toContain("the ends are");
    expect(classification.explanation).toContain("retraces an earlier stretch");
  });
});
