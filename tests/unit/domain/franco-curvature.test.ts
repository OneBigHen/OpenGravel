import { describe, expect, it } from "vitest";

import {
  analyzeFrancoCurvature,
  FRANCO_GREAT_CURVATURE,
  FRANCO_WORTHWHILE_CURVATURE,
} from "@/domain/geometry/franco-curvature";
import type { Coordinate } from "@/domain/ride/types";

function circle(radiusMeters: number, count = 13): Coordinate[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (Math.PI / 2) * index / (count - 1);
    return {
      lon: -75 + (Math.cos(angle) * radiusMeters) / (111_320 * Math.cos((40 * Math.PI) / 180)),
      lat: 40 + (Math.sin(angle) * radiusMeters) / 110_540,
    };
  });
}

describe("Franco curvature v1", () => {
  it("weights a sustained tight curve and reports continuity", () => {
    const analysis = analyzeFrancoCurvature(circle(45));
    expect(analysis.totalCurvature).toBeGreaterThan(0);
    expect(analysis.bendMeters).toBeGreaterThan(analysis.longestRunMeters * 0.8);
    expect(analysis.bendShare).toBeGreaterThan(0.8);
    expect(analysis.curvaturePerKm).toBeGreaterThan(0);
    expect(analysis.version).toBe("franco-v1");
  });

  it("keeps the documented worthwhile and great thresholds available", () => {
    expect(FRANCO_WORTHWHILE_CURVATURE).toBe(300);
    expect(FRANCO_GREAT_CURVATURE).toBe(1_000);
    const analysis = analyzeFrancoCurvature(circle(20));
    expect(analysis.sections.every((section) => section.quality === "below-threshold" || section.totalCurvature >= FRANCO_WORTHWHILE_CURVATURE)).toBe(true);
  });

  it("does not call a long straight a curve", () => {
    const line = Array.from({ length: 20 }, (_, index) => ({ lon: -75 + index * 0.002, lat: 40 }));
    const analysis = analyzeFrancoCurvature(line);
    expect(analysis.totalCurvature).toBe(0);
    expect(analysis.bendMeters).toBe(0);
    expect(analysis.sections).toEqual([]);
  });

  it("squashes curvature near a control point", () => {
    const line = circle(45);
    const control = line[Math.floor(line.length / 2)] as Coordinate;
    const analysis = analyzeFrancoCurvature(line, { controlPoints: [control] });
    expect(analysis.suppressedVertexIndices).toEqual([]);
    expect(analysis.bendMeters).toBeLessThan(analyzeFrancoCurvature(line).bendMeters);
  });

  it("honors source-suppressed vertices", () => {
    const line = circle(45);
    const analysis = analyzeFrancoCurvature(line, { suppressedVertexIndices: [6, 7] });
    expect(analysis.suppressedVertexIndices).toEqual([6, 7]);
    expect(analysis.bendMeters).toBeLessThan(analyzeFrancoCurvature(line).bendMeters);
  });
});
