import { describe, expect, it } from "vitest";

import {
  MIN_AVOID_AREA_SPAN_METERS,
  ON_EDGE_EPSILON_METERS,
  VERTEX_HANDLE_HIT_RADIUS_METERS,
  moveRingVertex,
  nearestVertexHandle,
  pointInRing,
  rectangleRing,
  ringAreaSquareMeters,
  ringSelfIntersects,
  ringVertexHandles,
  translateRings,
  validateAvoidAreaRings,
} from "@/application/planner/avoid-area-geometry";
import type { Coordinate } from "@/domain/ride/types";

/**
 * The pure avoid-area geometry (04 §18, 05 §21, 03 §11).
 *
 * Every assertion here is about a rule the rider can see: a rectangle drag
 * produces a closed ring, a whole-area move translates every ring, a vertex move
 * touches exactly one vertex, and a ring that cannot be stored is rejected with a
 * reason instead of being written and half-drawn.
 */

const BASE: Coordinate = { lon: -75.44, lat: 40.14 };

/** ~111 m of latitude, and ~85 m of longitude at this latitude. */
const ONE_METER_LAT = 1 / 111_320;
const ONE_METER_LON = 1 / (111_320 * Math.cos((BASE.lat * Math.PI) / 180));

function metres(lonMeters: number, latMeters: number): Coordinate {
  return {
    lon: BASE.lon + lonMeters * ONE_METER_LON,
    lat: BASE.lat + latMeters * ONE_METER_LAT,
  };
}

/** A 200 m × 200 m square, closed. */
function square(westLonMeters = 0, southLatMeters = 0, sizeMeters = 200): readonly Coordinate[] {
  const southWest = metres(westLonMeters, southLatMeters);
  const northEast = metres(westLonMeters + sizeMeters, southLatMeters + sizeMeters);
  return rectangleRing(southWest, northEast);
}

describe("rectangleRing", () => {
  it("closes the ring with the first vertex and keeps four corners", () => {
    const origin = metres(0, 0);
    const corner = metres(300, 200);
    const ring = rectangleRing(origin, corner);

    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(origin);
    expect(ring[4]).toEqual(origin);
    // The two unstated corners are the two mixed pairs, so the rectangle is
    // axis-aligned in lon/lat rather than a diamond.
    expect(ring[1]).toEqual({ lon: corner.lon, lat: origin.lat });
    expect(ring[2]).toEqual(corner);
    expect(ring[3]).toEqual({ lon: origin.lon, lat: corner.lat });
  });

  it("normalizes a drag in any direction to the same ring", () => {
    const forward = rectangleRing(metres(0, 0), metres(100, 100));
    const backward = rectangleRing(metres(100, 100), metres(0, 0));
    expect(backward).toEqual(forward);
  });

  it("rejects a drag smaller than the minimum authored span", () => {
    const ring = rectangleRing(metres(0, 0), metres(MIN_AVOID_AREA_SPAN_METERS / 2, 400));
    expect(
      validateAvoidAreaRings([ring], { minSpanMeters: MIN_AVOID_AREA_SPAN_METERS }),
    ).toMatch(/too small/i);
  });

  it("accepts a drag at the documented minimum span", () => {
    const ring = rectangleRing(
      metres(0, 0),
      metres(MIN_AVOID_AREA_SPAN_METERS, MIN_AVOID_AREA_SPAN_METERS),
    );
    expect(
      validateAvoidAreaRings([ring], { minSpanMeters: MIN_AVOID_AREA_SPAN_METERS }),
    ).toBeNull();
  });
});

describe("ringAreaSquareMeters", () => {
  it("measures a 200 m square as ~40000 m²", () => {
    expect(ringAreaSquareMeters(square())).toBeCloseTo(40_000, -2);
  });

  it("is orientation-independent for a projected ring", () => {
    const clockwise = square();
    const counterClockwise = rectangleRing(metres(400, 0), metres(200, 200));
    expect(ringAreaSquareMeters(clockwise)).toBeCloseTo(
      ringAreaSquareMeters(counterClockwise),
      -1,
    );
  });
});

