import { describe, expect, it } from "vitest";
import { LONG_TRAIL_METERS, lineMeters, trailSection } from "@/application/hikes/trail-section";

const east = (fromLon: number, n: number, lat = 40) => Array.from({ length: n }, (_, i) => ({ lon: fromLon + i * 0.01, lat }));

describe("trail section", () => {
  it("opens a short single trail whole", () => {
    const line = east(-75, 10);
    expect(trailSection([line], { lon: -75, lat: 40 })).toEqual({ line, whole: true, pieces: 1 });
  });

  it("opens the piece nearest the hiker when the trail is mapped in pieces, without joining them", () => {
    const west = east(-76, 5), near = east(-75, 5);
    const section = trailSection([west, near], { lon: -74.99, lat: 40 })!;
    expect(section.line).toEqual(near);
    expect(section.whole).toBe(false);
    expect(section.pieces).toBe(2);
  });

  it("opens about 10 mi of a long trail around the nearest point, using its own vertices", () => {
    const long = east(-77, 300); // ~255 km
    expect(lineMeters(long)).toBeGreaterThan(LONG_TRAIL_METERS);
    const section = trailSection([long], { lon: -75.5, lat: 40.01 })!;
    expect(section.whole).toBe(false);
    expect(lineMeters(section.line)).toBeGreaterThan(14_000);
    expect(lineMeters(section.line)).toBeLessThan(19_000);
    for (const vertex of section.line) expect(long).toContainEqual(vertex);
    expect(section.line.some((v) => Math.abs(v.lon - -75.5) < 0.006)).toBe(true);
  });
});
