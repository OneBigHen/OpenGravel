/**
 * Road-span status against the committed route (04 §17, 05 §20, 03 §17).
 *
 * The panel's whole job is honesty: every row's verdict is measured by Task
 * 4.3a's engine against the **returned** route, and a span whose stored line
 * could not be resolved reads `unavailable` — never a fabricated conflict and
 * never a fabricated pass.
 */

import { describe, expect, it } from "vitest";

import {
  buildRoadSpanStatusRows,
  ROAD_SPAN_CONFLICT_COPY,
  ROAD_SPAN_STATUS_LABELS,
  roadSpanStatusIsWarning,
} from "@/application/planner/road-span-status";
import type { GeometryPayload } from "@/domain/geometry/types";
import type { GeometryRef } from "@/domain/ride/ids";
import { asGeometryRef, asRoadSpanId } from "@/domain/ride/ids";
import type { Coordinate, RoadSpanConstraint } from "@/domain/ride/types";

const BASE: Coordinate = { lon: -75.44, lat: 40.14 };
const ONE_METER_LAT = 1 / 111_320;
const ONE_METER_LON = 1 / (111_320 * Math.cos((BASE.lat * Math.PI) / 180));

function metres(east: number, north: number): Coordinate {
  return {
    lon: BASE.lon + east * ONE_METER_LON,
    lat: BASE.lat + north * ONE_METER_LAT,
  };
}

/** The route the plan returned: a straight east-west line, 500 m long. */
const ROUTE: readonly Coordinate[] = [metres(0, 0), metres(250, 0), metres(500, 0)];

/** The span that lies on the route. */
const ON_ROUTE: readonly Coordinate[] = [metres(50, 0), metres(250, 0)];

function span(
  overrides: Partial<RoadSpanConstraint> = {},
): RoadSpanConstraint {
  return {
    id: asRoadSpanId("span_1"),
    mode: "must",
    direction: "forward",
    geometryRef: asGeometryRef("geo_1"),
    anchorRefs: [metres(50, 0), metres(250, 0)],
    ...overrides,
  };
}

function geometryFor(
  ref: GeometryRef,
  line: readonly Coordinate[],
): (requested: GeometryRef) => GeometryPayload | null {
  return (requested) =>
    requested === ref ? { kind: "line", coordinates: line } : null;
}

function rowsFor(
  spans: readonly RoadSpanConstraint[],
  route: readonly Coordinate[] = ROUTE,
  readGeometry: (ref: GeometryRef) => GeometryPayload | null = geometryFor(
    asGeometryRef("geo_1"),
    ON_ROUTE,
  ),
): ReturnType<typeof buildRoadSpanStatusRows> {
  return buildRoadSpanStatusRows({ spans, routeGeometry: route, readGeometry });
}

describe("buildRoadSpanStatusRows", () => {
  it("reports satisfied for a required span the route covers", () => {
    const rows = rowsFor([span()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("satisfied");
    expect(rows[0]?.geometryResolved).toBe(true);
    expect(rows[0]?.mode).toBe("must");
    expect(rows[0]?.direction).toBe("forward");
  });

  it("reports conflict for a required span the route never enters", () => {
    const far = [metres(0, 500), metres(250, 500)];
    const rows = rowsFor([span()], ROUTE, geometryFor(asGeometryRef("geo_1"), far));
    expect(rows[0]?.status).toBe("conflict");
    expect(roadSpanStatusIsWarning(rows[0]!)).toBe(true);
    expect(ROAD_SPAN_STATUS_LABELS.conflict).toBe("Conflict");
  });

  it("reports conflict for an avoid span the route enters", () => {
    const rows = rowsFor([span({ mode: "avoid" })]);
    expect(rows[0]?.status).toBe("conflict");
  });

  it("reports satisfied for an avoid span the route stays out of", () => {
    const far = [metres(0, 500), metres(250, 500)];
    const rows = rowsFor([span({ mode: "avoid" })], ROUTE, geometryFor(asGeometryRef("geo_1"), far));
    expect(rows[0]?.status).toBe("satisfied");
  });

  it("reports partially-satisfied for a preferred span only partly used", () => {
    const partial = [metres(50, 0), metres(400, 300)];
    const rows = rowsFor([span({ mode: "prefer" })], ROUTE, geometryFor(asGeometryRef("geo_1"), partial));
    expect(rows[0]?.status).toBe("partially-satisfied");
    expect(roadSpanStatusIsWarning(rows[0]!)).toBe(false);
  });

  it("reports unavailable — never conflict — when the span line did not resolve", () => {
    const rows = rowsFor([span()], ROUTE, () => null);
    expect(rows[0]?.status).toBe("unavailable");
    expect(rows[0]?.geometryResolved).toBe(false);
    expect(rows[0]?.note).toBeTruthy();
  });

  it("reports unavailable for a required span whose direction cannot be read", () => {
    // The anchors are nowhere near the returned line, so the covered span's
    // direction is unverifiable rather than wrong-way.
    const rows = rowsFor(
      [span({ anchorRefs: [metres(0, 900), metres(250, 900)] })],
      ROUTE,
      geometryFor(asGeometryRef("geo_1"), ON_ROUTE),
    );
    expect(rows[0]?.status).toBe("unavailable");
  });

  it("evaluates every span, in author order, against one route", () => {
    const rows = rowsFor(
      [
        span({ id: asRoadSpanId("span_a") }),
        span({
          id: asRoadSpanId("span_b"),
          mode: "prefer",
          geometryRef: asGeometryRef("geo_2"),
        }),
      ],
      ROUTE,
      (ref) =>
        ref === asGeometryRef("geo_1")
          ? { kind: "line", coordinates: ON_ROUTE }
          : { kind: "line", coordinates: [metres(0, 500), metres(250, 500)] },
    );
    expect(rows.map((row) => row.id)).toEqual(["span_a", "span_b"]);
    expect(rows.map((row) => row.status)).toEqual(["satisfied", "conflict"]);
  });

  it("reports unavailable when the committed route has no usable geometry", () => {
    const rows = rowsFor([span()], [metres(0, 0)]);
    expect(rows[0]?.status).toBe("unavailable");
  });
});

describe("road span copy", () => {
  it("uses the required conflict wording for a failed required span", () => {
    const rows = rowsFor([span()], ROUTE, geometryFor(asGeometryRef("geo_1"), [metres(0, 500), metres(250, 500)]));
    expect(ROAD_SPAN_CONFLICT_COPY).toBe("Route does not satisfy this road");
    expect(rows[0]?.mode).toBe("must");
  });
});
