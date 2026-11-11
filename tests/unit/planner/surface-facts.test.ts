import { describe, expect, it } from "vitest";

import { surfaceFacts } from "@/application/planner/surface-facts";

const MI = 1609.344;

describe("surfaceFacts", () => {
  it("says how much is gravel and how many miles nobody knows", () => {
    const facts = surfaceFacts({ paved: 0.54, gravel: 0.41, dirt: 0, unknown: 0.05 }, 62 * MI);
    expect(facts.line).toBe("41% gravel · 3 mi unknown");
    expect(facts.unknownMiles).toBeCloseTo(3.1, 1);
  });

  it("never reports zero unknown when some of the ride is unknown", () => {
    expect(surfaceFacts({ paved: 0.999, gravel: 0, dirt: 0, unknown: 0.001 }, 20 * MI).line).toBe("no gravel found · <1 mi unknown");
    expect(surfaceFacts({ paved: 0.99, gravel: 0, dirt: 0, unknown: 0.01 }).line).toBe("no gravel found · 1% unknown");
  });

  it("calls a ride all paved only when nothing is unknown", () => {
    expect(surfaceFacts({ paved: 1, gravel: 0, dirt: 0, unknown: 0 }, 10 * MI).line).toBe("all paved");
  });

  it("reads dirt and gravel together", () => {
    expect(surfaceFacts({ paved: 0.5, gravel: 0.3, dirt: 0.2, unknown: 0 }, 10 * MI).line).toBe("50% dirt & gravel");
  });

  it("says surface unknown with no evidence, or when everything is unknown", () => {
    expect(surfaceFacts(undefined, 10 * MI).line).toBe("surface unknown");
    expect(surfaceFacts({ paved: 0, gravel: 0, dirt: 0, unknown: 1 }, 10 * MI).line).toBe("surface unknown");
  });

  it("normalizes shares that do not add to one", () => {
    expect(surfaceFacts({ paved: 1, gravel: 1, dirt: 0, unknown: 0 }, 10 * MI).unpavedShare).toBeCloseTo(0.5);
  });
});
