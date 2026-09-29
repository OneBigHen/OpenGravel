import { describe, expect, it } from "vitest";

import {
  buildRouteRoadSummary,
  type MatchedRoadSpan,
} from "@/application/roads/route-road-summary";
import { asRoadEntityId } from "@/domain/ride/ids";
import { aggregateSurface } from "@/domain/roads/surface";

const ROAD_A = asRoadEntityId("road_a");
const ROAD_B = asRoadEntityId("road_b");
const ROUTE = {
  geometry: [
    { lon: -75, lat: 40 },
    { lon: -74.99, lat: 40 },
  ],
  distanceMeters: 1_000,
} as const;

function span(
  entityId: typeof ROAD_A | typeof ROAD_B,
  startDistanceMeters: number,
  endDistanceMeters: number,
  overrides: Partial<MatchedRoadSpan> = {},
): MatchedRoadSpan {
  return {
    entityId,
    startDistanceMeters,
    endDistanceMeters,
    matchConfidence: "matched",
    ...overrides,
  };
}

describe("route road summaries", () => {
  it("orders roads by travel position and calculates km and route percentage", () => {
    const result = buildRouteRoadSummary(
      ROUTE,
      [span(ROAD_B, 500, 1_000), span(ROAD_A, 0, 500)],
      [],
    );

    expect(result.roads.map((road) => road.entityId)).toEqual([ROAD_A, ROAD_B]);
    expect(result.roads[0]).toMatchObject({
      distanceKm: 0.5,
      percentage: 50,
      confidenceBand: "Unverified",
      surfaceValue: "unknown",
      surfaceBand: "unknown",
    });
    expect(result.matchedKm).toBe(1);
    expect(result.coveragePercent).toBe(100);
  });

  it("uses road evidence bands and leaves empty evidence unverified", () => {
    const surfaceAssessment = aggregateSurface([{
      id: "official",
      value: "paved",
      source: "official-authority",
      observedAt: "2026-09-17T12:00:00.000Z",
      weight: 1,
      confidence: 0.9,
    }]);
    const result = buildRouteRoadSummary(
      ROUTE,
      [span(ROAD_A, 0, 500), span(ROAD_B, 500, 1_000)],
      [{
        entityId: ROAD_A,
        surfaceValue: "paved-smooth",
        confidence: 0.9,
        confidenceBand: "High",
        conflict: false,
        evidenceCount: 1,
        sourceDiversity: 1,
        latestObservedAt: "2026-09-17T12:00:00.000Z",
        records: [],
        surfaceAssessment,
        surfaceBand: surfaceAssessment.band,
      }],
    );

    expect(result.roads.map((road) => road.confidenceBand)).toEqual(["High", "Unverified"]);
    expect(result.unverifiedRoadCount).toBe(1);
    expect(result.roads.map((road) => road.surfaceBand)).toEqual(["confirmed", "unknown"]);
    expect(result.surfaceBand).toBe("confirmed");
  });

  it("does not include catalog evidence for roads absent from the matched route", () => {
    const paved = aggregateSurface([{
      id: "paved",
      value: "paved",
      source: "official-authority",
      weight: 1,
      confidence: 1,
    }]);
    const dirt = aggregateSurface([{
      id: "dirt",
      value: "dirt",
      source: "official-authority",
      weight: 1,
      confidence: 1,
    }]);
    const result = buildRouteRoadSummary(
      ROUTE,
      [span(ROAD_A, 0, 1_000)],
      [
        {
          entityId: ROAD_A,
          surfaceValue: "paved",
          confidence: 1,
          confidenceBand: "High",
          conflict: false,
          evidenceCount: 1,
          sourceDiversity: 1,
          latestObservedAt: null,
          records: [],
          surfaceAssessment: paved,
          surfaceBand: paved.band,
        },
        {
          entityId: ROAD_B,
          surfaceValue: "dirt",
          confidence: 1,
          confidenceBand: "High",
          conflict: false,
          evidenceCount: 1,
          sourceDiversity: 1,
          latestObservedAt: null,
          records: [],
          surfaceAssessment: dirt,
          surfaceBand: dirt.band,
        },
      ],
    );

    expect(result.surfaceAssessment).toMatchObject({ value: "paved", band: "confirmed", conflicts: [] });
  });

  it("union-counts overlapping frontage and ramp spans only once", () => {
    const result = buildRouteRoadSummary(ROUTE, [
      span(ROAD_A, 0, 600, { matchConfidence: "exact" }),
      span(ROAD_B, 400, 1_000, { matchConfidence: "matched" }),
    ]);

    expect(result.matchedKm).toBe(1);
    expect(result.coveragePercent).toBe(100);
    expect(result.roads.reduce((total, road) => total + road.distanceKm, 0)).toBe(1);
    expect(result.roads.find((road) => road.entityId === ROAD_A)?.distanceKm).toBe(0.6);
    expect(result.roads.find((road) => road.entityId === ROAD_B)?.distanceKm).toBe(0.4);
  });

  it("does not count gaps as matched coverage", () => {
    const result = buildRouteRoadSummary(ROUTE, [span(ROAD_A, 100, 600)]);

    expect(result.matchedKm).toBe(0.5);
    expect(result.coveragePercent).toBe(50);
    expect(result.unmatchedKm).toBe(0.5);
  });

  it("merges repeated spans of one road and remains deterministic", () => {
    const first = buildRouteRoadSummary(ROUTE, [span(ROAD_A, 500, 700), span(ROAD_A, 0, 400)]);
    const second = buildRouteRoadSummary(ROUTE, [span(ROAD_A, 0, 400), span(ROAD_A, 500, 700)]);

    expect(first).toEqual(second);
    expect(first.roads).toHaveLength(1);
    expect(first.roads[0]?.distanceKm).toBe(0.6);
  });
});
