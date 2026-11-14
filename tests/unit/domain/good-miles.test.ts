import { describe, expect, it } from "vitest";
import { haversine } from "@/domain/geometry/analysis";
import { analyzeGeometryFun } from "@/domain/geometry/heading-fun";
import { dirtMeters, goodMeters, lineGeometryFun, type GoodMilesLine } from "@/domain/route/good-miles";
import type { Coordinate } from "@/domain/ride/types";

const xy = (x: number, y: number): Coordinate => ({ lon: -75 + x / (111_320 * Math.cos(40 * Math.PI / 180)), lat: 40 + y / 111_195 });
const length = (line: readonly Coordinate[]) => line.slice(1).reduce((sum, p, i) => sum + haversine(line[i]!, p), 0);
// Six 120 degree arcs, 30 m radius, alternating direction: a real twisty road.
const switchbacks = (() => {
  const points: Coordinate[] = [xy(0, 0)];
  let x = 0, y = 0, heading = 0;
  for (let leg = 0; leg < 6; leg++) {
    const direction = leg % 2 === 0 ? 1 : -1;
    for (let i = 0; i < 31; i++) { heading += direction * 2 / 30; x += Math.cos(heading) * 2; y += Math.sin(heading) * 2; points.push(xy(x, y)); }
    for (let i = 0; i < 5; i++) { x += Math.cos(heading) * 2; y += Math.sin(heading) * 2; points.push(xy(x, y)); }
  }
  return points;
})();
const straight = Array.from({ length: 101 }, (_, i) => xy(i * 10, 0));

function line(geometry: readonly Coordinate[], runs: { surface: string; share: number }[], roadClass = "secondary"): GoodMilesLine {
  const meters = length(geometry);
  return {
    geometry, distanceMeters: meters, instructions: [],
    roadSummary: { totalMeters: meters, roadRuns: runs.map(run => ({ meters: meters * run.share, surface: run.surface, roadClass, urbanDensity: "rural" })) },
  };
}

describe("good miles: one scorer", () => {
  it("counts dirt metres on dirt surfaces only; sand, grass and pavement earn nothing", () => {
    expect(dirtMeters([{ meters: 400, surface: "gravel" }, { meters: 100, surface: "SAND" }, { meters: 50, surface: "grass" }, { meters: 300, surface: "compacted" }, { meters: 900, surface: "asphalt" }])).toBe(700);
    const mixed = line(straight, [{ surface: "gravel", share: 0.25 }, { surface: "asphalt", share: 0.75 }]);
    expect(goodMeters(mixed, "dirt")).toBeCloseTo(mixed.distanceMeters * 0.25, 6);
  });

  it("counts curvy good metres as the road-bends measure, and a straight road as none", () => {
    const twisty = line(switchbacks, [{ surface: "asphalt", share: 1 }]);
    const bends = analyzeGeometryFun(twisty.geometry, twisty.roadSummary!.roadRuns!)!.bendMeters;
    expect(bends).toBeGreaterThan(0);
    expect(goodMeters(twisty, "curvy")).toBe(Math.min(twisty.distanceMeters, bends));
    expect(goodMeters(line(straight, [{ surface: "asphalt", share: 1 }]), "curvy")).toBe(0);
  });

  it("credits nothing it cannot show: no road runs means no dirt and no bends", () => {
    const bare: GoodMilesLine = { geometry: switchbacks, distanceMeters: length(switchbacks) };
    expect(lineGeometryFun(bare)).toBeNull();
    expect(goodMeters(bare, "curvy")).toBe(0);
    expect(goodMeters(bare, "dirt")).toBe(0);
  });

  it("never credits more good metres than the line is long", () => {
    const allDirt = line(straight, [{ surface: "gravel", share: 1.5 }]);
    expect(goodMeters(allDirt, "dirt")).toBe(Math.max(allDirt.distanceMeters, allDirt.roadSummary!.totalMeters));
  });
});
