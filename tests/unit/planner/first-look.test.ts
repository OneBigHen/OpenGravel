import { describe, expect, it } from "vitest";

import { firstLookSwapNote, type FirstLookFacts } from "@/application/planner/first-look";

const MILE = 1609.344;
const facts = (overrides: Partial<FirstLookFacts>): FirstLookFacts => ({
  routeId: "a",
  distanceMeters: 50 * MILE,
  unpavedMi: 3,
  curvyMi: 2,
  ...overrides,
});

describe("first look swap note", () => {
  it("names a dirt gain in percent", () => {
    expect(firstLookSwapNote(facts({}), facts({ routeId: "b", unpavedMi: 10.5 }))).toBe("Now 21% dirt, was 6%");
  });

  it("names a bend gain when dirt did not move", () => {
    expect(firstLookSwapNote(facts({}), facts({ routeId: "b", curvyMi: 4.2 }))).toBe("Now 4.2 mi of bends, was 2.0");
  });

  it("says nothing for the same route", () => {
    expect(firstLookSwapNote(facts({}), facts({ unpavedMi: 20 }))).toBeNull();
  });

  it("says nothing when nothing measured improved", () => {
    expect(firstLookSwapNote(facts({}), facts({ routeId: "b", unpavedMi: 3.5, curvyMi: 2.4 }))).toBeNull();
  });

  it("never invents a number from an unmeasured route", () => {
    expect(firstLookSwapNote(facts({ unpavedMi: null, curvyMi: null }), facts({ routeId: "b", unpavedMi: 20, curvyMi: 9 }))).toBeNull();
  });
});
