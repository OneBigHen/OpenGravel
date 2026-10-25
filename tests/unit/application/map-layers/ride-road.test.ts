import { describe, expect, it } from "vitest";

import {
  ROAD_VIA_INSET_FRACTION,
  haversineMeters,
  rideRoadViaPoints,
  type LngLat,
} from "@/application/map-layers";

/** A straight west→east road of about 11 km at the latitude used below. */
const WEST_TO_EAST: readonly LngLat[] = [
  [0, 0],
  [0.05, 0],
  [0.1, 0],
];

describe("rideRoadViaPoints", () => {
  it("enters at the end nearest the rider when they come from the west", () => {
    const via = rideRoadViaPoints(WEST_TO_EAST, [-0.05, 0]);
    expect(via).not.toBeNull();
    const [entry, exit] = via!;
    expect(entry[0]).toBeCloseTo(ROAD_VIA_INSET_FRACTION * 0.1, 6);
    expect(exit[0]).toBeCloseTo(0.1 - ROAD_VIA_INSET_FRACTION * 0.1, 6);
    expect(haversineMeters(entry, [-0.05, 0])).toBeLessThan(haversineMeters(exit, [-0.05, 0]));
  });

  it("turns the same line around when the rider comes from the east", () => {
    const via = rideRoadViaPoints(WEST_TO_EAST, [0.15, 0]);
    expect(via).not.toBeNull();
    const [entry, exit] = via!;
    expect(entry[0]).toBeCloseTo(0.1 - ROAD_VIA_INSET_FRACTION * 0.1, 6);
    expect(exit[0]).toBeCloseTo(ROAD_VIA_INSET_FRACTION * 0.1, 6);
    expect(haversineMeters(entry, [0.15, 0])).toBeLessThan(haversineMeters(exit, [0.15, 0]));
  });

  it("keeps the drawn order when the rider's position is unknown", () => {
    const via = rideRoadViaPoints(WEST_TO_EAST, null);
    expect(via).not.toBeNull();
    expect(via![0][0]).toBeCloseTo(ROAD_VIA_INSET_FRACTION * 0.1, 6);
    expect(via![1][0]).toBeCloseTo(0.1 - ROAD_VIA_INSET_FRACTION * 0.1, 6);
  });

  it("pulls both via points inside a two-point line, by length", () => {
    const line: readonly LngLat[] = [
      [0, 0],
      [0.1, 0],
    ];
    const via = rideRoadViaPoints(line, [-0.2, 0]);
    expect(via).not.toBeNull();
    const [entry, exit] = via!;
    expect(entry[0]).toBeCloseTo(0.005, 6);
    expect(entry[1]).toBe(0);
    expect(exit[0]).toBeCloseTo(0.095, 6);
    expect(exit[1]).toBe(0);
    // Never the endpoints themselves: routing would snap to the side street
    // that meets the road there.
    expect(entry).not.toEqual(line[0]);
    expect(exit).not.toEqual(line[1]);
  });

  it("measures the inset along the line's real length, not by vertex index", () => {
    // The first segment is short, so 5% along the line falls inside the long one.
    const line: readonly LngLat[] = [
      [0, 0],
      [0.001, 0],
      [0.1, 0],
    ];
    const via = rideRoadViaPoints(line, null);
    expect(via).not.toBeNull();
    expect(via![0][0]).toBeCloseTo(0.005, 6);
    expect(via![1][0]).toBeCloseTo(0.095, 6);
  });

  it("offers nothing for a degenerate line", () => {
    expect(rideRoadViaPoints([[0.1, 0.2]], null)).toBeNull();
    expect(rideRoadViaPoints([[0.1, 0.2], [0.1, 0.2]], [0, 0])).toBeNull();
    expect(rideRoadViaPoints([], null)).toBeNull();
  });
});
