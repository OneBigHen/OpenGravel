import { describe, expect, it } from "vitest";

import {
  DEFAULT_FRONTIER_PREFERENCE_PROFILES,
  frontierDominates,
  frontierUtility,
  paretoFrontier,
  selectLowRegretRepresentatives,
  type FrontierCandidate,
  type FrontierQualityVector,
} from "@/application/planner/frontier-routing";

function vector(
  overrides: Partial<FrontierQualityVector> = {},
): FrontierQualityVector {
  return {
    timeEfficiency: null,
    curvature: null,
    flow: null,
    backroad: null,
    surfaceFit: null,
    gravelAffinity: null,
    trafficFlow: null,
    junctionFlow: null,
    novelty: null,
    ...overrides,
  };
}

function candidate(
  id: string,
  quality: Partial<FrontierQualityVector>,
): FrontierCandidate {
  return { id, quality: vector(quality) };
}

describe("frontier routing selection", () => {
  it("removes a route that is clearly dominated on enough known dimensions", () => {
    const strong = candidate("strong", {
      timeEfficiency: 0.9,
      curvature: 0.8,
      flow: 0.8,
    });
    const weak = candidate("weak", {
      timeEfficiency: 0.8,
      curvature: 0.7,
      flow: 0.7,
    });

    expect(frontierDominates(strong.quality, weak.quality)).toBe(true);
    expect(paretoFrontier([weak, strong]).map((item) => item.id)).toEqual([
      "strong",
    ]);
  });

  it("does not fabricate dominance when evidence is too sparse", () => {
    const measured = candidate("measured", {
      timeEfficiency: 0.9,
      curvature: 0.8,
      flow: 0.8,
    });
    const sparse = candidate("sparse", {
      timeEfficiency: 1,
    });

    expect(frontierDominates(measured.quality, sparse.quality)).toBe(false);
    expect(paretoFrontier([measured, sparse])).toHaveLength(2);
  });

  it("does not let a sparse route dominate a route with additional known evidence", () => {
    const sparse = candidate("sparse", {
      timeEfficiency: 1,
      curvature: 0.9,
      flow: 0.9,
    });
    const measured = candidate("measured", {
      timeEfficiency: 0.9,
      curvature: 0.8,
      flow: 0.8,
      trafficFlow: 0.95,
    });

    expect(frontierDominates(sparse.quality, measured.quality)).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "fails closed for invalid dominance thresholds (%s)",
    (minimumComparableDimensions) => {
      const strong = candidate("strong", {
        timeEfficiency: 0.9,
        curvature: 0.8,
        flow: 0.8,
      });
      const weak = candidate("weak", {
        timeEfficiency: 0.8,
        curvature: 0.7,
        flow: 0.7,
      });

      expect(
        frontierDominates(strong.quality, weak.quality, minimumComparableDimensions),
      ).toBe(false);
      expect(
        paretoFrontier([weak, strong], { minimumComparableDimensions }),
      ).toEqual([weak, strong]);
    },
  );

  it("keeps a valid positive integer dominance threshold configurable", () => {
    const strong = candidate("strong", {
      timeEfficiency: 0.9,
      curvature: 0.8,
    });
    const weak = candidate("weak", {
      timeEfficiency: 0.8,
      curvature: 0.7,
    });

    expect(frontierDominates(strong.quality, weak.quality, 2)).toBe(true);
    expect(paretoFrontier([weak, strong], { minimumComparableDimensions: 2 })).toEqual([strong]);
  });

  it("penalizes missing utility coverage instead of treating unknown as neutral", () => {
    const profile = {
      id: "test",
      weights: { timeEfficiency: 0.5, flow: 0.5 },
    } as const;

    expect(
      frontierUtility(
        candidate("partial", { timeEfficiency: 1 }),
        profile,
      ),
    ).toBeCloseTo(0.5, 6);
    expect(
      frontierUtility(
        candidate("complete", { timeEfficiency: 0.8, flow: 0.8 }),
        profile,
      ),
    ).toBeCloseTo(0.8, 6);
  });

  it.each([
    -0.01,
    1.01,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])("returns no utility for invalid coverage thresholds (%s)", (minimumCoverage) => {
    const profile = {
      id: "complete",
      weights: { timeEfficiency: 0.5, flow: 0.5 },
    } as const;

    expect(
      frontierUtility(
        candidate("complete", { timeEfficiency: 0.8, flow: 0.8 }),
        profile,
        minimumCoverage,
      ),
    ).toBeNull();
  });

  it("keeps valid zero and complete coverage thresholds configurable", () => {
    const profile = {
      id: "complete",
      weights: { timeEfficiency: 0.5, flow: 0.5 },
    } as const;
    const complete = candidate("complete", { timeEfficiency: 0.8, flow: 0.8 });

    expect(frontierUtility(complete, profile, 0)).toBeCloseTo(0.8, 6);
    expect(frontierUtility(complete, profile, 1)).toBeCloseTo(0.8, 6);
  });

  it("returns no representatives when a supplied dominance threshold is invalid", () => {
    const items = [
      candidate("a", { timeEfficiency: 0.95, curvature: 0.3, flow: 0.7 }),
      candidate("b", { timeEfficiency: 0.7, curvature: 0.95, flow: 0.75 }),
    ];

    expect(
      selectLowRegretRepresentatives(items, DEFAULT_FRONTIER_PREFERENCE_PROFILES, 2, {
        minimumComparableDimensions: 1.5,
      }),
    ).toEqual([]);
  });

  it("returns no representatives when a supplied coverage threshold is invalid", () => {
    const items = [
      candidate("a", { timeEfficiency: 0.95, curvature: 0.3, flow: 0.7 }),
      candidate("b", { timeEfficiency: 0.7, curvature: 0.95, flow: 0.75 }),
    ];

    expect(
      selectLowRegretRepresentatives(items, DEFAULT_FRONTIER_PREFERENCE_PROFILES, 2, {
        minimumUtilityCoverage: Number.NaN,
      }),
    ).toEqual([]);
  });

  it("keeps efficient and twisty extremes in a two-route low-regret set", () => {
    const direct = candidate("direct", {
      timeEfficiency: 1,
      curvature: 0.25,
      flow: 0.65,
      backroad: 0.35,
      surfaceFit: 0.95,
      gravelAffinity: 0.05,
      trafficFlow: 0.85,
      junctionFlow: 0.85,
      novelty: 0.2,
    });
    const middle = candidate("middle", {
      timeEfficiency: 0.78,
      curvature: 0.7,
      flow: 0.78,
      backroad: 0.68,
      surfaceFit: 0.9,
      gravelAffinity: 0.15,
      trafficFlow: 0.78,
      junctionFlow: 0.76,
      novelty: 0.55,
    });
    const twisty = candidate("twisty", {
      timeEfficiency: 0.58,
      curvature: 1,
      flow: 0.72,
      backroad: 0.88,
      surfaceFit: 0.82,
      gravelAffinity: 0.2,
      trafficFlow: 0.72,
      junctionFlow: 0.7,
      novelty: 0.75,
    });

    const profiles = DEFAULT_FRONTIER_PREFERENCE_PROFILES.filter(
      (profile) => profile.id === "efficient" || profile.id === "twisty",
    );
    const selected = selectLowRegretRepresentatives(
      [middle, twisty, direct],
      profiles,
      2,
    );
    const reversed = selectLowRegretRepresentatives(
      [direct, twisty, middle],
      profiles,
      2,
    );

    expect(selected.map((item) => item.id).sort()).toEqual([
      "direct",
      "twisty",
    ]);
    expect(reversed.map((item) => item.id).sort()).toEqual([
      "direct",
      "twisty",
    ]);
  });

  it("is deterministic across candidate input order", () => {
    const items = [
      candidate("a", {
        timeEfficiency: 0.95,
        curvature: 0.3,
        flow: 0.7,
        backroad: 0.4,
      }),
      candidate("b", {
        timeEfficiency: 0.7,
        curvature: 0.95,
        flow: 0.75,
        backroad: 0.8,
      }),
      candidate("c", {
        timeEfficiency: 0.8,
        curvature: 0.7,
        flow: 0.9,
        backroad: 0.7,
      }),
    ];

    const forward = selectLowRegretRepresentatives(
      items,
      DEFAULT_FRONTIER_PREFERENCE_PROFILES,
      2,
      { minimumComparableDimensions: 2 },
    );
    const reverse = selectLowRegretRepresentatives(
      [...items].reverse(),
      DEFAULT_FRONTIER_PREFERENCE_PROFILES,
      2,
      { minimumComparableDimensions: 2 },
    );

    expect(forward.map((item) => item.id)).toEqual(
      reverse.map((item) => item.id),
    );
  });

  it("finds the exact three-route low-regret subset instead of a local exchange optimum", () => {
    const items = [
      candidate("a", {
        timeEfficiency: 0.17,
        curvature: 0.54,
        flow: 0.57,
        backroad: 0.49,
        surfaceFit: 0.68,
      }),
      candidate("b", {
        timeEfficiency: 0.12,
        curvature: 0.33,
        flow: 0.9,
        backroad: 0.6,
        surfaceFit: 0.73,
      }),
      candidate("c", {
        timeEfficiency: 0.59,
        curvature: 0.3,
        flow: 0.2,
        backroad: 0.97,
        surfaceFit: 0.96,
      }),
      candidate("d", {
        timeEfficiency: 0.7,
        curvature: 0.65,
        flow: 0.45,
        backroad: 0.41,
        surfaceFit: 0.85,
      }),
      candidate("e", {
        timeEfficiency: 0.26,
        curvature: 0.94,
        flow: 0.25,
        backroad: 0.15,
        surfaceFit: 0.74,
      }),
      candidate("f", {
        timeEfficiency: 0.32,
        curvature: 0.62,
        flow: 0.83,
        backroad: 0.87,
        surfaceFit: 0.34,
      }),
    ];
    const profiles = [
      { id: "time", weights: { timeEfficiency: 1 } },
      { id: "curves", weights: { curvature: 1 } },
      { id: "flow", weights: { flow: 1 } },
      { id: "backroad", weights: { backroad: 1 } },
      { id: "surface", weights: { surfaceFit: 1 } },
    ] as const;

    const selected = selectLowRegretRepresentatives(items, profiles, 3);

    expect(selected.map((item) => item.id)).toEqual(["b", "c", "e"]);
  });
});
