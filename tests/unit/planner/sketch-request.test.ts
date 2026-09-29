import { describe, expect, it } from "vitest";

import {
  buildProviderRequest,
  type PlanRequestContext,
} from "@/application/planner/build-plan-request";
import {
  MAX_PROVIDER_SKETCH_ANCHORS,
  MAX_PROVIDER_SKETCH_CORRIDOR_POINTS,
} from "@/application/planner/route-provider";
import { buildSketchCorridor } from "@/application/planner/sketch-corridor";
import type { GeometryPayload } from "@/domain/geometry/types";
import { asGeometryRef, asSketchId, type GeometryRef } from "@/domain/ride/ids";
import { defaultRideIntent } from "@/domain/ride/create";
import type { Coordinate, RideIntent, SketchIntent } from "@/domain/ride/types";

/**
 * The sketch's half of the provider request (06 §18, 04 §19; Task 4.4).
 *
 * The request is where "the drawing is intent, not geometry" has to be visible: the
 * corridor is sampled into bounded routing anchors, the topology travels with it so
 * the server can measure adherence, and the endpoint policy decides which endpoints
 * the engine is asked to connect.
 */

const ORIGIN: Coordinate = { lon: -75.44, lat: 40.14 };
const METERS_PER_DEGREE_LAT = 111_320;
const METERS_PER_DEGREE_LON = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

function at(east: number, north: number): Coordinate {
  return {
    lon: ORIGIN.lon + east / METERS_PER_DEGREE_LON,
    lat: ORIGIN.lat + north / METERS_PER_DEGREE_LAT,
  };
}

function line(
  fromEast: number,
  fromNorth: number,
  toEast: number,
  toNorth: number,
  steps = 40,
): Coordinate[] {
  const points: Coordinate[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const ratio = index / steps;
    points.push(
      at(
        fromEast + (toEast - fromEast) * ratio,
        fromNorth + (toNorth - fromNorth) * ratio,
      ),
    );
  }
  return points;
}

const STROKE_A = line(0, 0, 2_000, 0);
const STROKE_B = line(1_000, -500, 1_000, 500);
const CORRIDOR = buildCorridor();

function buildCorridor(): Coordinate[] {
  // The same crossing trace, joined the way the builder would.
  return [...STROKE_A, ...STROKE_B];
}

const STROKE_REF = asGeometryRef("geo_stroke_a");
const STROKE_B_REF = asGeometryRef("geo_stroke_b");
const CORRIDOR_REF = asGeometryRef("geo_corridor");

function sketchIntent(overrides: Partial<SketchIntent> = {}): SketchIntent {
  return {
    id: asSketchId("sketch_1"),
    rawStrokeRefs: [STROKE_REF, STROKE_B_REF],
    corridorRef: CORRIDOR_REF,
    topologyHints: [
      { kind: "crossing", at: at(1_000, 0), strokeIndices: [0, 1] },
    ],
    endpointPolicy: "derive",
    ...overrides,
  };
}

function payload(coordinates: readonly Coordinate[]): GeometryPayload {
  return { kind: "line", coordinates: coordinates.map((point) => ({ ...point })) };
}

function context(
  sketch: SketchIntent | null,
  overrides: Partial<Pick<RideIntent, "start" | "finish" | "shape">> = {},
): PlanRequestContext {
  const geometry = new Map<string, GeometryPayload>([
    [STROKE_REF, payload(STROKE_A)],
    [STROKE_B_REF, payload(STROKE_B)],
    [CORRIDOR_REF, payload(CORRIDOR)],
  ]);
  void sketch;
  void overrides;
  return {
    resolveGeometry: (ref: GeometryRef): GeometryPayload | null =>
      geometry.get(ref) ?? null,
  };
}

function intentWith(
  sketch: SketchIntent | null,
  overrides: Partial<RideIntent> = {},
): RideIntent {
  return { ...defaultRideIntent(), sketch, ...overrides };
}

