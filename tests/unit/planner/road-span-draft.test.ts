/**
 * The road-span selection draft (05 §20, 04 §17).
 *
 * Selecting a span is a pure interaction: a tap picks the nearest route vertex,
 * grabbing an end handle extends or shrinks the range, and the draft carries the
 * two facts the constraint needs — the snapped line in **draft order** and the
 * direction that order means against the route's traversal.
 */

import { describe, expect, it } from "vitest";

import {
  beginRoadSpanDraft,
  moveSpanHandle,
  nearestHandle,
  nearestVertexIndex,
  spanDirectionFor,
  spanDraftAnchors,
  spanDraftGeometry,
  spanRange,
} from "@/application/planner/road-span-draft";
import type { Coordinate } from "@/domain/ride/types";

const BASE: Coordinate = { lon: -75.44, lat: 40.14 };
const ONE_METER_LAT = 1 / 111_320;
const ONE_METER_LON = 1 / (111_320 * Math.cos((BASE.lat * Math.PI) / 180));

function metres(east: number, north: number): Coordinate {
  return {
    lon: BASE.lon + east * ONE_METER_LON,
    lat: BASE.lat + north * ONE_METER_LAT,
  };
}

/** A straight east-west line with a vertex every 100 m. */
const LINE: readonly Coordinate[] = [0, 100, 200, 300, 400].map((east) => metres(east, 0));

describe("nearestVertexIndex", () => {
  it("picks the closest vertex to the tap", () => {
    expect(nearestVertexIndex(LINE, metres(190, 20))).toBe(2);
    expect(nearestVertexIndex(LINE, metres(410, 0))).toBe(4);
  });

  it("has no answer for a line with no usable vertex", () => {
    expect(nearestVertexIndex([], metres(0, 0))).toBeNull();
    expect(nearestVertexIndex([{ lon: Number.NaN, lat: 0 }], metres(0, 0))).toBeNull();
  });
});

describe("beginRoadSpanDraft", () => {
  it("starts a one-vertex span at the nearest route vertex", () => {
    const draft = beginRoadSpanDraft("route_a", LINE, metres(305, 0));
    expect(draft).toEqual({ routeId: "route_a", startIndex: 3, endIndex: 3 });
  });

  it("returns null when the tap does not resolve to a vertex", () => {
    expect(beginRoadSpanDraft("route_a", [], metres(0, 0))).toBeNull();
  });
});

describe("moveSpanHandle", () => {
  it("moves the end handle without touching the start", () => {
    const draft = { routeId: "route_a", startIndex: 1, endIndex: 1 };
    const moved = moveSpanHandle(draft, LINE, "end", metres(400, 0));
    expect(moved).toEqual({ routeId: "route_a", startIndex: 1, endIndex: 4 });
  });

  it("moves the start handle past the end, keeping the range honest", () => {
    const draft = { routeId: "route_a", startIndex: 1, endIndex: 3 };
    const moved = moveSpanHandle(draft, LINE, "start", metres(400, 0));
    expect(moved).toEqual({ routeId: "route_a", startIndex: 4, endIndex: 3 });
    expect(spanRange(moved)).toEqual({ from: 3, to: 4 });
  });

  it("keeps the draft unchanged when the pointer resolves to nothing", () => {
    const draft = { routeId: "route_a", startIndex: 1, endIndex: 2 };
    expect(moveSpanHandle(draft, [], "end", metres(0, 0))).toEqual(draft);
  });
});

describe("nearestHandle", () => {
  it("grabs the handle the press is closest to", () => {
    const draft = { routeId: "route_a", startIndex: 1, endIndex: 3 };
    expect(nearestHandle(draft, LINE, metres(100, 0))).toBe("start");
    expect(nearestHandle(draft, LINE, metres(300, 0))).toBe("end");
  });

  it("always extends a one-vertex draft rather than moving its anchor", () => {
    const draft = { routeId: "route_a", startIndex: 2, endIndex: 2 };
    expect(nearestHandle(draft, LINE, metres(200, 0))).toBe("end");
  });
});

describe("spanDraftGeometry", () => {
  it("returns the line slice in draft order", () => {
    const geometry = spanDraftGeometry({ routeId: "r", startIndex: 1, endIndex: 3 }, LINE);
    expect(geometry).toEqual([LINE[1], LINE[2], LINE[3]]);
  });

  it("returns the reversed slice when the draft runs backwards", () => {
    const geometry = spanDraftGeometry({ routeId: "r", startIndex: 3, endIndex: 1 }, LINE);
    expect(geometry).toEqual([LINE[3], LINE[2], LINE[1]]);
  });

  it("returns nothing for an out-of-range draft", () => {
    expect(spanDraftGeometry({ routeId: "r", startIndex: 9, endIndex: 12 }, LINE)).toEqual([]);
  });
});

describe("spanDirectionFor", () => {
  it("declares forward when the draft follows the route's order", () => {
    expect(spanDirectionFor({ routeId: "r", startIndex: 1, endIndex: 3 }, LINE)).toBe(
      "forward",
    );
  });

  it("declares reverse when the draft runs against the route's order", () => {
    expect(spanDirectionFor({ routeId: "r", startIndex: 3, endIndex: 1 }, LINE)).toBe(
      "reverse",
    );
  });

  it("declares either only for a route that passes the span both ways", () => {
    const outAndBack: readonly Coordinate[] = [
      LINE[0]!,
      LINE[1]!,
      LINE[2]!,
      LINE[1]!,
      LINE[0]!,
    ];
    expect(spanDirectionFor({ routeId: "r", startIndex: 0, endIndex: 2 }, outAndBack)).toBe(
      "either",
    );
  });
});

describe("spanDraftAnchors", () => {
  it("reports entry then exit in draft order", () => {
    expect(spanDraftAnchors({ routeId: "r", startIndex: 3, endIndex: 1 }, LINE)).toEqual([
      LINE[3],
      LINE[1],
    ]);
  });
});
