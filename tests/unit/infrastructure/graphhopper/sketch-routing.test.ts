/**
 * Chunked sketch routing (OGV-D-285): the merge of chunk answers, the one
 * repair pass, and — replayed from a recording of the real engine — the
 * 1,000-point synthetic sketch.
 */

import { describe, expect, it } from "vitest";

import { corridorLengthMeters } from "@/application/planner/sketch-corridor";
import type { Coordinate } from "@/domain/ride/types";
import { routeShareNearLine } from "@/domain/sketch/snap";
import type { GraphHopperWirePoint } from "@/infrastructure/routing/graphhopper/request-builder";
import type { GraphHopperPath } from "@/infrastructure/routing/graphhopper/response-parser";
import {
  mergeSketchPaths,
  routeSketch,
  thinSketchAnchors,
  type SketchChunkRouter,
} from "@/infrastructure/routing/graphhopper/sketch-routing";
import { SAMPLE_ROAD, SAMPLE_STROKE, sampleSketchRequest } from "../../../fixtures/sketch/sample-stroke";

const M = 1 / 111_320;

function at(east: number, north = 0): Coordinate {
  return { lon: -75.9 + (east * M) / Math.cos((40.4 * Math.PI) / 180), lat: 40.4 + north * M };
}

function pathThrough(points: readonly Coordinate[], extra: Partial<GraphHopperPath> = {}): GraphHopperPath {
  const coordinates = points.map(({ lon, lat }) => [lon, lat] as const);
  return {
    distance: corridorLengthMeters(points),
    time: 1_000 * points.length,
    points: { coordinates },
    snapped_waypoints: { coordinates: [coordinates[0]!, coordinates.at(-1)!] },
    instructions: [
      { sign: 0, text: "Continue", interval: [0, points.length - 1] },
      { sign: 4, text: "Arrive at destination", interval: [points.length - 1, points.length - 1] },
    ],
    details: { road_class: [[0, points.length - 1, "secondary"]] },
    ...extra,
  };
}

describe("mergeSketchPaths", () => {
  it("joins chunk paths into one, re-basing instructions and details", () => {
    const first = pathThrough([at(0), at(100), at(200)]);
    const second = pathThrough([at(200), at(300), at(400), at(500)]);
    const merged = mergeSketchPaths([first, second]);

    expect(merged.points?.coordinates).toHaveLength(6);
    expect(merged.distance).toBeCloseTo((first.distance ?? 0) + (second.distance ?? 0), 6);
    expect(merged.time).toBe((first.time ?? 0) + (second.time ?? 0));
    // The first chunk's "arrive" is a silent via; only the last one arrives.
    expect(merged.instructions?.map((instruction) => instruction.sign)).toEqual([0, 5, 0, 4]);
    expect(merged.instructions?.[1]?.text).toBe("");
    expect(merged.instructions?.[2]?.interval).toEqual([2, 5]);
    expect(merged.details?.road_class).toEqual([
      [0, 2, "secondary"],
      [2, 5, "secondary"],
    ]);
    expect(merged.snapped_waypoints?.coordinates).toHaveLength(3);
  });
});

/** A fake engine: every chunk is answered with a straight line through its points. */
function straightRouter(calls: (readonly GraphHopperWirePoint[])[]): SketchChunkRouter {
  return async (points) => {
    calls.push(points);
    const line = points.map(({ lon, lat }) => ({ lon, lat }));
    return {
      path: {
        ...pathThrough(line),
        snapped_waypoints: { coordinates: points.map(({ lon, lat }) => [lon, lat] as const) },
      },
      engineVersion: "11.0",
      degraded: false,
    };
  };
}

