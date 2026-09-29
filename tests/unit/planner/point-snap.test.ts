/**
 * The drag preview's snap rule (04-PLANNER-AND-WORKSPACE-UX §15, 05 §7).
 *
 * A snap is only honest if it is bounded and predictable: inside the tolerance it
 * attaches the preview to an authored object, outside it the rider's own
 * coordinate is kept. These are the properties the drag gesture relies on, so
 * they are pinned here rather than inferred from a screenshot.
 */

import { describe, expect, it } from "vitest";

import {
  SNAP_TOLERANCE_METERS,
  snapPreviewCoordinate,
  type SnapCandidate,
} from "@/application/planner/point-snap";
import type { Coordinate } from "@/domain/ride/types";

const ORIGIN: Coordinate = { lon: -75.4385, lat: 40.1385 };

/** A coordinate `meters` north of the origin at this latitude. */
function northOf(origin: Coordinate, meters: number): Coordinate {
  // ~111_320 m per degree of latitude; the exact ratio is irrelevant to the rule.
  return { lon: origin.lon, lat: origin.lat + meters / 111_320 };
}

const CANDIDATES: readonly SnapCandidate[] = [
  { id: "stop_a", coordinate: ORIGIN },
  { id: "stop_b", coordinate: northOf(ORIGIN, 900) },
];

describe("snapPreviewCoordinate", () => {
  it("keeps the pointer coordinate when nothing is close enough", () => {
    const pointer = northOf(ORIGIN, 400);
    const result = snapPreviewCoordinate(pointer, CANDIDATES);

    expect(result.snappedToId).toBeNull();
    expect(result.coordinate).toEqual(pointer);
  });

  it("snaps onto the nearest candidate inside the tolerance", () => {
    const result = snapPreviewCoordinate(northOf(ORIGIN, 40), CANDIDATES);

    expect(result.snappedToId).toBe("stop_a");
    expect(result.coordinate).toEqual(ORIGIN);
  });

  it("chooses the nearer of two candidates, not the first one", () => {
    // 820 m up is 820 m from `stop_a` and 80 m from `stop_b`.
    const result = snapPreviewCoordinate(northOf(ORIGIN, 820), CANDIDATES);

    expect(result.snappedToId).toBe("stop_b");
    expect(result.coordinate).toEqual(northOf(ORIGIN, 900));
  });

  it("treats the tolerance as a ceiling, and the boundary as inside", () => {
    const justInside = snapPreviewCoordinate(northOf(ORIGIN, SNAP_TOLERANCE_METERS), [
      { id: "only", coordinate: ORIGIN },
    ]);
    expect(justInside.snappedToId).toBe("only");

    const justOutside = snapPreviewCoordinate(
      northOf(ORIGIN, SNAP_TOLERANCE_METERS + 5),
      [{ id: "only", coordinate: ORIGIN }],
    );
    expect(justOutside.snappedToId).toBeNull();
  });

  it("is deterministic when two candidates are exactly as close", () => {
    // Two candidates the same distance away: document order decides, so the same
    // gesture cannot flip between two previews.
    const left: SnapCandidate = { id: "left", coordinate: { lon: ORIGIN.lon - 0.0005, lat: ORIGIN.lat } };
    const right: SnapCandidate = { id: "right", coordinate: { lon: ORIGIN.lon + 0.0005, lat: ORIGIN.lat } };
    const result = snapPreviewCoordinate(ORIGIN, [left, right]);
    expect(result.snappedToId).toBe("left");

    const reversed = snapPreviewCoordinate(ORIGIN, [right, left]);
    expect(reversed.snappedToId).toBe("right");
  });

  it("ignores an unusable candidate instead of snapping to it", () => {
    const result = snapPreviewCoordinate(ORIGIN, [
      { id: "broken", coordinate: { lon: Number.NaN, lat: 0 } },
      { id: "good", coordinate: northOf(ORIGIN, 20) },
    ]);
    expect(result.snappedToId).toBe("good");
  });
});