describe("buildProviderRequest — sketch corridor", () => {
  it("samples the corridor into bounded, shape-aware anchors", async () => {
    const result = await buildProviderRequest(
      intentWith(sketchIntent()),
      context(sketchIntent()),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sketch = result.request.sketch;
    expect(sketch, "the request carries the sketch").toBeDefined();
    expect(sketch?.anchors.length).toBeLessThanOrEqual(MAX_PROVIDER_SKETCH_ANCHORS);
    expect(sketch?.anchors.length).toBeGreaterThan(2);
    expect(sketch?.anchors[0]).toEqual(STROKE_A[0]);
    expect(sketch?.anchors.at(-1)).toEqual(STROKE_B.at(-1));
    // Arc-length placement, not vertex order: consecutive gaps stay close.
    const gaps = (sketch?.anchors ?? []).slice(1).map((point, index) => {
      const previous = sketch?.anchors[index];
      if (previous === undefined) return 0;
      return Math.hypot(
        (point.lon - previous.lon) * METERS_PER_DEGREE_LON,
        (point.lat - previous.lat) * METERS_PER_DEGREE_LAT,
      );
    });
    expect(Math.max(...gaps) / Math.min(...gaps)).toBeLessThan(2.5);
  });

  it("carries the topology, the near-loop verdict and the endpoint policy", async () => {
    // A drawn loop that stops 11 m from where it started.
    const loopStroke = [...line(0, 0, 300, 0), at(10, 5)];
    const intent = intentWith(
      sketchIntent({
        rawStrokeRefs: [STROKE_REF],
        topologyHints: [],
        endpointPolicy: "preserve-existing",
      }),
    );
    const request = await buildProviderRequest(intent, {
      resolveGeometry: (ref: GeometryRef): GeometryPayload | null =>
        ref === STROKE_REF ? payload(loopStroke) : null,
    });

    expect(request.ok).toBe(true);
    if (!request.ok) return;
    expect(request.request.sketch?.endpointPolicy).toBe("preserve-existing");
    expect(request.request.sketch?.nearLoop).toBe(true);
    expect(request.request.sketch?.topologyHints).toContainEqual({
      kind: "near-loop",
      at: loopStroke[0],
      strokeIndices: [0],
    });
  });

  it("falls back to the committed hints when the raw strokes no longer resolve", async () => {
    const intent = intentWith(
      sketchIntent({
        topologyHints: [{ kind: "near-loop", at: CORRIDOR[0] as Coordinate }],
      }),
    );
    const request = await buildProviderRequest(intent, {
      resolveGeometry: (ref: GeometryRef): GeometryPayload | null =>
        ref === CORRIDOR_REF ? payload(CORRIDOR) : null,
    });

    expect(request.ok).toBe(true);
    if (!request.ok) return;
    expect(request.request.sketch?.nearLoop).toBe(true);
    expect(request.request.sketch?.derivedEndpoints).toEqual({
      start: CORRIDOR[0],
      finish: CORRIDOR.at(-1),
    });
    // Both raw strokes are reported, never silently ignored.
    expect([...request.unresolvedRefs].sort()).toEqual([STROKE_REF, STROKE_B_REF].sort());
  });

  it("derives both endpoints from the trace when the ride has none", async () => {
    const result = await buildProviderRequest(
      intentWith(sketchIntent()),
      context(sketchIntent()),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.origin).toEqual(CORRIDOR[0]);
    expect(result.request.destination).toEqual(CORRIDOR.at(-1));
    expect(result.request.sketch?.derivedEndpoints).toEqual({
      start: CORRIDOR[0],
      finish: CORRIDOR.at(-1),
    });
  });

  it("keeps the authored endpoints as fixed ends under preserve-existing", async () => {
    const start: Coordinate = at(-5_000, -5_000);
    const finish: Coordinate = at(5_000, 5_000);
    const intent = intentWith(sketchIntent({ endpointPolicy: "preserve-existing" }), {
      start: {
        id: "pt_start" as never,
        kind: "start",
        coordinate: start,
        provenance: { type: "map", selectedAt: "2026-09-17T00:00:00.000Z" },
      },
      finish: {
        id: "pt_finish" as never,
        kind: "finish",
        coordinate: finish,
        provenance: { type: "map", selectedAt: "2026-09-17T00:00:00.000Z" },
      },
    });

    const result = await buildProviderRequest(intent, context(intent.sketch));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.origin).toEqual(start);
    expect(result.request.destination).toEqual(finish);
    // The derived endpoints still travel: they are what the trace itself says.
    expect(result.request.sketch?.derivedEndpoints?.start).toEqual(CORRIDOR[0]);
  });

  it("lets the trace derive the endpoint the ride is missing under preserve-existing", async () => {
    const start: Coordinate = at(-5_000, -5_000);
    const intent = intentWith(sketchIntent({ endpointPolicy: "preserve-existing" }), {
      start: {
        id: "pt_start" as never,
        kind: "start",
        coordinate: start,
        provenance: { type: "map", selectedAt: "2026-09-17T00:00:00.000Z" },
      },
    });

    const result = await buildProviderRequest(intent, context(intent.sketch));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.origin).toEqual(start);
    expect(result.request.destination).toEqual(CORRIDOR.at(-1));
  });

  it("re-derives from the raw trace rather than trusting the stored corridor", async () => {
    // A stored corridor that is one long straight connector between two strokes
    // 100 m apart must not become the request's line: the raw trace is the
    // authority (04 §19), so the corridor is built from it every time.
    const a = line(0, 0, 200, 0, 8);
    const b = line(300, 0, 500, 0, 8);
    const intent = intentWith(
      sketchIntent({ rawStrokeRefs: [STROKE_REF, STROKE_B_REF] }),
    );
    const result = await buildProviderRequest(intent, {
      resolveGeometry: (ref: GeometryRef): GeometryPayload | null => {
        if (ref === STROKE_REF) return payload(a);
        if (ref === STROKE_B_REF) return payload(b);
        // The committed corridor is a fabricated straight line through the gap.
        if (ref === CORRIDOR_REF) return payload([a[0] as Coordinate, b.at(-1) as Coordinate]);
        return null;
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const anchors = result.request.sketch?.anchors ?? [];
    // The anchors span both real strokes and do not shortcut the 100 m gap.
    expect(anchors).toContainEqual(a[0]);
    expect(anchors).toContainEqual(b.at(-1));
    expect(anchors.some((point) => Math.abs(point.lon - at(250, 0).lon) < 1e-6)).toBe(false);
  });

  it("reports an unresolved corridor instead of fabricating anchors", async () => {
    const start: Coordinate = at(-5_000, 0);
    const finish: Coordinate = at(5_000, 0);
    const intent = intentWith(sketchIntent(), {
      start: {
        id: "pt_start" as never,
        kind: "start",
        coordinate: start,
        provenance: { type: "map", selectedAt: "2026-09-17T00:00:00.000Z" },
      },
      finish: {
        id: "pt_finish" as never,
        kind: "finish",
        coordinate: finish,
        provenance: { type: "map", selectedAt: "2026-09-17T00:00:00.000Z" },
      },
    });

    const result = await buildProviderRequest(intent, {
      resolveGeometry: (): GeometryPayload | null => null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.sketch).toBeUndefined();
    // Both strokes and the corridor are reported, never silently dropped.
    expect([...result.unresolvedRefs].sort()).toEqual(
      [STROKE_REF, STROKE_B_REF, CORRIDOR_REF].sort(),
    );
  });

  it("fits a corridor beyond the wire bound to it instead of omitting it (OGV-D-285)", async () => {
    // A long, wavy trace, so simplification keeps more vertices than the bound.
    const long: Coordinate[] = [];
    for (let index = 0; index <= 2_200; index += 1) {
      long.push(at(index * 60, (index % 2 === 0 ? 1 : -1) * 40));
    }
    const drawn = buildSketchCorridor([long]).corridor;
    expect(drawn.length).toBeGreaterThan(MAX_PROVIDER_SKETCH_CORRIDOR_POINTS);

    const intent = intentWith(sketchIntent({ rawStrokeRefs: [STROKE_REF] }));
    const result = await buildProviderRequest(intent, {
      resolveGeometry: (ref: GeometryRef): GeometryPayload | null =>
        ref === STROKE_REF ? payload(long) : null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const corridor = result.request.sketch?.corridor;
    expect(corridor, "the drawn line always travels").toBeDefined();
    expect(corridor?.length).toBeLessThanOrEqual(MAX_PROVIDER_SKETCH_CORRIDOR_POINTS);
    expect(corridor?.[0]).toEqual(drawn[0]);
    expect(corridor?.at(-1)).toEqual(drawn.at(-1));
    expect(result.request.sketch?.anchors.length).toBeLessThanOrEqual(
      MAX_PROVIDER_SKETCH_ANCHORS,
    );
  });

  it("is absent when the ride has no sketch", async () => {
    const result = await buildProviderRequest(
      intentWith(null, {
        start: {
          id: "pt_start" as never,
          kind: "start",
          coordinate: at(0, 0),
          provenance: { type: "map", selectedAt: "2026-09-17T00:00:00.000Z" },
        },
        finish: {
          id: "pt_finish" as never,
          kind: "finish",
          coordinate: at(1_000, 0),
          provenance: { type: "map", selectedAt: "2026-09-17T00:00:00.000Z" },
        },
      }),
      context(null),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.sketch).toBeUndefined();
    expect(result.request.shaping).toEqual([]);
  });
});

describe("intentIdentity — a sketch participates through its refs", () => {
  it("changes when the corridor handle changes", async () => {
    const { intentIdentity } = await import("@/application/planner/build-plan-request");
    const versions = { routePolicy: "p", graph: "g", evidence: "e" };
    const base = intentWith(sketchIntent());
    const moved = intentWith(sketchIntent({ corridorRef: asGeometryRef("geo_other") }));
    expect(intentIdentity(base, versions)).not.toBe(intentIdentity(moved, versions));
  });
});