function sketchRequest(corridor: readonly Coordinate[], anchors: readonly Coordinate[]) {
  return {
    requestId: "synthetic-sketch-test",
    origin: anchors[0]!,
    destination: anchors.at(-1)!,
    stops: [],
    shaping: [],
    profile: "motorcycle_twisty",
    avoidPolygons: [],
    sketch: {
      anchors,
      corridor,
      endpointPolicy: "derive" as const,
      nearLoop: false,
      topologyHints: [],
      derivedEndpoints: null,
    },
    options: {
      includeAlternatives: false,
      avoidHighways: false,
      tollPolicy: "allow-with-warning" as const,
      vehicle: "motorcycle" as const,
    },
  };
}

describe("routeSketch", () => {
  const corridor = Array.from({ length: 201 }, (_value, index) => at(index * 100));
  const anchors = Array.from({ length: 21 }, (_value, index) => at(index * 1_000));
  const wire = (points: readonly Coordinate[]): GraphHopperWirePoint[] =>
    points.map((point, index) => ({
      ...point,
      ...(index === 0 || index === points.length - 1 ? {} : { label: "Sketch", heading: 90 }),
    }));

  it("routes a long anchor list in chunks that share their joins, with no repair when it follows the drawing", async () => {
    const calls: (readonly GraphHopperWirePoint[])[] = [];
    const result = await routeSketch({
      request: sketchRequest(corridor, anchors),
      wirePoints: wire(anchors),
      maxPointsPerRequest: 5,
      routeChunk: straightRouter(calls),
    });
    expect(result.report).toEqual({ chunks: 5, spursDropped: 0, anchorsAdded: 0 });
    expect(calls).toHaveLength(5);
    expect(calls.every((call) => call.length <= 5)).toBe(true);
    const line = result.path.points?.coordinates ?? [];
    expect(line).toHaveLength(21);
    expect(line[0]).toEqual([anchors[0]!.lon, anchors[0]!.lat]);
    expect(line.at(-1)).toEqual([anchors.at(-1)!.lon, anchors.at(-1)!.lat]);
  });

  it("drops the anchors at both ends of a detour and re-routes that chunk once", async () => {
    const calls: (readonly GraphHopperWirePoint[])[] = [];
    const engine = straightRouter(calls);
    // The anchor at 2 km snapped onto the far carriageway: every leg touching it
    // rides five kilometers out and back.
    const router: SketchChunkRouter = async (points, band) => {
      const answer = await engine(points, band);
      const bad = points.findIndex((point) => Math.abs(point.lon - at(2_000).lon) < 1e-9);
      if (bad < 0) return answer;
      const line: Coordinate[] = [];
      points.forEach((point, index) => {
        if (index === bad) line.push(at(2_000, 5_000));
        line.push({ lon: point.lon, lat: point.lat });
        if (index === bad) line.push(at(2_000, 5_000));
      });
      return {
        ...answer,
        path: {
          ...pathThrough(line),
          snapped_waypoints: {
            coordinates: points.map(({ lon, lat }) => [lon, lat] as const),
          },
        },
      };
    };
    const result = await routeSketch({
      request: sketchRequest(corridor, anchors.slice(0, 5)),
      wirePoints: wire(anchors.slice(0, 5)),
      maxPointsPerRequest: 24,
      routeChunk: router,
    });
    expect(calls).toHaveLength(2);
    // Legs 1→2 and 2→3 were detours; their interior ends (1, 2 and 3) go.
    expect(calls[1]!.map((point) => point.label ?? "end")).toEqual(["end", "end"]);
    expect(result.report.spursDropped).toBe(3);
    expect(result.path.distance).toBeLessThan(4_100);
  });

  it("keeps the first answer when the repair would leave more of the drawing", async () => {
    let call = 0;
    const router: SketchChunkRouter = async (points) => {
      call += 1;
      // First answer: a long spur out of the second anchor. Repair: a shortcut
      // that leaves 3 km of the drawing entirely.
      const line =
        call === 1
          ? [at(0), at(1_000), at(1_000, 2_000), at(1_000), at(4_000)]
          : [at(0), at(0, 3_000), at(4_000)];
      return {
        path: {
          ...pathThrough(line),
          snapped_waypoints: {
            coordinates:
              call === 1
                ? [[at(0).lon, at(0).lat], [at(1_000, 2_000).lon, at(1_000, 2_000).lat], [at(4_000).lon, at(4_000).lat]]
                : points.map(({ lon, lat }) => [lon, lat] as const),
          },
        },
        engineVersion: "11.0",
        degraded: false,
      };
    };
    const result = await routeSketch({
      request: sketchRequest(corridor.slice(0, 41), [at(0), at(1_000), at(4_000)]),
      wirePoints: wire([at(0), at(1_000), at(4_000)]),
      maxPointsPerRequest: 24,
      routeChunk: router,
    });
    expect(call).toBe(2);
    expect(result.report.spursDropped).toBe(0);
    expect(result.path.points?.coordinates).toHaveLength(5);
  });

  it("fails the whole sketch when a chunk cannot be routed, never leaving a hole", async () => {
    const router: SketchChunkRouter = async (points) => {
      if (points[0]!.lon > at(9_000).lon) throw new Error("no route");
      return straightRouter([])(points, []);
    };
    await expect(
      routeSketch({
        request: sketchRequest(corridor, anchors),
        wirePoints: wire(anchors),
        maxPointsPerRequest: 5,
        routeChunk: router,
      }),
    ).rejects.toThrow("no route");
  });
});

