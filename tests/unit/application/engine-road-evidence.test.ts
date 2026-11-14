/**
 * Route evidence from the engine's road attributes (M3, OGV-D-263).
 *
 * Pins what raw GraphHopper details mean: tagged surfaces are themselves, an
 * untagged numbered road is inferred paved (and says so), an untagged
 * unclassified road stays unknown, curvature is the share of bent metres, and
 * the card reads a mix instead of a band.
 */

import { describe, expect, it } from "vitest";

import type { ProviderRoadRun, ProviderRoadSummary } from "@/application/planner/route-provider";
import {
  backroadShare,
  bikeFitFacts,
  busyRoadShare,
  curvatureLabel,
  engineBikeFit,
  engineBusyRoads,
  engineCurvature,
  engineRoadEvidence,
  engineRoadCharacter,
  engineSurfaceMix,
  engineUrbanFriction,
  engineUrbanFrictionEvidence,
  surfaceFit,
  surfaceMixLabel,
  surfaceRunSpans,
  surfaceRuns,
} from "@/application/roads/engine-road-evidence";
import { aggregateRouteSurface } from "@/application/roads/surface-evidence";
import type { EvidenceValue } from "@/domain/evidence/types";
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

  it("measures continuous road character rather than counting every non-arterial equally", () => {
    const share = backroadShare(
      summary({ surfaceByRoadClassMeters: { "asphalt|primary": 5 * MILE, "asphalt|tertiary": 15 * MILE } }),
    );
    expect(share).toBeCloseTo(0.7, 5);
  });
});

