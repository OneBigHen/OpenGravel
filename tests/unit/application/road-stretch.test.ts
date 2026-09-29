import { describe, expect, it } from "vitest";

import { roadStretchAt } from "@/application/planner/road-stretch";
import type { RouteInstruction } from "@/domain/route/types";
import type { Coordinate } from "@/domain/ride/types";

/** NV-14: one tap names the road under it, across every interval it spans. */
const LINE: Coordinate[] = Array.from({ length: 101 }, (_, index) => ({ lon: -75.5 + index * 0.001, lat: 40.6 }));

function step(geometryIndex: number, roadName?: string): RouteInstruction {
  return { text: "Continue", distanceMeters: 100, durationSeconds: 10, type: "continue", geometryIndex, ...(roadName === undefined ? {} : { roadName }) };
}

const STEPS = [step(0, "Main St"), step(20, "PA 309"), step(45, "pa 309"), step(70, "Mill Rd"), step(95)];

describe("roadStretchAt", () => {
  it("selects the whole named road under the tap, joining its intervals", () => {
    const stretch = roadStretchAt("r1", LINE, STEPS, LINE[50] as Coordinate);
    expect(stretch).toEqual({ draft: { routeId: "r1", startIndex: 20, endIndex: 70 }, roadName: "PA 309" });
  });

  it("runs the last interval to the end of the line", () => {
    const stretch = roadStretchAt("r1", LINE, [step(0, "Main St"), step(80, "Mill Rd")], LINE[90] as Coordinate);
    expect(stretch?.draft).toEqual({ routeId: "r1", startIndex: 80, endIndex: 100 });
  });

  it("falls back to a short window around an unnamed tap", () => {
    const stretch = roadStretchAt("r1", LINE, STEPS, LINE[98] as Coordinate);
    expect(stretch?.roadName).toBeNull();
    // ~84 m per vertex at this latitude: about 5 vertices each side, clipped at the end.
    expect(stretch?.draft.startIndex).toBeLessThan(98);
    expect(stretch?.draft.endIndex).toBe(100);
    expect(roadStretchAt("r1", LINE, undefined, LINE[50] as Coordinate)?.roadName).toBeNull();
  });

  it("refuses a line too short to hold a span", () => {
    expect(roadStretchAt("r1", [LINE[0] as Coordinate], STEPS, LINE[0] as Coordinate)).toBeNull();
  });
});