describe("ringSelfIntersects", () => {
  it("accepts a convex ring", () => {
    expect(ringSelfIntersects(square())).toBe(false);
  });

  it("rejects a ring whose edges cross", () => {
    // A bow-tie: [A, B, C, D, A] with the B–C edge crossing the D–A edge.
    const a = metres(0, 0);
    const b = metres(200, 200);
    const c = metres(200, 0);
    const d = metres(0, 200);
    expect(ringSelfIntersects([a, b, c, d, a])).toBe(true);
  });

  it("accepts a ring that only touches itself at the repeated first vertex", () => {
    const ring = square();
    expect(ringSelfIntersects(ring)).toBe(false);
  });
});

describe("validateAvoidAreaRings", () => {
  it("rejects fewer than three distinct vertices", () => {
    const a = metres(0, 0);
    const b = metres(200, 0);
    expect(validateAvoidAreaRings([[a, b, a]])).toMatch(/at least three/i);
  });

  it("rejects a ring that is not closed", () => {
    const [a, b, c] = square();
    expect(validateAvoidAreaRings([[a!, b!, c!]])).toMatch(/closed/i);
  });

  it("rejects an empty ring list", () => {
    expect(validateAvoidAreaRings([])).toMatch(/at least one ring/i);
  });

  it("accepts a validated square", () => {
    expect(validateAvoidAreaRings([square()])).toBeNull();
  });

  it("accepts a thin strip without the rectangle tool's span rule", () => {
    // A rider avoiding 200 m of road draws a 15 m-wide polygon; the area is well
    // over the minimum, so only the *rectangle* tool's two-axis rule could
    // reject it — and that rule is deliberately not applied here.
    const strip = rectangleRing(metres(0, 0), metres(15, 200));
    expect(validateAvoidAreaRings([strip])).toBeNull();
    expect(
      validateAvoidAreaRings([strip], { minSpanMeters: MIN_AVOID_AREA_SPAN_METERS }),
    ).toMatch(/too small/i);
  });

  it("rejects two corners in the same place", () => {
    const [a] = square();
    const b = metres(200, 0);
    expect(validateAvoidAreaRings([[a!, a!, b!, a!]])).toMatch(/same place/i);
  });
});

describe("translateRings", () => {
  it("moves every vertex of every ring by the delta", () => {
    const rings = [square(), square(500, 500)];
    const delta = metres(25, -15);
    const moved = translateRings(rings, delta);

    expect(moved).toHaveLength(2);
    for (const [index, ring] of rings.entries()) {
      expect(moved[index]).toHaveLength(ring.length);
      ring.forEach((vertex, vertexIndex) => {
        expect(moved[index]![vertexIndex]).toEqual({
          lon: vertex.lon + delta.lon,
          lat: vertex.lat + delta.lat,
        });
      });
    }
  });

  it("does not alias the input coordinates", () => {
    const rings = [square()];
    const moved = translateRings(rings, metres(10, 10));
    expect(moved[0]![0]).not.toBe(rings[0]![0]);
  });

  it("keeps a translated ring valid", () => {
    const moved = translateRings([square()], metres(120, 90));
    expect(validateAvoidAreaRings(moved)).toBeNull();
  });
});

