import { describe, expect, it } from "vitest";

import {
  dominates,
  paretoFrontier,
  selectLowRegretRepresentatives,
  type FrontierCandidate,
  type FrontierVector,
} from "@/application/planner/frontier-selection";

function vector(overrides: Partial<FrontierVector> = {}): FrontierVector {
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

function candidate(id: string, overrides: Partial<FrontierVector>): FrontierCandidate<string> {
  return { id, vector: vector(overrides), value: id };
}

describe("frontier selection", () => {
  it("does not allow sparse evidence to dominate known evidence", () => {
    const sparse = vector({ curvature: 0.9 });
    const measured = vector({ curvature: 0.8, trafficFlow: 0.9 });

    expect(dominates(sparse, measured)).toBe(false);
  });

  it("removes a route that is no better on any known dimension", () => {
    const strong = candidate("strong", { curvature: 0.9, flow: 0.8, trafficFlow: 0.8 });
    const weak = candidate("weak", { curvature: 0.7, flow: 0.8, trafficFlow: 0.6 });
    const frontier = paretoFrontier([weak, strong]);

    expect(frontier.map((entry) => entry.id)).toEqual(["strong"]);
  });

  it("keeps legitimate trade-offs on the Pareto frontier", () => {
    const fast = candidate("fast", { timeEfficiency: 0.95, curvature: 0.5 });
    const twisty = candidate("twisty", { timeEfficiency: 0.7, curvature: 0.95 });

    expect(paretoFrontier([fast, twisty]).map((entry) => entry.id)).toEqual(["fast", "twisty"]);
  });

  it("selects a small set that covers opposing utility profiles", () => {
    const fast = candidate("fast", {
      timeEfficiency: 1,
      curvature: 0.35,
      flow: 0.6,
    });
    const flow = candidate("flow", {
      timeEfficiency: 0.78,
      curvature: 0.78,
      flow: 0.95,
    });
    const twisty = candidate("twisty", {
      timeEfficiency: 0.6,
      curvature: 1,
      flow: 0.55,
    });

    const selected = selectLowRegretRepresentatives(
      [fast, flow, twisty],
      [
        { id: "efficient", weights: { timeEfficiency: 1 } },
        { id: "flowing", weights: { flow: 0.7, curvature: 0.3 } },
        { id: "twisty", weights: { curvature: 1 } },
      ],
      { limit: 2, minimumUtilityCoverage: 1 },
    );

    expect(selected).toHaveLength(2);
    expect(selected.map((entry) => entry.id)).toContain("fast");
    expect(selected.map((entry) => entry.id)).toContain("twisty");
  });

  it("is deterministic when candidate regret ties", () => {
    const a = candidate("a", { curvature: 0.8 });
    const b = candidate("b", { curvature: 0.8 });

    const selected = selectLowRegretRepresentatives(
      [b, a],
      [{ id: "curvy", weights: { curvature: 1 } }],
      { limit: 1, minimumUtilityCoverage: 1 },
    );

    expect(selected.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("does not let an under-covered route win a utility profile", () => {
    const sparse = candidate("sparse", { curvature: 1 });
    const measured = candidate("measured", { curvature: 0.8, trafficFlow: 0.8 });

    const selected = selectLowRegretRepresentatives(
      [sparse, measured],
      [{ id: "ride", weights: { curvature: 0.5, trafficFlow: 0.5 } }],
      { limit: 1, minimumUtilityCoverage: 1 },
    );

    expect(selected.map((entry) => entry.id)).toEqual(["measured"]);
  });
});
