import { describe, expect, it } from "vitest";

import {
  POLYGON_DOUBLE_TAP_METERS,
  POLYGON_DOUBLE_TAP_MS,
  applyPolygonTap,
  closePolygonDraft,
  draftPreviewRing,
  popPolygonVertex,
} from "@/application/planner/avoid-area-draft";
import type { Coordinate } from "@/domain/ride/types";

/**
 * The polygon draft lifecycle (04 §18).
 *
 * The rules under test are the ones that decide whether a gesture authors
 * something: a tap adds a vertex, a double-click closes, Backspace removes the
 * last one, a close that cannot form an area says so, and nothing here writes or
 * dispatches anything.
 */

const BASE: Coordinate = { lon: -75.44, lat: 40.14 };
const ONE_METER_LAT = 1 / 111_320;
const ONE_METER_LON = 1 / (111_320 * Math.cos((BASE.lat * Math.PI) / 180));

function metres(lonMeters: number, latMeters: number): Coordinate {
  return {
    lon: BASE.lon + lonMeters * ONE_METER_LON,
    lat: BASE.lat + latMeters * ONE_METER_LAT,
  };
}

describe("applyPolygonTap", () => {
  it("adds the first vertex", () => {
    const outcome = applyPolygonTap([], metres(0, 0), null, 1_000);
    expect(outcome.kind).toBe("vertex");
    if (outcome.kind !== "vertex") return;
    expect(outcome.vertices).toHaveLength(1);
    expect(outcome.vertices[0]).toEqual(metres(0, 0));
    expect(outcome.lastTap).toEqual({ coordinate: metres(0, 0), at: 1_000 });
  });

  it("adds each tap as its own vertex", () => {
    const first = applyPolygonTap([], metres(0, 0), null, 0);
    if (first.kind !== "vertex") throw new Error(first.kind);
    const second = applyPolygonTap(first.vertices, metres(200, 0), first.lastTap, 500);
    if (second.kind !== "vertex") throw new Error(second.kind);

    expect(second.vertices).toEqual([metres(0, 0), metres(200, 0)]);
  });

  it("closes on a second tap in the same place, without storing a duplicate", () => {
    const vertices = [metres(0, 0), metres(200, 0), metres(200, 200)];
    const outcome = applyPolygonTap(
      vertices,
      metres(1, 1),
      { coordinate: metres(0, 0), at: 1_000 },
      1_000 + POLYGON_DOUBLE_TAP_MS - 50,
    );

    expect(outcome.kind).toBe("close");
    // The duplicate tap is the rider saying "close", not a fourth corner.
    expect(outcome.vertices).toEqual(vertices);
  });

  it("does not close on two fast taps in different places", () => {
    const vertices = [metres(0, 0), metres(200, 0)];
    const outcome = applyPolygonTap(
      vertices,
      metres(POLYGON_DOUBLE_TAP_METERS + 200, 0),
      { coordinate: metres(0, 0), at: 1_000 },
      1_050,
    );

    expect(outcome.kind).toBe("vertex");
  });

  it("does not close on two slow taps in the same place", () => {
    const vertices = [metres(0, 0), metres(200, 0)];
    const outcome = applyPolygonTap(
      vertices,
      metres(0, 0),
      { coordinate: metres(0, 0), at: 1_000 },
      1_000 + POLYGON_DOUBLE_TAP_MS + 50,
    );

    expect(outcome.kind).toBe("vertex");
  });

  it("refuses to close a draft with fewer than three corners, and keeps the draft", () => {
    const vertices = [metres(0, 0), metres(200, 0)];
    const outcome = applyPolygonTap(
      vertices,
      metres(0, 0),
      { coordinate: metres(0, 0), at: 1_000 },
      1_050,
    );

    expect(outcome.kind).toBe("too-few");
    if (outcome.kind !== "too-few") return;
    expect(outcome.message).toMatch(/at least 3 corners/i);
    expect(outcome.vertices).toEqual(vertices);
  });

  it("measures the double-tap distance in metres, not degrees", () => {
    // ~1e-5 degrees of longitude is ~0.85 m here: comfortably inside the window.
    const near = { lon: BASE.lon + 1e-5, lat: BASE.lat };
    const outcome = applyPolygonTap(
      [metres(0, 0), metres(200, 0), metres(200, 200)],
      near,
      { coordinate: BASE, at: 1_000 },
      1_100,
    );
    expect(outcome.kind).toBe("close");
  });
});

describe("closePolygonDraft", () => {
  it("returns a ring closed on its first vertex", () => {
    const result = closePolygonDraft([metres(0, 0), metres(200, 0), metres(200, 200)]);
    expect(result.ring).toHaveLength(4);
    expect(result.ring?.[3]).toEqual(metres(0, 0));
  });

  it("does not alias the draft's coordinates", () => {
    const vertices = [metres(0, 0), metres(200, 0), metres(200, 200)];
    const result = closePolygonDraft(vertices);
    expect(result.ring?.[0]).not.toBe(vertices[0]);
  });

  it("refuses two corners", () => {
    const result = closePolygonDraft([metres(0, 0), metres(200, 0)]);
    expect(result.ring).toBeNull();
  });
});

describe("draftPreviewRing", () => {
  it("closes the draft so the rider sees the shape they would get", () => {
    expect(draftPreviewRing([metres(0, 0), metres(200, 0)])).toHaveLength(3);
  });

  it("previews nothing for a single vertex", () => {
    expect(draftPreviewRing([metres(0, 0)])).toBeNull();
    expect(draftPreviewRing([])).toBeNull();
  });
});

describe("popPolygonVertex", () => {
  it("removes the last vertex", () => {
    expect(
      popPolygonVertex([metres(0, 0), metres(200, 0), metres(200, 200)]),
    ).toEqual([metres(0, 0), metres(200, 0)]);
  });

  it("keeps an empty draft empty", () => {
    expect(popPolygonVertex([])).toEqual([]);
  });

  it("does not alias the input", () => {
    const vertices = [metres(0, 0), metres(200, 0)];
    expect(popPolygonVertex(vertices)).not.toBe(vertices);
  });
});
