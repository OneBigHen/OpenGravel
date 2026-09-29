import { describe, expect, it } from "vitest";

import { curvinessLevel, engineCurvature, surfaceShares } from "@/application/roads/engine-road-evidence";

const evidence = (value: unknown) => ({ value }) as never;

describe("curvinessLevel", () => {
  it("steps from straight to twisty the way riders describe the reference roads", () => {
    const share = (percent: number) => curvinessLevel(evidence({ curvyMeters: percent * 100, totalMeters: 10_000 }));
    expect(share(1.9)).toBe(1); // I-76
    expect(share(4.8)).toBe(2); // suburban arterials
    expect(share(9.3)).toBe(3); // Hawk Mountain climb
    expect(share(13.2)).toBe(4); // River Road, PA-611 through the Water Gap
    expect(share(19)).toBe(5); // Old Mine Road
  });

  it("claims nothing when curvature was not measured", () => {
    expect(curvinessLevel(undefined)).toBeNull();
    expect(curvinessLevel(evidence({ curvyMeters: 10 }))).toBeNull();
    expect(curvinessLevel(evidence({ curvyMeters: 10, totalMeters: 0 }))).toBeNull();
  });
});

describe("surfaceShares", () => {
  it("splits the measured line into shares that sum to one", () => {
    const shares = surfaceShares(evidence({ pavedMeters: 6, gravelMeters: 2, dirtMeters: 1, unknownMeters: 1 }));
    expect(shares).toEqual({ paved: 0.6, gravel: 0.2, dirt: 0.1, unknown: 0.1 });
  });

  it("claims nothing for an empty or foreign mix", () => {
    expect(surfaceShares(evidence({ pavedMeters: 0, gravelMeters: 0, dirtMeters: 0, unknownMeters: 0 }))).toBeNull();
    expect(surfaceShares(evidence({ band: "paved" }))).toBeNull();
  });
});

describe("engineCurvature", () => {
  const summary = {
    totalMeters: 10_000,
    surfaceByRoadClassMeters: {},
    curvatureMeters: { "1.00": 9_800, "0.85": 200 },
    tollMeters: 0,
  };

  it("measures bends on the line, not the engine's per-edge ratio", () => {
    // The engine read this winding road as 98% straight edges.
    const measured = engineCurvature({ ...summary, bendMeters: 1_900 });
    expect(measured).toEqual({ curvyMeters: 1_900, totalMeters: 10_000, unit: 0.95 });
  });

  it("falls back to the edge ratios for an engine without the line measure", () => {
    expect(engineCurvature(summary)).toMatchObject({ curvyMeters: 200, totalMeters: 10_000 });
  });
});
