/**
 * "Surface ahead" on the ride (N2): the next change of surface from the runs the
 * engine measured, in metres along the route.
 *
 * The rules that matter to a rider at speed, asserted here:
 *
 * - an unmeasured stretch stays unknown and is never printed as paved;
 * - no runs, or one surface, produces no line at all;
 * - a sliver shorter than 150 m folds into its neighbour instead of flickering;
 * - a change the rider has already crossed is never printed as a negative or
 *   zero distance.
 */

import { describe, expect, it } from "vitest";

import {
  MIN_SURFACE_RUN_METERS,
  isSurfaceRunSpan,
  isSurfaceRunSpans,
  mergeSurfaceRuns,
  surfaceAhead,
  surfaceRunLengthMeters,
  type SurfaceRunSpan,
} from "@/application/ride-session/surface-ahead";

function run(from: number, to: number, kind: SurfaceRunSpan["kind"]): SurfaceRunSpan {
  return { from, to, kind };
}

describe("surfaceAhead", () => {
  it("names the next change and the distance to it", () => {
    const runs = [run(0, 2_000, "paved"), run(2_000, 4_000, "gravel")];

    expect(surfaceAhead(runs, 1_360)).toEqual({
      kind: "gravel",
      inMeters: 640,
      forMeters: 2_000,
    });
  });

  it("never turns an unmeasured stretch into pavement", () => {
    const runs = [run(0, 1_000, "paved"), run(1_000, 3_000, "unknown")];

    const ahead = surfaceAhead(runs, 0);
    expect(ahead?.kind).toBe("unknown");
    // The whole line unknown has no measured surface to announce either.
    expect(surfaceAhead([run(0, 3_000, "unknown")], 0)).toBeNull();
  });

  it("gives no line when there is no data, or only one surface", () => {
    expect(surfaceAhead(undefined, 250)).toBeNull();
    expect(surfaceAhead(null, 250)).toBeNull();
    expect(surfaceAhead([], 250)).toBeNull();
    // One surface the whole way is a fact, but not a *change*.
    expect(surfaceAhead([run(0, 5_000, "gravel")], 0)).toBeNull();
    // Two touching runs of the same surface are still one surface.
    expect(surfaceAhead([run(0, 2_000, "gravel"), run(2_000, 3_000, "gravel")], 0)).toBeNull();
  });

  it("folds a short run into the neighbour before it", () => {
    const runs = [
      run(0, 1_000, "paved"),
      run(1_000, 1_100, "unknown"),
      run(1_100, 3_000, "gravel"),
    ];

    expect(mergeSurfaceRuns(runs)).toEqual([
      run(0, 1_100, "paved"),
      run(1_100, 3_000, "gravel"),
    ]);
    // The 100 m unknown sliver does not make the line flicker to "unknown".
    expect(surfaceAhead(runs, 0)).toEqual({
      kind: "gravel",
      inMeters: 1_100,
      forMeters: 1_900,
    });
  });

  it("folds a short opening run into the run after it", () => {
    const runs = [run(0, 100, "paved"), run(100, 2_000, "gravel")];

    expect(mergeSurfaceRuns(runs)).toEqual([run(0, 2_000, "gravel")]);
    expect(surfaceAhead(runs, 0)).toBeNull();
  });

  it("keeps a run that is exactly the minimum length", () => {
    const runs = [run(0, 1_000, "paved"), run(1_000, 1_000 + MIN_SURFACE_RUN_METERS, "dirt")];

    expect(surfaceAhead(runs, 0)?.kind).toBe("dirt");
  });

  it("never reports a change the rider has already passed", () => {
    const runs = [
      run(0, 1_000, "gravel"),
      run(1_000, 2_000, "paved"),
      run(2_000, 3_000, "dirt"),
    ];

    // Standing at the boundary means the change has happened: the next one is
    // the dirt, a full kilometre on — never "paved in 0 m".
    expect(surfaceAhead(runs, 1_000)).toEqual({ kind: "dirt", inMeters: 1_000, forMeters: 1_000 });
    expect(surfaceAhead(runs, 1_500)).toEqual({ kind: "dirt", inMeters: 500, forMeters: 1_000 });
    // Past the last change there is nothing left to announce.
    expect(surfaceAhead(runs, 2_000)).toBeNull();
    expect(surfaceAhead(runs, 3_500)).toBeNull();
  });

  it("measures from the start of the route and clamps a negative place", () => {
    const runs = [run(0, 1_000, "gravel"), run(1_000, 2_000, "paved")];

    expect(surfaceAhead(runs, 0)?.inMeters).toBe(1_000);
    expect(surfaceAhead(runs, -500)?.inMeters).toBe(1_000);
  });

  it("answers unknown for a distance that is not a number", () => {
    const runs = [run(0, 1_000, "gravel"), run(1_000, 2_000, "paved")];

    expect(surfaceAhead(runs, Number.NaN)).toBeNull();
    expect(surfaceAhead(runs, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("reports nothing but non-negative distances across a whole ride", () => {
    const runs = [
      run(0, 900, "paved"),
      run(900, 4_000, "gravel"),
      run(4_000, 6_500, "unknown"),
      run(6_500, 9_000, "dirt"),
    ];
    for (let at = 0; at <= 9_000; at += 50) {
      const ahead = surfaceAhead(runs, at);
      if (ahead === null) continue;
      expect(ahead.inMeters, `at ${at} m`).toBeGreaterThanOrEqual(0);
      expect(ahead.forMeters, `at ${at} m`).toBeGreaterThan(0);
      expect(ahead.inMeters + at, `at ${at} m`).toBeLessThanOrEqual(9_000);
    }
  });

  it("measures the runs' own length, so progress maps onto the same line", () => {
    expect(surfaceRunLengthMeters([run(0, 1_200, "paved"), run(1_200, 3_000, "gravel")])).toBe(3_000);
    expect(surfaceRunLengthMeters([])).toBe(0);
  });
});

describe("run validation", () => {
  it("accepts the four measured surfaces and rejects anything else", () => {
    expect(isSurfaceRunSpan(run(0, 100, "gravel"))).toBe(true);
    expect(isSurfaceRunSpan({ from: 0, to: 100, kind: "asphalt" })).toBe(false);
    expect(isSurfaceRunSpan({ from: 100, to: 100, kind: "paved" })).toBe(false);
    expect(isSurfaceRunSpan({ from: -1, to: 100, kind: "paved" })).toBe(false);
    expect(isSurfaceRunSpan({ from: 0, to: Number.NaN, kind: "paved" })).toBe(false);
    expect(isSurfaceRunSpan(null)).toBe(false);
  });

  it("treats an empty list as no answer, not as a valid empty measurement", () => {
    expect(isSurfaceRunSpans([])).toBe(false);
    expect(isSurfaceRunSpans([run(0, 100, "paved")])).toBe(true);
    expect(isSurfaceRunSpans([run(0, 100, "paved"), { from: 100, to: 50, kind: "gravel" }])).toBe(false);
  });
});
