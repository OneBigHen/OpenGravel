import { describe, expect, it } from "vitest";
import { analyzeGeometryFun } from "@/domain/geometry/heading-fun";
import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

const xy = (x: number, y: number): Coordinate => ({ lon: -75 + x / (111_320 * Math.cos(40 * Math.PI / 180)), lat: 40 + y / 111_195 });
// A flowing 1 km radius ridge, with no Franco (<175 m) credit.
const ridge = Array.from({ length: 301 }, (_, i) => xy(1000 * Math.sin(i / 100), 1000 * (1 - Math.cos(i / 100))));
const straight = Array.from({ length: 301 }, (_, i) => xy(i * 10, 0));
const saw = Array.from({ length: 301 }, (_, i) => xy(i * 10, i % 2 * 10));
const length = (line: readonly Coordinate[]) => line.slice(1).reduce((sum, p, i) => sum + haversine(line[i]!, p), 0);
const runs = (line: readonly Coordinate[], roadClass = "secondary") => [{ meters: length(line), roadClass, urbanDensity: "rural" }];

describe("selection geometry fun", () => {
  it("credits sweeping ridge roads even without tight Franco curves", () => {
    const fun = analyzeGeometryFun(ridge, runs(ridge))!;
    expect(fun.headingDegreesPerKm).toBeGreaterThan(45);
    expect(fun.headingDegreesPerKm).toBeLessThan(65);
    expect(fun.francoPerKm).toBe(0);
    expect(fun.bendMeters).toBeGreaterThan(2500);
    expect(fun.funScore).toBeGreaterThan(1);
  });
  it("penalizes a dull straight highway", () => {
    const fun = analyzeGeometryFun(straight, runs(straight, "motorway"))!;
    expect(fun.headingDegreesPerKm).toBeLessThan(0.001);
    expect(fun.funScore).toBeLessThan(0);
    expect(fun.dullMeters).toBeGreaterThan(2900);
  });
  it("never buys residential or service zig-zags", () => {
    for (const roadClass of ["residential", "service", "living_street"]) {
      const fun = analyzeGeometryFun(saw, runs(saw, roadClass))!;
      expect(fun.bendMeters).toBe(0);
      expect(fun.francoPerKm).toBe(0);
      expect(fun.funScore).toBeLessThanOrEqual(0);
    }
  });
  it("rejects sawtooth farming on a rural road too", () => {
    const fun = analyzeGeometryFun(saw, runs(saw))!;
    expect(fun.bendMeters).toBeLessThan(length(saw) * 0.1);
    expect(fun.funScore).toBeLessThan(0.1);
  });
  it("suppresses a junction corner and its tight-curve credit", () => {
    const line = [...Array.from({ length: 101 }, (_, i) => xy(i * 10, 0)), ...Array.from({ length: 100 }, (_, i) => xy(1000, (i + 1) * 10))];
    expect(analyzeGeometryFun(line, runs(line), [100])!.headingDegreesPerKm).toBeLessThan(0.001);
    expect(analyzeGeometryFun(line, runs(line), [100])!.francoPerKm).toBe(0);
  });
  it("weights only the known non-residential length and is direction invariant", () => {
    const half = [{ meters: length(ridge) / 2, roadClass: "secondary", urbanDensity: "rural" }, { meters: length(ridge) / 2, roadClass: "residential", urbanDensity: "residential" }];
    const fun = analyzeGeometryFun(ridge, half)!;
    const reverse = analyzeGeometryFun([...ridge].reverse(), [...half].reverse())!;
    expect(fun.bendMeters).toBeCloseTo(length(ridge) / 2, -1);
    expect(fun.funScore).toBeCloseTo(reverse.funScore, 3);
    expect(fun.headingDegreesPerKm).toBeCloseTo(reverse.headingDegreesPerKm, 3);
  });
  it("keeps missing or incomplete road facts unknown", () => {
    expect(analyzeGeometryFun(ridge, [])).toBeNull();
    expect(analyzeGeometryFun(ridge, [{ ...runs(ridge)[0]!, meters: 10 }])).toBeNull();
  });
});
