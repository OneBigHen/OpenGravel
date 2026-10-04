import { describe, expect, it } from "vitest";

import {
  CONTINUOUS_BEND_RUN_METERS,
  geometryFunJudgeExtensions,
  scheduleFunJudgeShadow,
  type SelectFunJudgeInput,
} from "@/application/planner/fun-judge-selection";
import { analyzeBends } from "@/domain/geometry/bends";
import type { PipelineCandidate } from "@/application/planner/pipeline";
import type { Coordinate } from "@/domain/ride/types";

function candidate(geometry: readonly Coordinate[], distanceMeters = 5_000): PipelineCandidate {
  return { geometry, distanceMeters } as unknown as PipelineCandidate;
}

/** A gentle S-curve: ~120 m radius arcs, no junction corners. */
function sCurve(): Coordinate[] {
  const points: Coordinate[] = [];
  const r = 120 / 111_195;
  for (let i = 0; i <= 40; i++) {
    const t = (i / 40) * Math.PI;
    const side = i < 20 ? 1 : -1;
    points.push({ lon: -75.5 + (i / 40) * 0.01, lat: 40.5 + side * r * Math.sin(t) });
  }
  return points;
}

describe("geometryFunJudgeExtensions", () => {
  it("is unknown for a line too short to measure", () => {
    expect(geometryFunJudgeExtensions(candidate([{ lon: -75, lat: 40 }, { lon: -75.01, lat: 40 }]))).toEqual({ curvatureContinuity: null });
  });

  it("reads a straight line as zero continuity, not unknown", () => {
    const line = [0, 1, 2, 3, 4].map((i) => ({ lon: -75 + i * 0.01, lat: 40 }));
    expect(geometryFunJudgeExtensions(candidate(line)).curvatureContinuity).toBe(0);
  });

  it("scales the longest sustained bend run to 0..1", () => {
    const line = sCurve();
    const expected = Math.min(1, analyzeBends(line).longestRunMeters / CONTINUOUS_BEND_RUN_METERS);
    const value = geometryFunJudgeExtensions(candidate(line)).curvatureContinuity;
    expect(value).toBeCloseTo(expected, 6);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });

  it("schedules shadow selection after the response path returns", async () => {
    const completed: unknown[] = [];
    const input = {
      pipeline: { roles: {}, selectedIndex: null, candidates: [] },
      intent: {},
      avoidHighways: false,
      policy: {},
      judge: null,
      judgeOptions: { deadlineMs: 25, transportTimeoutMs: 25 },
    } as unknown as Omit<SelectFunJudgeInput, "mode" | "signal">;

    expect(scheduleFunJudgeShadow(input, (selection) => completed.push(selection))).toBeUndefined();
    expect(completed).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(completed).toHaveLength(1);
  });
});