describe("moveRingVertex", () => {
  it("moves exactly one vertex and re-closes the ring", () => {
    const rings = [square()];
    const target = metres(1000, 1000);
    const moved = moveRingVertex(rings, 0, 1, target);

    expect(moved[0]).toHaveLength(5);
    expect(moved[0]![1]).toEqual(target);
    // The other three corners are untouched.
    expect(moved[0]![0]).toEqual(rings[0]![0]);
    expect(moved[0]![2]).toEqual(rings[0]![2]);
    expect(moved[0]![3]).toEqual(rings[0]![3]);
    // The closing vertex still repeats the first one.
    expect(moved[0]![4]).toEqual(moved[0]![0]);
  });

  it("moves the closing duplicate together with vertex 0", () => {
    const moved = moveRingVertex([square()], 0, 0, metres(777, 777));
    expect(moved[0]![4]).toEqual(moved[0]![0]);
    expect(moved[0]![0]).toEqual(metres(777, 777));
  });

  it("leaves the rings alone for an out-of-range index", () => {
    const rings = [square()];
    expect(moveRingVertex(rings, 3, 0, metres(0, 0))).toEqual(rings);
    expect(moveRingVertex(rings, 0, 99, metres(0, 0))).toEqual(rings);
  });

  it("exposes a self-intersecting result as invalid rather than hiding it", () => {
    // The south-east corner is dragged across the ring's own south-west corner,
    // so two non-adjacent edges cross: a pinch the validator refuses.
    const moved = moveRingVertex([square()], 0, 1, metres(-100, 100));
    expect(validateAvoidAreaRings(moved)).toMatch(/crosses itself/i);
  });
});

describe("ringVertexHandles", () => {
  it("offers one handle per distinct vertex, never the closing duplicate", () => {
    const handles = ringVertexHandles([square()], 0);
    expect(handles).toHaveLength(4);
    expect(handles.map((handle) => handle.vertexIndex)).toEqual([0, 1, 2, 3]);
    expect(handles.every((handle) => handle.ringIndex === 0)).toBe(true);
  });

  it("offers handles for every ring, addressed by ring index", () => {
    const handles = ringVertexHandles([square(), square(500, 500)], 1);
    expect(handles).toHaveLength(4);
    expect(handles.filter((handle) => handle.ringIndex === 1)).toHaveLength(4);
  });
});

describe("nearestVertexHandle", () => {
  it("finds the vertex a grab was aimed at", () => {
    const rings = [square()];
    const near = metres(8, 6);
    const handle = nearestVertexHandle(rings, near, VERTEX_HANDLE_HIT_RADIUS_METERS);
    expect(handle?.vertexIndex).toBe(0);
  });

  it("returns null outside the handle radius, so the gesture moves nothing", () => {
    // The centre of a 200 m square is ~141 m from every corner: beyond the
    // documented radius, and the answer is "no handle", never a guessed one.
    const handle = nearestVertexHandle(
      [square()],
      metres(100, 100),
      VERTEX_HANDLE_HIT_RADIUS_METERS,
    );
    expect(handle).toBeNull();
  });

  it("picks the nearer of two candidate vertices", () => {
    const rings = [square()];
    const handle = nearestVertexHandle(rings, metres(198, 4), VERTEX_HANDLE_HIT_RADIUS_METERS);
    expect(handle?.vertexIndex).toBe(1);
  });
});

describe("pointInRing", () => {
  it("counts a point well inside as inside", () => {
    expect(pointInRing(metres(100, 100), square())).toBe(true);
  });

  it("counts a point well outside as outside", () => {
    expect(pointInRing(metres(400, 400), square())).toBe(false);
  });

  it("counts a point exactly on the ring as inside, within the documented epsilon", () => {
    const onEdge = metres(100, 0);
    expect(pointInRing(onEdge, square())).toBe(true);
  });

  it("counts a point just inside the epsilon as inside", () => {
    const justInside = metres(100, ON_EDGE_EPSILON_METERS * 0.5);
    expect(pointInRing(justInside, square())).toBe(true);
  });

  it("counts a point beyond the epsilon on the outside as outside", () => {
    // 250 m south of the ring: the epsilon must not grow into a tolerance band.
    expect(pointInRing(metres(100, -250), square())).toBe(false);
  });

  it("counts a vertex as inside", () => {
    expect(pointInRing(metres(0, 0), square())).toBe(true);
  });

  it("is total for a degenerate ring", () => {
    expect(pointInRing(metres(0, 0), [])).toBe(false);
  });
});
