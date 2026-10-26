import { describe, expect, it } from "vitest";

import { elevationSummaryOf } from "@/application/explore/elevation-summary";

/**
 * The route page says climb, descent and the highest point, in feet. It used to
 * say how many samples the profile held, which is how the data is stored, not
 * what the ride does.
 */
describe("elevationSummaryOf", () => {
  it("counts the climb and the descent and reports the highest point", () => {
    const summary = elevationSummaryOf([
      { distanceKm: 0, elevationMeters: 300 },
      { distanceKm: 4, elevationMeters: 500 },
      { distanceKm: 9, elevationMeters: 350 },
      { distanceKm: 13, elevationMeters: 400 },
    ]);
    expect(summary).toEqual({ climbMeters: 250, descentMeters: 150, highPointMeters: 500 });
  });

  it("does not count noise between samples as climbing", () => {
    // A flat road whose samples wobble by a metre or two is flat.
    const summary = elevationSummaryOf([
      { distanceKm: 0, elevationMeters: 200 },
      { distanceKm: 1, elevationMeters: 202 },
      { distanceKm: 2, elevationMeters: 199 },
      { distanceKm: 3, elevationMeters: 201 },
    ]);
    expect(summary).toEqual({ climbMeters: 0, descentMeters: 0, highPointMeters: 202 });
  });

  it("refuses a profile too short or too broken to summarise", () => {
    expect(elevationSummaryOf(undefined)).toBeNull();
    expect(elevationSummaryOf([])).toBeNull();
    expect(elevationSummaryOf([{ distanceKm: 0, elevationMeters: 300 }])).toBeNull();
    expect(elevationSummaryOf([
      { distanceKm: 0, elevationMeters: 300 },
      { distanceKm: Number.NaN, elevationMeters: 500 },
    ])).toBeNull();
    expect(elevationSummaryOf([
      { distanceKm: 0, elevationMeters: 300 },
      { distanceKm: 1, elevationMeters: Number.POSITIVE_INFINITY },
    ])).toBeNull();
  });
});
