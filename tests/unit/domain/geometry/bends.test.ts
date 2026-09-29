import { describe, expect, it } from "vitest";

import { haversine } from "@/domain/geometry/analysis";
import { bendMeters } from "@/domain/geometry/bends";
import type { Coordinate } from "@/domain/ride/types";

const ORIGIN = { lon: -75.2, lat: 40.5 };
const METERS_PER_DEG_LAT = 111_320;
const METERS_PER_DEG_LON = METERS_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

/** A point `east`/`north` metres from the origin. */
const at = (east: number, north: number): Coordinate => ({
  lon: ORIGIN.lon + east / METERS_PER_DEG_LON,
  lat: ORIGIN.lat + north / METERS_PER_DEG_LAT,
});

const length = (line: readonly Coordinate[]): number =>
  line.slice(1).reduce((sum, point, index) => sum + haversine(line[index] as Coordinate, point), 0);

/** An arc of `radius` metres through `degrees`, one vertex every `step` metres. */
function arc(radius: number, degrees: number, step: number): Coordinate[] {
  const count = Math.max(2, Math.round((radius * (degrees * Math.PI) / 180) / step));
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = ((degrees * index) / count) * (Math.PI / 180);
    return at(radius * Math.sin(angle), radius - radius * Math.cos(angle));
  });
}

describe("bendMeters", () => {
  it("finds no bends on a straight road", () => {
    const line = Array.from({ length: 30 }, (_, index) => at(index * 60, 0));
    expect(bendMeters(line)).toBe(0);
  });

  it("counts a winding stretch drawn at the engine's ~60 m vertex spacing", () => {
    const line = arc(150, 180, 60);
    expect(bendMeters(line)).toBeGreaterThan(length(line) * 0.6);
  });

  it("ignores gentle sweepers a rider would not call a bend", () => {
    expect(bendMeters(arc(900, 40, 60))).toBe(0);
  });

  it("does not count a town junction corner as a bend", () => {
    const corner = [at(0, 0), at(60, 0), at(120, 0), at(120, 60), at(120, 120)];
    expect(bendMeters(corner)).toBe(0);
  });

  it("does not count a single kink", () => {
    const kink = [at(0, 0), at(60, 0), at(120, 12), at(180, 12), at(240, 12)];
    expect(bendMeters(kink)).toBe(0);
  });

  it("measures nothing on a line too short to turn", () => {
    expect(bendMeters([])).toBe(0);
    expect(bendMeters([at(0, 0), at(60, 0)])).toBe(0);
  });
});
