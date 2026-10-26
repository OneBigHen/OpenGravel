import { describe, expect, it } from "vitest";

import type { RouteCardMeasurements, RouteCardVm } from "@/application/planner/planner-view-model";
import { riderRouteOptions } from "@/application/planner/rider-route-options";
import { asRouteCandidateId } from "@/domain/route/ids";

function measured(overrides: Partial<RouteCardMeasurements> = {}): RouteCardMeasurements {
  return { curvyMi: null, unpavedMi: null, busyShare: null, ...overrides };
}
function card(id: string, overrides: Partial<RouteCardVm> = {}): RouteCardVm {
  return { routeId: asRouteCandidateId(id), roleKey: "alternative", roleLabel: "Alternative", durationLabel: "53 min", distanceLabel: "33 mi", addedTimeLabel: null,
    badges: [], unknownSurfaceMi: null, whyKey: id, isSelected: false, measurements: measured(), ...overrides };
}
const paved = { paved: 1, gravel: 0, dirt: 0, unknown: 0 };

describe("riderRouteOptions", () => {
  it("names measured fastest, twistiest and unpaved winners with short reasons", () => {
    const result = riderRouteOptions([
      card("fast", { addedMinutes: 0, measurements: measured({ curvyMi: 1, unpavedMi: 0 }) }),
      card("curves", { addedMinutes: 8, isSelected: true, measurements: measured({ curvyMi: 12, unpavedMi: 2 }) }),
      card("gravel", { addedMinutes: 15, measurements: measured({ curvyMi: 4, unpavedMi: 8 }) }),
    ]);
    expect(result.map(({ label }) => label)).toEqual(["Fastest", "Twistiest", "Most gravel"]);
    expect(result.map(({ reason }) => reason)).toEqual(["Shortest ride time", "12 mi of curves", "8 mi unpaved"]);
    expect(result[1]?.card.isSelected).toBe(true);
    for (const option of result) expect(option.reason.split(/\s+/).length).toBeLessThanOrEqual(6);
  });

  it("withholds comparative character labels for ties, missing or non-finite measurements", () => {
    for (const value of [8, null, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = riderRouteOptions([
        card("a", { roleKey: "more-twisties", roleLabel: "More Twisties", measurements: measured({ curvyMi: 8, unpavedMi: 8 }) }),
        card("b", { roleKey: "more-dirt", roleLabel: "More Dirt", measurements: measured({ curvyMi: value, unpavedMi: value }) }),
      ]);
      expect(result.map(({ label }) => label)).toEqual(["Ride option", "Ride option"]);
    }
  });

  it("does not award character comparisons to a lone or all-zero option set", () => {
    const only = card("only", { measurements: measured({ curvyMi: 12, unpavedMi: 8 }) });
    expect(riderRouteOptions([only])[0]?.label).toBe("Alternative");
    expect(riderRouteOptions([card("a", { measurements: measured({ curvyMi: 0, unpavedMi: 0 }) }), card("b", { measurements: measured({ curvyMi: 0, unpavedMi: 0 }) })]).map(({ label }) => label)).toEqual(["Alternative", "Alternative"]);
  });

  it("uses the planner's fastest role when time deltas are unavailable", () => {
    const result = riderRouteOptions([card("fast", { roleKey: "fastest", roleLabel: "Fastest" }), card("other")]);
    expect(result[0]?.label).toBe("Fastest");
    expect(result[0]?.reason).toBe("Shortest ride time");
  });

  it("does not infer fastest from tied or incomplete added times", () => {
    for (const addedMinutes of [0, null, undefined, Number.NaN]) {
      expect(riderRouteOptions([card("a", { addedMinutes: 0 }), card("b", { addedMinutes })]).some(({ label }) => label === "Fastest")).toBe(false);
    }
  });

  it("uses a fully measured paved surface and never converts unknown to paved", () => {
    const certain = card("paved", { surfaceStrip: paved, unknownSurfaceMi: 0, measurements: measured({ unpavedMi: 0 }) });
    expect(riderRouteOptions([certain])[0]).toMatchObject({ label: "Paved only", reason: "All surface measured paved" });
    for (const overrides of [
      { unknownSurfaceMi: null },
      { unknownSurfaceMi: 0.1 },
      { surfaceStrip: undefined },
      { surfaceStrip: { ...paved, paved: 0.9, unknown: 0.1 } },
      { surfaceStrip: { ...paved, dirt: 0.1 } },
      { measurements: measured() },
    ]) expect(riderRouteOptions([{ ...certain, ...overrides }])[0]?.label).not.toBe("Paved only");
  });

  it("keeps the selected recommendation when it starts after the first three", () => {
    const result = riderRouteOptions([card("a"), card("b"), card("c"), card("selected", { isSelected: true })]);
    expect(result).toHaveLength(3);
    expect(result.some(({ card }) => card.isSelected)).toBe(true);
  });

  it("uses winning candidates beyond the first three when room permits", () => {
    const result = riderRouteOptions([
      card("a", { addedMinutes: 3 }), card("b", { addedMinutes: 4 }), card("c", { addedMinutes: 5 }), card("fast", { addedMinutes: 0 }),
    ]);
    expect(result.some(({ card, label }) => card.routeId === "fast" && label === "Fastest")).toBe(true);
  });

  it("keeps one label per candidate when the same route wins several traits", () => {
    const result = riderRouteOptions([
      card("winner", { addedMinutes: 0, measurements: measured({ curvyMi: 12, unpavedMi: 8 }) }),
      card("other", { addedMinutes: 5, measurements: measured({ curvyMi: 2, unpavedMi: 1 }) }),
    ]);
    expect(result.map(({ label }) => label)).toEqual(["Fastest", "Alternative"]);
    expect(new Set(result.map(({ card }) => card.routeId)).size).toBe(result.length);
  });
});
