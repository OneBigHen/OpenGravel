import { describe, expect, it } from "vitest";
import { MAX_DIRT_STRENGTH, riderModeRules } from "@/infrastructure/routing/graphhopper/rider-modes";

describe("rider mode strength", () => {
  const options = { targetUnpavedShare: 0.5, surfacePreference: "dirt-preferred", traffic: "protect-ride", roadCharacter: "balanced" } as const;
  it("lets dirt pressure go past 4 but stops busy-road penalties at 4", () => {
    const at = (factor: number) => riderModeRules({ ...options, riderModeFactor: factor });
    const pavement = (factor: number) => Number(at(factor)[0]!.multiply_by);
    const primary = (factor: number) => Number(at(factor).find(rule => rule.if === "road_class == PRIMARY")!.multiply_by);
    expect(pavement(5)).toBeCloseTo(1 / (1 + 1.5 * MAX_DIRT_STRENGTH), 3);
    expect(pavement(5)).toBeLessThan(pavement(4));
    expect(pavement(9)).toBe(pavement(MAX_DIRT_STRENGTH));
    expect(primary(5)).toBe(primary(4));
  });
});
