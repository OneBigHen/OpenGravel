/**
 * Route evidence from the engine's road attributes (M3, OGV-D-263).
 *
 * Pins what raw GraphHopper details mean: tagged surfaces are themselves, an
 * untagged numbered road is inferred paved (and says so), an untagged
 * unclassified road stays unknown, curvature is the share of bent metres, and
 * the card reads a mix instead of a band.
 */

import { describe, expect, it } from "vitest";

import type { ProviderRoadSummary } from "@/application/planner/route-provider";
import {
  backroadShare,
  curvatureLabel,
  engineCurvature,
  engineRoadEvidence,
  engineSurfaceMix,
  surfaceFit,
  surfaceMixLabel,
  surfaceRuns,
} from "@/application/roads/engine-road-evidence";
import { aggregateRouteSurface } from "@/application/roads/surface-evidence";
import { summarizeRoadDetails } from "@/infrastructure/routing/graphhopper/road-details";

const MILE = 1609.344;

function summary(overrides: Partial<ProviderRoadSummary> = {}): ProviderRoadSummary {
  return {
    totalMeters: 20 * MILE,
    surfaceByRoadClassMeters: {
      "asphalt|secondary": 8 * MILE,
      "missing|tertiary": 8 * MILE,
      "gravel|unclassified": 2 * MILE,
      "missing|unclassified": 2 * MILE,
    },
    curvatureMeters: { "1.00": 14 * MILE, "0.95": 2 * MILE, "0.90": 3 * MILE, "0.80": 1 * MILE },
    tollMeters: 0,
    ...overrides,
  };
}

describe("summarizeRoadDetails", () => {
  // Three steps east along a parallel, ~85 m each at this latitude.
  const line = [
    { lon: -75.0, lat: 40.0 },
    { lon: -74.999, lat: 40.0 },
    { lon: -74.998, lat: 40.0 },
    { lon: -74.997, lat: 40.0 },
  ];

  it("credits each step's metres to the values in force there", () => {
    const result = summarizeRoadDetails(line, {
      surface: [[0, 2, "asphalt"], [2, 3, "gravel"]],
      road_class: [[0, 3, "tertiary"]],
      curvature: [[0, 1, 1], [1, 3, 0.85]],
      toll: [[0, 3, "no"]],
    });
    expect(result).not.toBeNull();
    const step = (result?.totalMeters ?? 0) / 3;
    expect(result?.surfaceByRoadClassMeters["asphalt|tertiary"]).toBeCloseTo(step * 2, 3);
    expect(result?.surfaceByRoadClassMeters["gravel|tertiary"]).toBeCloseTo(step, 3);
    expect(result?.curvatureMeters["0.85"]).toBeCloseTo(step * 2, 3);
    expect(result?.longestBendRunMeters).toBeGreaterThanOrEqual(0);
    expect(result?.bendRunCount).toBeGreaterThanOrEqual(0);
    // Consecutive steps on the same surface merge into one run, in travel order.
    expect(result?.surfaceRuns?.map(([, key]) => key)).toEqual(["asphalt|tertiary", "gravel|tertiary"]);
    expect(result?.surfaceRuns?.[0]?.[0]).toBeCloseTo(step * 2, 3);
    expect(result?.tollMeters).toBe(0);
  });

  it("keeps an undescribed step as missing, and no details as no summary", () => {
    const partial = summarizeRoadDetails(line, { surface: [[0, 1, "asphalt"]] });
    expect(Object.keys(partial?.surfaceByRoadClassMeters ?? {}).sort()).toEqual([
      "asphalt|missing",
      "missing|missing",
    ]);
    expect(summarizeRoadDetails(line, undefined)).toBeNull();
    expect(summarizeRoadDetails(line, { curvature: [[0, 3, 1]] })).toBeNull();
  });
});

describe("engine surface mix", () => {
  it("infers paved for an untagged numbered road, never for an unclassified one", () => {
    const mix = engineSurfaceMix(summary(), "mixed");
    expect(mix.pavedMeters / MILE).toBeCloseTo(16, 5);
    expect(mix.inferredPavedMeters / MILE).toBeCloseTo(8, 5);
    expect(mix.gravelMeters / MILE).toBeCloseTo(2, 5);
    expect(mix.unknownMeters / MILE).toBeCloseTo(2, 5);
    expect(mix.surface).toBe("paved");
  });

  it("fits the rider's preference: Mixed accepts pavement, Paved dislikes gravel", () => {
    expect(surfaceFit("mixed", 0)).toBe(1);
    expect(surfaceFit("pavement", 0)).toBe(1);
    expect(surfaceFit("pavement", 0.1)).toBeCloseTo(0.5, 5);
    expect(surfaceFit("mostly-pavement", 0.15)).toBe(1);
    expect(surfaceFit("dirt-preferred", 0)).toBe(0);
    expect(surfaceFit("dirt-preferred", 0.5)).toBe(1);
  });
});

