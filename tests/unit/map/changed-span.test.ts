/**
 * The changed-span computation (05-MAP-INTERACTION-AND-CARTOGRAPHY §12,
 * 04-PLANNER-AND-WORKSPACE-UX §21).
 *
 * The highlight is an *answer*, not decoration: it says which part of the ride the
 * rider's last edit actually moved. That makes two properties non-negotiable —
 * an identical route must produce no highlight at all (nothing changed, so nothing
 * may be claimed), and the span must be the **next** route's divergent section, so
 * the emphasis is drawn over the line on screen rather than over the one it
 * replaced.
 */

import { describe, expect, it } from "vitest";

import {
  SAME_PATH_METERS,
  computeChangedSpan,
  routeDelta,
} from "@/application/map/changed-span";
import type { Coordinate } from "@/domain/ride/types";

/** A line of `count` points spaced ~110 m apart, eastbound. */
function line(count: number, startLon = -75.44, startLat = 40.14): Coordinate[] {
  const points: Coordinate[] = [];
  for (let index = 0; index < count; index += 1) {
    points.push({ lon: startLon + index * 0.0013, lat: startLat });
  }
  return points;
}

/** The same line, moved far enough east that no vertex is within tolerance. */
function shifted(count: number): Coordinate[] {
  return line(count, -75.40, 40.145);
}

describe("computeChangedSpan", () => {
  it("claims nothing when the two lines are the same within the tolerance", () => {
    // ~11 m of drift: below `SAME_PATH_METERS`, so it is the same road, not a move.
    const previous = line(6);
    const jittered = line(6).map((point) => ({
      lon: point.lon + 0.0001,
      lat: point.lat,
    }));

    expect(computeChangedSpan(previous, previous)).toBeNull();
    expect(computeChangedSpan(previous, jittered)).toBeNull();
  });

  it("returns only the divergent tail, in the next route's own order", () => {
    const previous = line(6);
    const changed = line(6);
    const next = [...changed.slice(0, 3), ...shifted(3)];

    const span = computeChangedSpan(previous, next);

    expect(span).not.toBeNull();
    // The tail is the *next* line's last three points, not the previous one's.
    expect(span?.geometry).toEqual(shifted(3));
    expect(span?.fromFraction).toBeCloseTo(3 / 5, 6);
    expect(span?.toFraction).toBe(1);
  });

  it("returns only the divergent head", () => {
    const previous = line(6);
    const next = [...shifted(2), ...line(6).slice(2)];

    const span = computeChangedSpan(previous, next);

    expect(span?.geometry).toEqual(shifted(2));
    expect(span?.fromFraction).toBe(0);
    expect(span?.toFraction).toBeCloseTo(1 / 5, 6);
  });

  it("returns the whole next route when nothing is shared", () => {
    const previous = line(5);
    const next = shifted(4);

    const span = computeChangedSpan(previous, next);

    expect(span?.geometry).toEqual(next);
    expect(span?.fromFraction).toBe(0);
    expect(span?.toFraction).toBe(1);
  });

  it("returns the whole next route when the same roads are reordered", () => {
    const previous = line(4);
    const reversed = [...line(4)].reverse();

    const span = computeChangedSpan(previous, reversed);

    // A positional walk cannot call a reorder "unchanged": the shape is the same
    // roads in a different order, and the honest answer is a full emphasis rather
    // than a claim that only the ends moved.
    expect(span?.geometry).toEqual(reversed);
  });

  it("claims nothing when the next route only shortens the same path", () => {
    expect(computeChangedSpan(line(6), line(6).slice(0, 4))).toBeNull();
  });

  it("returns only an added tail when the route grows", () => {
    const previous = line(3);
    const next = [...line(3), ...shifted(2)];

    const span = computeChangedSpan(previous, next);

    expect(span?.geometry).toEqual(shifted(2));
    expect(span?.fromFraction).toBeCloseTo(3 / 4, 6);
    expect(span?.toFraction).toBe(1);
  });

  it("is null for a line that cannot be drawn or cannot be walked", () => {
    expect(computeChangedSpan([], [])).toBeNull();
    expect(computeChangedSpan(line(2), [{ lon: -75.44, lat: 40.14 }])).toBeNull();
  });

  it("keeps the tolerance the 05 §12 rule is stated in", () => {
    expect(SAME_PATH_METERS).toBe(15);
  });
});

describe("routeDelta", () => {
  it("states the signed difference in minutes and meters", () => {
    expect(
      routeDelta(
        { distanceMeters: 1_711, durationSeconds: 245 },
        { distanceMeters: 4_608, durationSeconds: 425 },
      ),
    ).toEqual({ addedMinutes: 3, addedMeters: 2_897 });
  });

  it("states a shorter ride as a negative delta, and rounds to the stated units", () => {
    expect(
      routeDelta(
        { distanceMeters: 5_000, durationSeconds: 600 },
        { distanceMeters: 4_420, durationSeconds: 451 },
      ),
    ).toEqual({ addedMinutes: -2, addedMeters: -580 });
    // 89 s is closer to 1 than to 2 minutes: the delta rounds like the rest of
    // the product's duration copy, and it never reports a fraction of a minute.
    expect(
      routeDelta(
        { distanceMeters: 0, durationSeconds: 0 },
        { distanceMeters: 0, durationSeconds: 89 },
      ).addedMinutes,
    ).toBe(1);
  });
});