describe("engineRoadEvidence", () => {
  it("writes estimated OSM evidence the scorer and the band both read", () => {
    const evidence = engineRoadEvidence(summary(), "mixed");
    const surface = evidence["surfaceMix"];
    expect(surface?.status).toBe("estimated");
    expect(surface?.coverage).toBeCloseTo(0.9, 5);
    expect(aggregateRouteSurface(surface).value).toBe("paved");
    expect(evidence["roadClassMix"]?.value).toBe(0.76);
    expect(evidence["roadClassMix"]?.coverage).toBe(1);
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

  it("never calls a route paved when there is no paved metre at all", () => {
    // One 100 m gravel sliver on a 10 mi line: the rest is untagged.
    const sliver = engineRoadEvidence(
      summary({
        totalMeters: 100 + 9.94 * MILE,
        surfaceByRoadClassMeters: { "gravel|unclassified": 100, "missing|unclassified": 9.94 * MILE },
      }),
      "mixed",
    );

    const label = surfaceMixLabel(sliver["surfaceMix"]);
    expect(label).not.toBeNull();
    expect(label).not.toContain("Paved");
    expect(label).toBe("Surface mostly unknown");
  });

  it("discloses a mostly unknown surface instead of claiming paved", () => {
    const thin = engineRoadEvidence(
      summary({
        totalMeters: 10 * MILE,
        surfaceByRoadClassMeters: { "asphalt|secondary": MILE, "missing|unclassified": 9 * MILE },
      }),
      "mixed",
    );

    const label = surfaceMixLabel(thin["surfaceMix"]);
    expect(label).not.toBe("Paved");
    expect(label?.toLowerCase()).toContain("unknown");
  });

  it("keeps the mix claim but names an untagged remainder", () => {
    const partial = engineRoadEvidence(
      summary({
        totalMeters: 10 * MILE,
        surfaceByRoadClassMeters: {
          "asphalt|secondary": 6 * MILE,
          "gravel|unclassified": 2 * MILE,
          "missing|unclassified": 2 * MILE,
        },
      }),
      "mixed",
    );

    expect(surfaceMixLabel(partial["surfaceMix"])).toBe("Mixed · 2 mi unpaved · 2 mi unknown");
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

  it("also reads them in metres along the route, for the ride surface line", () => {
    const mix = engineSurfaceMix(
      summary({
        surfaceRuns: [
          [8 * MILE, "asphalt|secondary"],
          [4 * MILE, "gravel|unclassified"],
        ],
      }),
      "mixed",
    );
    expect(surfaceRunSpans({ value: mix, status: "estimated", confidence: 0.8, provenance: [] })).toEqual([
      { from: 0, to: mix.runs?.[0]?.[0], kind: "paved" },
      { from: mix.runs?.[0]?.[0], to: (mix.runs?.[0]?.[0] ?? 0) + (mix.runs?.[1]?.[0] ?? 0), kind: "gravel" },
    ]);
    expect(mix.runs).toHaveLength(2);
    expect(surfaceRunSpans({ value: engineSurfaceMix(summary(), "mixed"), status: "estimated", confidence: 0.8, provenance: [] })).toBeNull();
  });
});


/** One road run with only the fields the busy-road rule reads set explicitly. */
function roadRun(
  meters: number,
  roadClass: string,
  urbanDensity = "rural",
  overrides: Partial<ProviderRoadRun> = {},
): ProviderRoadRun {
  return {
    meters,
    durationSeconds: null,
    surface: "asphalt",
    roadClass,
    roadEnvironment: "road",
    urbanDensity,
    curvatureRatio: null,
    toll: false,
    ...overrides,
  };
}

/** A summary whose ordered runs add up to its total, as the provider sends it. */
function runSummary(runs: readonly ProviderRoadRun[]): ProviderRoadSummary {
  const totalMeters = runs.reduce((sum, run) => sum + run.meters, 0);
  return summary({
    totalMeters,
    surfaceByRoadClassMeters: { "asphalt|secondary": totalMeters },
    roadRuns: runs,
  });
}

describe("engine busy roads", () => {
  it("measures the share on motorway, trunk, primary, their links and city streets", () => {
    // 20 mi ridden: 5 primary, 2 through a city, 2 on a primary link, 11 quiet.
    const routes = runSummary([
      roadRun(5 * MILE, "primary"),
      roadRun(2 * MILE, "tertiary", "city"),
      roadRun(7 * MILE, "tertiary", "town"),
      roadRun(4 * MILE, "residential"),
      roadRun(2 * MILE, "secondary", "rural", { roadClassLink: true }),
    ]);
    expect(engineBusyRoads(routes)?.share).toBeCloseTo(0.45, 5);
    expect(engineBusyRoads(routes)?.coverage).toBeCloseTo(1, 5);

    const evidence = engineRoadEvidence(routes, "mixed");
    expect(evidence["busyRoads"]?.status).toBe("estimated");
    expect(busyRoadShare(evidence["busyRoads"])).toBeCloseTo(0.45, 3);
  });

  it("measures nothing from a class tally alone, where a town street would read quiet", () => {
    expect(engineBusyRoads(summary())).toBeNull();
    expect(engineRoadEvidence(summary(), "mixed")).not.toHaveProperty("busyRoads");
    expect(busyRoadShare(undefined)).toBeNull();
  });
});

describe("engine bike fit", () => {
  it("measures rough track from the ordered runs and names the longest stretch", () => {
    const routes = runSummary([
      roadRun(2 * MILE, "tertiary"),
      roadRun(0.5 * MILE, "track", "rural", { surface: "gravel", trackType: "grade3" }),
      roadRun(MILE, "track", "rural", { surface: "gravel", trackType: "grade4" }),
      roadRun(0.3 * MILE, "track", "rural", { surface: "ground", smoothness: "very_bad" }),
      roadRun(3 * MILE, "secondary", "rural"),
      roadRun(0.4 * MILE, "track", "rural", { surface: "ground", trackType: "grade5" }),
    ]);
    const fit = engineBikeFit(routes);
    expect(fit?.roughTrackMeters).toBe(Math.round(2.2 * MILE));
    expect(fit?.unmeasuredMeters).toBe(0);
    // Grade changes on the same track are one stretch to the rider.
    expect(fit?.worst?.fromMeters).toBe(Math.round(2 * MILE));
    expect(fit?.worst?.toMeters).toBe(Math.round(3.8 * MILE));
  });

  it("treats smooth bad-or-worse roads as rough, and clean paving as not rough", () => {
    const routes = runSummary([
      roadRun(4 * MILE, "secondary", "rural", { smoothness: "bad" }),
      roadRun(6 * MILE, "secondary", "rural", { smoothness: "good" }),
    ]);
    expect(engineBikeFit(routes)?.roughTrackMeters).toBe(Math.round(4 * MILE));
    expect(engineBikeFit(routes)?.worst).toEqual({
      fromMeters: 0,
      toMeters: Math.round(4 * MILE),
    });
  });

  it("sends a compact fact to the card and keeps raw runs out of it", () => {
    const routes = runSummary([
      roadRun(5 * MILE, "tertiary"),
      roadRun(0.8 * MILE, "track", "rural", { surface: "gravel", trackType: "grade3" }),
    ]);
    const evidence = engineRoadEvidence(routes, "mixed");
    expect(evidence["bikeFit"]?.status).toBe("estimated");
    expect(evidence["bikeFit"]?.coverage).toBeCloseTo(1, 5);
    const read = bikeFitFacts(evidence["bikeFit"]);
    expect(read).toEqual({
      roughTrackMeters: Math.round(0.8 * MILE),
      unmeasuredMeters: 0,
      worst: { fromMeters: Math.round(5 * MILE), toMeters: Math.round(5.8 * MILE) },
    });
    // The same fact after a JSON trip to the browser reads back unchanged…
    const onWire = JSON.parse(JSON.stringify(evidence["bikeFit"])) as EvidenceValue<unknown>;
    expect(bikeFitFacts(onWire)).toEqual(read);
    // …and is numbers, not the run list the provider sent.
    expect(JSON.stringify(evidence["bikeFit"]?.value)).not.toContain("trackType");
  });

  it("counts the line the runs did not describe, so a truncated answer cannot read fine", () => {
    const truncated = summary({
      totalMeters: 10 * MILE,
      roadRuns: [roadRun(8 * MILE, "tertiary")],
    });
    expect(bikeFitFacts(engineRoadEvidence(truncated, "mixed")["bikeFit"])?.unmeasuredMeters)
      .toBe(Math.round(2 * MILE));
  });

  it("writes nothing without road runs, and reads nothing from an unknown fact", () => {
    expect(engineBikeFit(summary())).toBeNull();
    expect(engineRoadEvidence(summary(), "mixed")).not.toHaveProperty("bikeFit");
    expect(bikeFitFacts(undefined)).toBeNull();
    expect(bikeFitFacts({
      value: { roughTrackMeters: 0, unmeasuredMeters: 0 },
      status: "unknown",
      confidence: null,
      provenance: [],
    })).toBeNull();
    expect(bikeFitFacts({
      value: { roughTrackMeters: -1, unmeasuredMeters: 0 },
      status: "estimated",
      confidence: null,
      provenance: [],
    })).toBeNull();
  });
});

describe("road character coverage", () => {
  it("orders road classes for a through ride and keeps service roads low", () => {
    const reading = (roadClass: string) => backroadShare(summary({
      totalMeters: 1_000,
      surfaceByRoadClassMeters: { [`missing|${roadClass}`]: 1_000 },
    }))!;
    // Subdivision streets (residential) sit below the classic riding roads.
    const classes = ["motorway", "trunk", "primary", "residential", "secondary", "tertiary", "unclassified"];
    for (let index = 1; index < classes.length; index += 1) {
      expect(reading(classes[index]!)).toBeGreaterThan(reading(classes[index - 1]!));
    }
    expect(reading("track")).toBeGreaterThan(reading("secondary"));
    expect(reading("service")).toBeLessThan(reading("secondary"));
  });

  it("reports only recognized road metres as covered", () => {
    const evidence = engineRoadEvidence(summary({
      totalMeters: 10_000,
      surfaceByRoadClassMeters: { "gravel|track": 1_000, "missing|missing": 8_000, "missing|future_class": 1_000 },
    }), "dirt-preferred");
    expect(engineRoadCharacter(summary({
      totalMeters: 10_000,
      surfaceByRoadClassMeters: { "gravel|track": 1_000, "missing|missing": 9_000 },
    }))).toEqual({ unit: 0.9, coverage: 0.1 });
    expect(evidence.roadClassMix?.coverage).toBe(0.1);
    expect(evidence.roadClassMix?.value).toBe(0.9);
    expect(backroadShare(summary({ surfaceByRoadClassMeters: { "missing|missing": 100 } }))).toBeNull();
  });

  it("separates measured surface fit from the honest whole-route unpaved share", () => {
    const mix = engineSurfaceMix(summary({
      totalMeters: 10_000,
      surfaceByRoadClassMeters: { "gravel|unclassified": 1_000 },
    }), "dirt-preferred");
    expect(mix.unit).toBe(1);
    expect(mix.unpavedShare).toBe(0.1);
    expect(mix.unknownMeters).toBe(9_000);
  });
});

describe("engine urban friction", () => {
  it("reads countryside as 0, suburbs as most of the way to a city, and the city as 1", () => {
    // 20 mi: 10 rural, 8 through suburbs (residential density), 2 in a city.
    const routes = runSummary([
      roadRun(10 * MILE, "tertiary", "rural"),
      roadRun(8 * MILE, "residential", "residential"),
      roadRun(2 * MILE, "secondary", "city"),
    ]);
    const urban = engineUrbanFriction(routes);
    expect(urban?.unit).toBeCloseTo((8 * 0.7 + 2) / 20, 5);
    expect(urban?.coverage).toBeCloseTo(1, 5);
    const evidence = engineUrbanFrictionEvidence(routes);
    expect(evidence["urbanFriction"]?.status).toBe("estimated");
    expect(evidence["urbanFriction"]?.value).toBeCloseTo(0.38, 3);
  });

  it("counts a country main road as half a city street, and never less than the town it runs through", () => {
    const highway = runSummary([
      roadRun(6 * MILE, "primary", "rural"),
      roadRun(2 * MILE, "secondary", "rural", { roadClassLink: true }),
      roadRun(10 * MILE, "tertiary", "rural"),
      roadRun(2 * MILE, "primary", "city"),
    ]);
    expect(engineUrbanFriction(highway)?.unit).toBeCloseTo((8 * 0.5 + 2) / 20, 5);
  });

  it("leaves undescribed density unknown instead of calling it countryside", () => {
    expect(engineUrbanFriction(summary())).toBeNull();
    expect(engineUrbanFrictionEvidence(summary())).toEqual({});
    const partly = runSummary([roadRun(5 * MILE, "tertiary", "missing"), roadRun(5 * MILE, "tertiary", "rural")]);
    expect(engineUrbanFriction(partly)?.unit).toBe(0);
    expect(engineUrbanFriction(partly)?.coverage).toBeCloseTo(0.5, 5);
  });
});
