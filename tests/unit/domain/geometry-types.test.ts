/**
 * Geometry payload validation (Task 1.4, 02-ARCHITECTURE-CONTRACT §4).
 *
 * The validator is the pure domain gate between "some payload arrived" and
 * "the GeometryStore may mint a handle for it". It reuses the ride
 * coordinate bounds and treats its input as untrusted: a payload that a typed
 * caller could never build still must be reported as an issue rather than
 * throwing or being accepted.
 */

import { describe, expect, it } from "vitest";

import {
  countGeometryPoints,
  validateGeometryPayload,
  type GeometryPayload,
} from "@/domain/geometry/types";
import type { Coordinate } from "@/domain/ride/types";

const BOGOTA: Coordinate = { lon: -74.07, lat: 4.71 };

function coordinate(index: number): Coordinate {
  return { lon: -74.07 + index * 1e-3, lat: 4.71 + index * 1e-3 };
}

function lineOf(length: number): GeometryPayload {
  return {
    kind: "line",
    coordinates: Array.from({ length }, (_, index) => coordinate(index)),
  };
}

/** A closed ring of `distinct + 1` points (last repeats the first). */
function closedRing(distinct: number): readonly Coordinate[] {
  const ring = Array.from({ length: distinct }, (_, index) => coordinate(index));
  return [...ring, ring[0] ?? BOGOTA];
}

describe("validateGeometryPayload — lines", () => {
  it("accepts a two-point line", () => {
    expect(validateGeometryPayload(lineOf(2))).toEqual([]);
  });

  it("accepts a long line", () => {
    expect(validateGeometryPayload(lineOf(500))).toEqual([]);
  });

  it("rejects a line with fewer than two points", () => {
    expect(validateGeometryPayload(lineOf(1)).join(" ")).toMatch(
      /at least 2 points/,
    );
    expect(validateGeometryPayload(lineOf(0)).join(" ")).toMatch(
      /at least 2 points/,
    );
  });

  it("reports a non-finite longitude", () => {
    const payload: GeometryPayload = {
      kind: "line",
      coordinates: [{ lon: Number.NaN, lat: 4.71 }, BOGOTA],
    };

    expect(validateGeometryPayload(payload).join(" ")).toMatch(/longitude/);
  });

  it("reports an out-of-range latitude", () => {
    const payload: GeometryPayload = {
      kind: "line",
      coordinates: [{ lon: -74.07, lat: Number.POSITIVE_INFINITY }, BOGOTA],
    };

    expect(validateGeometryPayload(payload).join(" ")).toMatch(/latitude/);
  });

  it("anchors each issue to its coordinate index", () => {
    const payload: GeometryPayload = {
      kind: "line",
      coordinates: [BOGOTA, { lon: 200, lat: 4.71 }],
    };

    expect(validateGeometryPayload(payload).join(" ")).toContain("coordinates[1]");
  });
});

describe("validateGeometryPayload — polygons", () => {
  it("accepts a closed outer ring", () => {
    const payload: GeometryPayload = { kind: "polygon", rings: [closedRing(3)] };

    expect(validateGeometryPayload(payload)).toEqual([]);
  });

  it("accepts multiple closed rings (outer ring first)", () => {
    const payload: GeometryPayload = {
      kind: "polygon",
      rings: [closedRing(4), closedRing(3)],
    };

    expect(validateGeometryPayload(payload)).toEqual([]);
  });

  it("rejects a polygon without any ring", () => {
    const payload: GeometryPayload = { kind: "polygon", rings: [] };

    expect(validateGeometryPayload(payload).join(" ")).toMatch(/at least one ring/);
  });

  it("rejects a ring with fewer than three points", () => {
    const payload: GeometryPayload = {
      kind: "polygon",
      rings: [
        [
          { lon: -74.07, lat: 4.71 },
          { lon: -74.06, lat: 4.72 },
        ],
      ],
    };

    expect(validateGeometryPayload(payload).join(" ")).toMatch(
      /at least 3 points/,
    );
  });

  it("rejects an unclosed ring", () => {
    const payload: GeometryPayload = {
      kind: "polygon",
      rings: [closedRing(3).slice(0, 3)],
    };

    expect(validateGeometryPayload(payload).join(" ")).toMatch(/closed/);
  });

  it("reports coordinates inside a bad ring", () => {
    const ring = closedRing(3);
    const broken: readonly Coordinate[] = [
      ring[0] ?? BOGOTA,
      { lon: -181, lat: 4.71 },
      ring[2] ?? BOGOTA,
    ];
    const payload: GeometryPayload = { kind: "polygon", rings: [broken] };

    expect(validateGeometryPayload(payload).join(" ")).toContain("rings[0].coordinates[1]");
  });
});

describe("validateGeometryPayload — untrusted input", () => {
  it("reports a payload that is not an object instead of throwing", () => {
    expect(
      validateGeometryPayload(null as unknown as GeometryPayload).join(" "),
    ).toMatch(/plain object/);
  });

  it("reports an unknown payload kind instead of throwing", () => {
    const payload = { kind: "surface" } as unknown as GeometryPayload;

    expect(validateGeometryPayload(payload).join(" ")).toMatch(
      /not a known payload kind/,
    );
  });

  it("reports a missing coordinate list instead of throwing", () => {
    const payload = { kind: "line" } as unknown as GeometryPayload;

    expect(validateGeometryPayload(payload).join(" ")).toMatch(
      /coordinates must be an array/,
    );
  });

  it("reports a malformed coordinate instead of throwing", () => {
    const payload = {
      kind: "line",
      coordinates: [null, BOGOTA],
    } as unknown as GeometryPayload;

    expect(validateGeometryPayload(payload).join(" ")).toMatch(/coordinate/);
  });

  it("never throws on a frozen invalid payload", () => {
    const payload = Object.freeze({
      kind: "polygon",
      rings: Object.freeze([Object.freeze([BOGOTA])]),
    }) as unknown as GeometryPayload;

    expect(() => validateGeometryPayload(payload)).not.toThrow();
    expect(validateGeometryPayload(payload).length).toBeGreaterThan(0);
  });
});

describe("countGeometryPoints", () => {
  it("counts a line's coordinates", () => {
    expect(countGeometryPoints(lineOf(3))).toBe(3);
  });

  it("counts every coordinate of every ring, closing duplicate included", () => {
    const payload: GeometryPayload = {
      kind: "polygon",
      rings: [closedRing(4), closedRing(3)],
    };

    expect(countGeometryPoints(payload)).toBe(5 + 4);
  });
});