describe("engine curvature and road class", () => {
  it("counts metres at or below the curvy ratio", () => {
    const curvature = engineCurvature(summary());
    expect(curvature.curvyMeters / MILE).toBeCloseTo(4, 5);
    expect(curvature.unit).toBeCloseTo(0.4, 5);
  });

  it("carries sustained bend diagnostics without changing the aggregate curvature unit", () => {
    const curvature = engineCurvature(
      summary({
        bendMeters: 8 * MILE,
        longestBendRunMeters: 5 * MILE,
        bendRunCount: 3,
      }),
    );
    expect(curvature.curvyMeters / MILE).toBeCloseTo(8, 5);
    expect(curvature.unit).toBe(1);
    expect(curvature.longestRunMeters! / MILE).toBeCloseTo(5, 5);
    expect(curvature.runCount).toBe(3);
    expect(curvature.continuityShare).toBeCloseTo(5 / 8, 5);
  });

  it("measures the backroad share off the arterial network", () => {
    const share = backroadShare(
      summary({ surfaceByRoadClassMeters: { "asphalt|primary": 5 * MILE, "asphalt|tertiary": 15 * MILE } }),
    );
    expect(share).toBeCloseTo(0.75, 5);
  });
});

describe("engineRoadEvidence", () => {
  it("writes estimated OSM evidence the scorer and the band both read", () => {
    const evidence = engineRoadEvidence(summary(), "mixed");
    const surface = evidence["surfaceMix"];
    expect(surface?.status).toBe("estimated");
    expect(surface?.coverage).toBeCloseTo(0.9, 5);
    expect(aggregateRouteSurface(surface).value).toBe("paved");
    expect(evidence["roadClassMix"]?.value).toBe(1);
    expect(evidence["curvature"]?.status).toBe("estimated");
  });

  it("writes nothing without a summary, so the unknown defaults stand", () => {
    expect(engineRoadEvidence(undefined, "mixed")).toEqual({});
  });
});

describe("card labels", () => {
  it("names the mix and the curves in rider words", () => {
    const evidence = engineRoadEvidence(summary(), "mixed");
    expect(surfaceMixLabel(evidence["surfaceMix"])).toBe("Mostly paved · 2 mi gravel");
    expect(curvatureLabel(evidence["curvature"])).toBe("4 mi of curves");

    const paved = engineRoadEvidence(
      summary({ surfaceByRoadClassMeters: { "asphalt|secondary": 20 * MILE } }),
      "mixed",
    );
    expect(surfaceMixLabel(paved["surfaceMix"])).toBe("Paved");
    expect(surfaceMixLabel(undefined)).toBeNull();
  });
});

describe("surface runs", () => {
  it("classifies runs along the line and reads them back as shares", () => {
    const mix = engineSurfaceMix(
      summary({
        surfaceRuns: [
          [8 * MILE, "asphalt|secondary"],
          [4 * MILE, "missing|tertiary"],
          [2 * MILE, "gravel|unclassified"],
          [10, "asphalt|unclassified"],
          [6 * MILE, "missing|unclassified"],
        ],
      }),
      "mixed",
    );
    // Tagged and inferred paving merge; the 10 m sliver folds into the gravel before it.
    expect(mix.runs?.map(([, kind]) => kind)).toEqual(["paved", "gravel", "unknown"]);
    const runs = surfaceRuns({ value: mix, status: "estimated", confidence: 0.8, provenance: [] });
    expect(runs?.[0]).toEqual({ kind: "paved", from: 0, to: expect.closeTo(0.6, 3) });
    expect(runs?.at(-1)?.to).toBeCloseTo(1, 6);
  });

  it("is absent for an answer without runs", () => {
    const mix = engineSurfaceMix(summary(), "mixed");
    expect(mix.runs).toBeUndefined();
    expect(surfaceRuns({ value: mix, status: "estimated", confidence: 0.8, provenance: [] })).toBeNull();
  });
});
