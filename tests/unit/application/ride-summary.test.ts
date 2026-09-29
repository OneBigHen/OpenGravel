import { describe, expect, it } from "vitest";

import { rideSummaryStats } from "@/application/ride-metrics/ride-summary";
import { EMPTY_RECORDING_TELEMETRY, type RecordingTelemetry } from "@/domain/recording/telemetry";

const RIDE: RecordingTelemetry = {
  ...EMPTY_RECORDING_TELEMETRY,
  acceptedDistanceMeters: 80_467, // 50 mi
  movingMs: 90 * 60_000, // 1:30
  maxSpeedMps: 26.8224, // 60 mph
  elevation: { currentMeters: 400, sampledAtMs: 0, gainMeters: 914.4, lossMeters: 900, sampleCount: 120 },
};

describe("the finish summary", () => {
  it("sums a ride up in distance, moving time, average and top speed, and climb", () => {
    expect(rideSummaryStats(RIDE).map((stat) => [stat.id, stat.value, stat.unit])).toEqual([
      ["distance", "50", "mi"],
      ["moving", "1:30", "h"],
      ["average", "33", "mph"],
      ["max", "60", "mph"],
      ["climb", "3,000", "ft"],
    ]);
  });

  it("speaks metric when the rider chose it", () => {
    const metric = rideSummaryStats(RIDE, "metric");
    expect(metric.find((stat) => stat.id === "distance")).toMatchObject({ value: "80", unit: "km" });
    expect(metric.find((stat) => stat.id === "climb")).toMatchObject({ value: "914", unit: "m" });
  });

  it("leaves out what it cannot know, and has nothing to say about a ride under a minute", () => {
    const noAltitude = rideSummaryStats({ ...RIDE, maxSpeedMps: null, elevation: EMPTY_RECORDING_TELEMETRY.elevation });
    expect(noAltitude.map((stat) => stat.id)).toEqual(["distance", "moving", "average"]);
    expect(rideSummaryStats({ ...RIDE, movingMs: 30_000 })).toEqual([]);
    expect(rideSummaryStats(null)).toEqual([]);
    expect(rideSummaryStats({ ...RIDE, movingMs: 25 * 60_000 }).find((stat) => stat.id === "moving")).toMatchObject({ value: "25", unit: "min" });
    // One rounding only: 9.97 mi is "10", 80.47 km is "80", 4.26 mi is "4.3".
    expect(rideSummaryStats({ ...RIDE, acceptedDistanceMeters: 16_045 })[0]?.value).toBe("10");
    expect(rideSummaryStats({ ...RIDE, acceptedDistanceMeters: 6_856 })[0]?.value).toBe("4.3");
  });
});
