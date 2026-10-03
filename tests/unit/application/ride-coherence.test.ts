import { describe, expect, it } from "vitest";

import {
  analyzeRideCoherence,
  rideArcSegmentsFromRoadRuns,
  type RideArcWorthwhileJudge,
} from "@/application/planner/ride-coherence";
import type {
  ProviderRoadRun,
  ProviderRoadSummary,
} from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";

const line: readonly Coordinate[] = [
  { lon: -75.5, lat: 40 },
  { lon: -75.45, lat: 40.01 },
  { lon: -75.4, lat: 40.02 },
  { lon: -75.35, lat: 40.03 },
];

function run(
  minutes: number | null,
  roadClass: string,
  meters = 1_000,
): ProviderRoadRun {
  return {
    meters,
    durationSeconds: minutes === null ? null : minutes * 60,
    surface: "asphalt",
    roadClass,
    roadEnvironment: "road",
    urbanDensity: "rural",
    curvatureRatio: 0.9,
    toll: false,
  };
}

function summary(runs: readonly ProviderRoadRun[]): ProviderRoadSummary {
  const totalMeters = runs.reduce((sum, entry) => sum + entry.meters, 0);
  return {
    totalMeters,
    surfaceByRoadClassMeters: {},
    curvatureMeters: {},
    tollMeters: 0,
    roadRuns: runs,
  } as unknown as ProviderRoadSummary;
}

// A test-only judge: the contract takes the judgement from the caller.
const judge: RideArcWorthwhileJudge = (entry) =>
  entry.roadClass === "tertiary" ? 0.9 : entry.roadClass === "unknown" ? null : 0.2;

describe("canonical ride coherence contract", () => {
  it("reports path coherence and an evidence-driven arc side by side", () => {
    const result = analyzeRideCoherence({
      geometry: line,
      roadSummary: summary([
        run(6, "primary"),
        run(20, "tertiary"),
        run(5, "primary"),
      ]),
      worthwhile: judge,
    });
    expect(result.schemaVersion).toBe(1);
    expect(result.path).not.toBeNull();
    expect(result.arcUnavailable).toBeNull();
    expect(result.arc?.coreDetected).toBe(true);
    expect(result.arc?.escape?.durationSeconds).toBe(360);
    expect(result.arc?.core?.durationSeconds).toBe(1_200);
    expect(result.arc?.terminal?.durationSeconds).toBe(300);
    expect(result.orderedEvidence).toMatchObject({ runCount: 3, timedShare: 1 });
  });

  it("never guesses an arc without a canonical worthwhile policy", () => {
    const result = analyzeRideCoherence({
      geometry: line,
      roadSummary: summary([run(10, "tertiary")]),
    });
    expect(result.arc).toBeNull();
    expect(result.arcUnavailable).toBe("no-worthwhile-policy");
    expect(result.orderedEvidence?.runCount).toBe(1);
  });

  it("says ordered evidence is missing rather than reading it as flat", () => {
    const result = analyzeRideCoherence({ geometry: line, worthwhile: judge });
    expect(result.arc).toBeNull();
    expect(result.orderedEvidence).toBeNull();
    expect(result.arcUnavailable).toBe("no-ordered-evidence");
  });

  it("refuses phase minutes when any run lacks provider edge time", () => {
    const runs = [run(10, "tertiary"), run(null, "tertiary")];
    expect(rideArcSegmentsFromRoadRuns(runs, judge)).toBeNull();
    const result = analyzeRideCoherence({
      geometry: line,
      roadSummary: summary(runs),
      worthwhile: judge,
    });
    expect(result.arcUnavailable).toBe("no-edge-time");
    expect(result.orderedEvidence?.timedShare).toBeCloseTo(0.5);
  });

  it("keeps an unknown judgement unknown inside the arc denominator", () => {
    const segments = rideArcSegmentsFromRoadRuns(
      [run(10, "tertiary"), run(10, "unknown"), run(0, "primary", 0)],
      judge,
    );
    expect(segments).toHaveLength(2);
    expect(segments?.[1]?.worthwhile).toBeNull();
    const result = analyzeRideCoherence({
      geometry: line,
      roadSummary: summary([run(10, "tertiary"), run(10, "unknown")]),
      worthwhile: judge,
    });
    expect(result.arc?.unknownEvidenceSeconds).toBe(600);
    expect(result.arc?.worthwhileMinuteRatio).toBeCloseTo(0.5);
  });

  it("drops out-of-range judgements to unknown instead of clamping", () => {
    const segments = rideArcSegmentsFromRoadRuns([run(5, "tertiary")], () => 1.4);
    expect(segments?.[0]?.worthwhile).toBeNull();
  });
});
