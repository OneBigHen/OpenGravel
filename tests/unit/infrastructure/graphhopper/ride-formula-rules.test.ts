import { expect, it } from "vitest";
import { rideFormulaRules } from "@/infrastructure/routing/graphhopper/ride-formula-rules";
import { riderModeRules } from "@/infrastructure/routing/graphhopper/rider-modes";

it("expresses curve and small-road preference as LM-safe complement penalties", () => {
  const rules = rideFormulaRules({ roadCharacter: "curvy" }, true);
  expect(rules.some(rule => rule.if === "curvature >= 0.98" && Number(rule.multiply_by) < 1)).toBe(true);
  expect(rules.every(rule => Number(rule.multiply_by) <= 1)).toBe(true);
  expect(rideFormulaRules({ roadCharacter: "efficient" }, true)).toEqual([]);
  expect(rideFormulaRules({ roadCharacter: "curvy" }, false)).toEqual([]);
});

it("dirt requests penalise paved arterials and keep eligible grade3–4 in the preferred set", () => {
  const gravel = riderModeRules({ surfacePreference: "dirt-preferred", targetUnpavedShare: 0.4 });
  expect(gravel.some(rule => rule.if?.includes("PRIMARY") && Number(rule.multiply_by) < 1)).toBe(true);
  const dual = riderModeRules({ surfacePreference: "dirt-preferred", bike: { category: "dual-sport", maintainedGravel: "allow", roughTracks: "allow" } });
  expect(dual[0]?.if).toContain("GRADE4");
  expect(dual.every(rule => Number(rule.multiply_by) <= 1)).toBe(true);
});

it("dirt and dual-sport requests penalise straight pavement and urban streets, never reward", () => {
  for (const options of [{ surfacePreference: "dirt-preferred" as const }, { bike: { category: "dual-sport" as const, maintainedGravel: "allow" as const, roughTracks: "allow" as const } }]) {
    const rules = rideFormulaRules(options, true);
    expect(rules.some(rule => rule.if?.startsWith("curvature >= 0.98 && !("))).toBe(true);
    expect(rules.some(rule => rule.if?.includes("urban_density != RURAL"))).toBe(true);
    expect(rules.every(rule => Number(rule.multiply_by) <= 1)).toBe(true);
  }
});
