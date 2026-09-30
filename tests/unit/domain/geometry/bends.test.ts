import { describe, expect, it } from "vitest";

import { haversine } from "@/domain/geometry/analysis";
import { analyzeBends, bendMeters } from "@/domain/geometry/bends";
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

  it("retains bend continuity instead of only the aggregate metres", () => {
    const first = arc(150, 120, 60);
    const straightStart = first.at(-1) as Coordinate;
    const straight = Array.from({ length: 5 }, (_, index) =>
      at(
        (straightStart.lon - ORIGIN.lon) * METERS_PER_DEG_LON + (index + 1) * 100,
        (straightStart.lat - ORIGIN.lat) * METERS_PER_DEG_LAT,
      ),
    );
    const analysis = analyzeBends([...first, ...straight]);

    expect(analysis.bendMeters).toBeGreaterThan(0);
    expect(analysis.longestRunMeters).toBeGreaterThan(0);
    expect(analysis.longestRunMeters).toBeLessThanOrEqual(analysis.bendMeters);
    expect(analysis.runCount).toBe(1);
  });

  it("counts separated bend stretches as separate runs", () => {
    const first = arc(150, 120, 60);
    const shift = 2_000;
    const second = arc(150, 120, 60).map((point) =>
      at(
        (point.lon - ORIGIN.lon) * METERS_PER_DEG_LON + shift,
        (point.lat - ORIGIN.lat) * METERS_PER_DEG_LAT,
      ),
    );
    const between = [
      first.at(-1) as Coordinate,
      at(1_000, 1_000),
      at(1_500, 1_000),
      second[0] as Coordinate,
    ];
    const analysis = analyzeBends([...first, ...between.slice(1), ...second.slice(1)]);

    expect(analysis.runCount).toBeGreaterThanOrEqual(2);
    expect(analysis.bendMeters).toBeGreaterThan(analysis.longestRunMeters);
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
