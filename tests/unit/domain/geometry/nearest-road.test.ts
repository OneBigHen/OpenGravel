import { describe, expect, it } from "vitest";

import { compassDirection, nearestRoad, type RoadLine } from "@/domain/geometry/nearest-road";
import type { Coordinate } from "@/domain/ride/types";

const METRES_PER_DEGREE_LAT = 111_320;
const ORIGIN: Coordinate = { lat: 40.5, lon: -75.2 };
const METRES_PER_DEGREE_LON = METRES_PER_DEGREE_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

/** A point `east`/`north` metres from the origin. */
const at = (east: number, north: number): Coordinate => ({
  lon: ORIGIN.lon + east / METRES_PER_DEGREE_LON,
  lat: ORIGIN.lat + north / METRES_PER_DEGREE_LAT,
});

/** A straight east–west road `north` metres up, one kilometre long. */
function road(name: string, north: number, id = name): RoadLine {
  return { id, name, line: [at(-500, north), at(500, north)] };
}

describe("compassDirection", () => {
  it("names the eight points, wrapping at north", () => {
    expect(compassDirection(0)).toBe("north");
    expect(compassDirection(22.4)).toBe("north");
    expect(compassDirection(22.5)).toBe("northeast");
    expect(compassDirection(90)).toBe("east");
    expect(compassDirection(180)).toBe("south");
    expect(compassDirection(270)).toBe("west");
    expect(compassDirection(337.5)).toBe("north");
    expect(compassDirection(359)).toBe("north");
    expect(compassDirection(-45)).toBe("northwest");
    expect(compassDirection(405)).toBe("northeast");
  });
});

describe("nearestRoad", () => {
  it("measures across the segment, not to a vertex", () => {
    const road: RoadLine = { id: "r", name: "Ridge Road", line: [at(-500, 100), at(500, 100)] };
    const nearest = nearestRoad(ORIGIN, [road]);
    expect(nearest?.name).toBe("Ridge Road");
    expect(nearest?.meters).toBeCloseTo(100, 0);
    expect(nearest?.bearingDegrees).toBeCloseTo(0, 0);
    expect(nearest?.direction).toBe("north");
    // The closest point is mid-segment, not either end.
    expect(nearest?.access.lat).toBeCloseTo(road.line[0]?.lat ?? Number.NaN, 6);
    expect(nearest?.access.lon).toBeCloseTo(ORIGIN.lon, 5);
  });

  it("reports the direction from the rider to the road", () => {
    expect(nearestRoad(ORIGIN, [road("south", -200)])?.direction).toBe("south");
    expect(nearestRoad(ORIGIN, [{ id: "e", name: "east", line: [at(200, -500), at(200, 500)] }])?.direction).toBe("east");
    expect(nearestRoad(ORIGIN, [{ id: "w", name: "west", line: [at(-200, -500), at(-200, 500)] }])?.direction).toBe("west");
    const diagonal = nearestRoad(ORIGIN, [{ id: "ne", name: "ne", line: [at(200, 200), at(300, 300)] }]);
    expect(diagonal?.direction).toBe("northeast");
  });

  it("picks the closest road and keeps the source's order on a tie", () => {
    const roads: RoadLine[] = [road("far", 400), road("near", 200), road("also near", 200)];
    expect(nearestRoad(ORIGIN, roads)?.name).toBe("near");
    const reversed = [...roads].reverse();
    expect(nearestRoad(ORIGIN, reversed)?.name).toBe("also near");
  });

  it("clamps to a segment end when the point is past the road's end", () => {
    const short: RoadLine = { id: "s", name: "Spur", line: [at(0, 100), at(100, 100)] };
    const nearest = nearestRoad(at(-200, 0), [short]);
    expect(nearest?.meters).toBeCloseTo(Math.hypot(200, 100), -1);
    expect(nearest?.direction).toBe("northeast");
  });

  it("keeps an unnamed road as an unnamed result rather than inventing a name", () => {
    expect(nearestRoad(ORIGIN, [road("", 100)])?.name).toBe("");
  });

  it("says unknown when there is no usable road line", () => {
    expect(nearestRoad(ORIGIN, [])).toBeNull();
    expect(nearestRoad(ORIGIN, [{ id: "one", name: "One point", line: [at(0, 10)] }])).toBeNull();
    expect(
      nearestRoad(ORIGIN, [{ id: "bad", name: "Bad", line: [at(0, 10), { lat: Number.NaN, lon: 0 }] }]),
    ).toBeNull();
  });

  it("refuses a malformed position instead of measuring from nowhere", () => {
    expect(nearestRoad({ lat: Number.NaN, lon: 0 }, [road("north", 100)])).toBeNull();
  });
});