describe("thinSketchAnchors (hosted plan)", () => {
  it("keeps every authored point and at most `max` sketch anchors, spread evenly", () => {
    const points: GraphHopperWirePoint[] = [
      { ...at(0) },
      { ...at(50), label: "Stop" },
      ...Array.from({ length: 40 }, (_value, index) => ({ ...at(100 + index * 100), label: "Sketch" })),
      { ...at(9_000) },
    ];
    const thinned = thinSketchAnchors(points, 12);
    expect(thinned.filter((point) => point.label === "Sketch")).toHaveLength(12);
    expect(thinned[0]).toEqual(points[0]);
    expect(thinned[1]).toEqual(points[1]);
    expect(thinned.at(-1)).toEqual(points.at(-1));
    const kept = thinned.filter((point) => point.label === "Sketch").map((point) => point.lon);
    expect(kept).toEqual([...kept].sort((a, b) => a - b));
    expect(thinSketchAnchors(points.slice(0, 5), 12)).toEqual(points.slice(0, 5));
  });
});

describe("the generated 100 km sketch", () => {
  it("routes the sample through shared chunks without losing the drawn line", async () => {
    const request = sampleSketchRequest("motorcycle_twisty");
    const anchors = request.sketch?.anchors ?? [];
    const wirePoints: GraphHopperWirePoint[] = anchors.map((point, index) => ({
      ...point,
      ...(index === 0 || index === anchors.length - 1 ? {} : { label: "Sketch", heading: 90 }),
    }));
    const calls: (readonly GraphHopperWirePoint[])[] = [];
    const result = await routeSketch({
      request,
      wirePoints,
      maxPointsPerRequest: 24,
      routeChunk: straightRouter(calls),
    });
    const route = (result.path.points?.coordinates ?? []).map(([lon, lat]) => ({ lon, lat }));

    expect(SAMPLE_STROKE).toHaveLength(1_000);
    expect(corridorLengthMeters(SAMPLE_STROKE) / 1_609.344).toBeGreaterThan(59);
    expect(calls.length).toBeGreaterThan(1);
    expect(route[0]).toEqual(request.origin);
    expect(route.at(-1)).toEqual(request.destination);
    expect(routeShareNearLine(route, SAMPLE_STROKE, 150)).toBeGreaterThan(0.95);
    expect(routeShareNearLine(route, SAMPLE_ROAD, 150)).toBeGreaterThan(0.95);
  });
});
