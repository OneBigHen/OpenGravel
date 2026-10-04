import { describe, expect, it } from "vitest";
import { riderModeRules } from "@/infrastructure/routing/graphhopper/rider-modes";

describe("rider mode layers", () => {
  it("shapes protect-ride but preserves efficient", () => {
    expect(riderModeRules({ traffic: "protect-ride", roadCharacter: "balanced" }).some(r => r.if?.includes("CITY"))).toBe(true);
    expect(riderModeRules({ traffic: "protect-ride", roadCharacter: "efficient" })).toEqual([]);
  });
  it("rewards maintained gravel in proportion to the target", () => {
    const low = riderModeRules({ targetUnpavedShare: 0.2 });
    const high = riderModeRules({ targetUnpavedShare: 0.8 });
    expect(Number(high[0]?.multiply_by)).toBeLessThan(Number(low[0]?.multiply_by));
  });
  it("compensates rough tracks only for an explicitly capable dual-sport", () => {
    const bike = { category: "dual-sport" as const, roughTracks: "allow" as const, maintainedGravel: "allow" as const };
    expect(riderModeRules({ bike }).some(r => r.if?.includes("GRADE3") && r.if?.startsWith("!") && Number(r.multiply_by) < 1)).toBe(true);
    expect(riderModeRules({ bike: { ...bike, category: "street" } }).some(r => r.if?.includes("GRADE3") && r.multiply_by === "0")).toBe(true);
    expect(riderModeRules({ bike }).some(r => r.if?.includes("SAND") && r.multiply_by === "0")).toBe(true);
  });
  it("disables all mode layers with the kill switch", () => {
    expect(riderModeRules({ traffic: "protect-ride", surfacePreference: "dirt-preferred" }, false)).toEqual([]);
  });
});
