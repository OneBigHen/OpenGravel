import { describe, expect, it } from "vitest";

import {
  analyzeRouteCoherence,
} from "@/domain/route/coherence";
import type { Coordinate } from "@/domain/ride/types";
import type { RouteInstruction } from "@/domain/route/types";

function at(lon: number, lat: number): Coordinate {
  return { lon, lat };
}

function instruction(
  maneuver: RouteInstruction["maneuver"],
  distanceMeters: number,
  roadName?: string,
): RouteInstruction {
  return {
    text: maneuver ?? "continue",
    distanceMeters,
    durationSeconds: Math.max(1, distanceMeters / 15),
    type: maneuver ?? "continue",
    ...(maneuver === undefined ? {} : { maneuver }),
    ...(roadName === undefined ? {} : { roadName }),
  };
}

describe("route coherence", () => {
  it("keeps a smooth route quiet without instructions", () => {
    const result = analyzeRouteCoherence({
      geometry: [
        at(-75.5, 40),
        at(-75.45, 40.01),
        at(-75.4, 40.02),
        at(-75.35, 40.03),
      ],
    });

    expect(result).not.toBeNull();
    expect(result!.maneuverCount).toBe(0);
    expect(result!.explicitUTurnCount).toBe(0);
    expect(result!.alternatingShortTurnPairs).toBe(0);
    expect(result!.geometryReversalCount).toBe(0);
    expect(result!.flags).toEqual([]);
  });

  it("detects explicit u-turns and geometry reversals", () => {
    const result = analyzeRouteCoherence({
      geometry: [
        at(-75.5, 40),
        at(-75.49, 40),
        at(-75.5, 40),
        at(-75.51, 40),
      ],
      instructions: [
        instruction("right", 500, "Main Road"),
        instruction("uturn", 100, "Main Road"),
        instruction("left", 600, "Main Road"),
      ],
    });

    expect(result).not.toBeNull();
    expect(result!.explicitUTurnCount).toBe(1);
    expect(result!.geometryReversalCount).toBeGreaterThan(0);
    expect(result!.flags).toContain("explicit-uturn");
    expect(result!.flags).toContain("geometry-reversal");
  });

  it("detects alternating short-turn doglegs", () => {
    const result = analyzeRouteCoherence({
      geometry: [
        at(-75.5, 40),
        at(-75.45, 40),
        at(-75.4, 40),
      ],
      instructions: [
        instruction("right", 120, "Oak Street"),
        instruction("left", 180, "Pine Street"),
        instruction("right", 150, "Elm Street"),
        instruction("left", 2_000, "Ridge Road"),
      ],
    });

    expect(result).not.toBeNull();
    expect(result!.alternatingShortTurnPairs).toBe(3);
    expect(result!.shortManeuverLegCount).toBe(3);
    expect(result!.roadNameChangeCount).toBe(3);
    expect(result!.flags).toContain("alternating-short-turns");
  });

  it("detects maneuver spam on a route long enough for density to be meaningful", () => {
    const geometry = Array.from({ length: 11 }, (_, index) =>
      at(-75.5 + index * 0.01, 40),
    );
    const instructions = Array.from({ length: 20 }, (_, index) =>
      instruction(index % 2 === 0 ? "left" : "right", 500, `Road ${index}`),
    );

    const result = analyzeRouteCoherence({ geometry, instructions });

    expect(result).not.toBeNull();
    expect(result!.routeMeters).toBeGreaterThan(4_000);
    expect(result!.maneuversPer10Miles).toBeGreaterThan(14);
    expect(result!.flags).toContain("maneuver-spam");
  });

  it("does not treat long alternating turns as short doglegs", () => {
    const result = analyzeRouteCoherence({
      geometry: [
        at(-75.5, 40),
        at(-75.45, 40.01),
        at(-75.4, 40.02),
        at(-75.35, 40.03),
      ],
      instructions: [
        instruction("left", 2_500, "River Road"),
        instruction("right", 3_000, "Ridge Road"),
        instruction("left", 2_800, "Creek Road"),
      ],
    });

    expect(result).not.toBeNull();
    expect(result!.alternatingShortTurnPairs).toBe(0);
    expect(result!.flags).not.toContain("alternating-short-turns");
  });

  it("rejects malformed geometry instead of fabricating diagnostics", () => {
    expect(
      analyzeRouteCoherence({
        geometry: [
          at(Number.NaN, 40),
          at(-75.4, 40),
        ],
      }),
    ).toBeNull();
  });
});
