import { describe, expect, it } from "vitest";
import { countDeadEndSpurs, findDeadEndSpurs } from "@/domain/geometry/dead-end-spurs";

// East/north offsets in metres from a fixed point in Pennsylvania.
const p = (east: number, north = 0) => ({ lat: 40 + north / 111195, lon: -77 + east / (111195 * Math.cos(40 * Math.PI / 180)) });

describe("dead-end spurs", () => {
  it("finds a branch ridden out and back, with where it turns and how long it is", () => {
    // Ride east 1 km, out 600 m along a side road, turn round, back, then north.
    const spurs = findDeadEndSpurs([p(-1000), p(0), p(600), p(0), p(0, 1000)]);
    expect(spurs).toHaveLength(1);
    expect(spurs[0]!.turnaroundIndex).toBe(2);
    expect(spurs[0]!.oneWayMeters).toBeGreaterThan(550);
    expect(spurs[0]!.oneWayMeters).toBeLessThanOrEqual(650);
    expect(spurs[0]!.turnaroundMeters).toBeCloseTo(1600, -1);
    expect(spurs[0]!.turnaround.lon).toBeCloseTo(p(600).lon, 6);
  });

  it("counts several spurs on one ride, each once", () => {
    const line = [p(-1000), p(0), p(600), p(0), p(0, 1000), p(0, 1600), p(0, 1000), p(1000, 1000)];
    expect(countDeadEndSpurs(line)).toBe(2);
  });

  it("treats a branch of exactly 300 m or less as not a spur", () => {
    expect(countDeadEndSpurs([p(-1000), p(0), p(300), p(0), p(0, 1000)])).toBe(0);
    expect(countDeadEndSpurs([p(-1000), p(0), p(320), p(0), p(0, 1000)])).toBe(1);
  });

  it("does not count riding to the end of the line and stopping", () => {
    expect(countDeadEndSpurs([p(0), p(500), p(1000)])).toBe(0);
    expect(countDeadEndSpurs([p(0), p(0, 800), p(0, 1600)])).toBe(0);
  });

  it("does not count a loop, a parallel road or a hairpin", () => {
    expect(countDeadEndSpurs([p(0), p(500), p(500, 500), p(0, 500), p(0)])).toBe(0);
    // Out along one road and back on another 80 m away: a different road.
    expect(countDeadEndSpurs([p(0), p(500), p(500, 80), p(0, 80)])).toBe(0);
    // A hairpin that comes back close but diverges straight away.
    expect(countDeadEndSpurs([p(-1000), p(0), p(200), p(0, 40), p(-1000, 40)])).toBe(0);
  });

  it("copes with empty and tiny lines", () => {
    expect(findDeadEndSpurs([])).toEqual([]);
    expect(findDeadEndSpurs([p(0), p(500)])).toEqual([]);
  });

  it("honours a different threshold", () => {
    const line = [p(-1000), p(0), p(200), p(0), p(0, 1000)];
    expect(countDeadEndSpurs(line)).toBe(0);
    expect(countDeadEndSpurs(line, 100)).toBe(1);
  });
});
