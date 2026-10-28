import { describe, expect, it } from "vitest";

import { breadcrumbIssues, straightBreadcrumb } from "@/domain/breadcrumb/route";
import { breadcrumbKeepIndices, MAX_BREADCRUMB_WAYPOINTS, thinBreadcrumbLine } from "@/domain/breadcrumb/thin";

/** A gently curving 400-point line, the shape a recorded track arrives in. */
function recordedTrack(points = 400): { lon: number; lat: number }[] {
  return Array.from({ length: points }, (_value, index) => ({
    lon: -75 + index * 0.0001,
    lat: 40 + Math.sin(index / 40) * 0.01,
  }));
}

describe("thinning a line into breadcrumb waypoints", () => {
  it("keeps the whole line when it already fits the waypoint budget", () => {
    const line = recordedTrack(12);
    expect(breadcrumbKeepIndices(line)).toEqual(line.map((_point, index) => index));
    expect(thinBreadcrumbLine(line)).toHaveLength(12);
  });

  it("fits a long track to the waypoint budget and keeps both ends", () => {
    const line = recordedTrack(4_000);
    const kept = breadcrumbKeepIndices(line);
    expect(kept.length).toBeLessThanOrEqual(MAX_BREADCRUMB_WAYPOINTS);
    expect(kept.length).toBeGreaterThan(2);
    expect(kept[0]).toBe(0);
    expect(kept.at(-1)).toBe(line.length - 1);
    // Along-line order is preserved, so the breadcrumb never doubles back.
    expect([...kept].sort((a, b) => a - b)).toEqual(kept);
  });

  it("keeps the bends that carry the shape and drops straight-run noise", () => {
    const line = recordedTrack(200);
    const kept = breadcrumbKeepIndices(line, 10);
    const thinned = thinBreadcrumbLine(line, 10);
    expect(thinned).toHaveLength(kept.length);
    // Every kept waypoint is one of the source positions, never an invented one.
    kept.forEach((index, position) => expect(thinned[position]).toEqual(line[index]));
    // The ends are the source ends.
    expect(thinned[0]).toEqual(line[0]);
    expect(thinned.at(-1)).toEqual(line.at(-1));
    // The shape survives: the thinned line keeps the curve's own amplitude
    // instead of cutting one chord from end to end.
    const amplitude = Math.max(...line.map((point) => point.lat)) - Math.min(...line.map((point) => point.lat));
    const keptAmplitude = Math.max(...thinned.map((point) => point.lat)) - Math.min(...thinned.map((point) => point.lat));
    expect(keptAmplitude).toBeGreaterThan(amplitude * 0.9);
    const chord = Math.abs(line.at(-1)!.lat - line[0]!.lat);
    expect(keptAmplitude).toBeGreaterThan(chord);
  });

  it("drops duplicate and invalid positions before thinning", () => {
    const line = [
      { lon: -75, lat: 40 },
      { lon: -75, lat: 40 },
      { lon: Number.NaN, lat: 40 },
      { lon: -75.01, lat: 40.01 },
      { lon: -75.01, lat: 40.01 },
      { lon: -75.02, lat: 40.02 },
    ];
    expect(breadcrumbKeepIndices(line)).toEqual([0, 3, 5]);
    const route = straightBreadcrumb(
      thinBreadcrumbLine(line).map((coordinate, index) => ({ id: `wp_${index}`, coordinate })),
    );
    expect(route.waypoints).toHaveLength(3);
    expect(breadcrumbIssues(route)).toEqual([]);
  });

  it("gives a two-point line two waypoints and a one-point line one", () => {
    const pair = [{ lon: -75, lat: 40 }, { lon: -75.01, lat: 40.01 }];
    expect(thinBreadcrumbLine(pair)).toHaveLength(2);
    expect(thinBreadcrumbLine([{ lon: -75, lat: 40 }])).toHaveLength(1);
    expect(thinBreadcrumbLine([])).toEqual([]);
  });
});
