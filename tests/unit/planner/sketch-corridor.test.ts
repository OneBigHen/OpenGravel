import { describe, expect, it } from "vitest";

import {
  buildSketchCorridor,
  sampleSketchAnchors,
  sketchAdherence,
  sketchAdherenceEvidence,
  sketchCorridorEnvelopeMeters,
} from "@/application/planner/sketch-corridor";
import { haversine, pointToSegmentDistanceMeters } from "@/domain/geometry/analysis";
import {
  LOOP_CLOSE_METERS,
  MAX_SKETCH_REQUEST_ANCHORS,
  MIN_SKETCH_CORRIDOR_ENVELOPE_METERS,
  SKETCH_SIMPLIFY_TOLERANCE_METERS,
  STROKE_JOIN_GAP_METERS,
} from "@/domain/sketch/types";
import type { Coordinate } from "@/domain/ride/types";

/**
 * The sketch corridor builder (04 §19, 05 §18–§19, 06 §18).
 *
 * Synthetic traces are built in meters around a fixed origin so every distance
 * in an assertion is the one the test wrote, not one that has to be trusted:
 * `at(east, north)` converts meters to a lon/lat offset at the fixture's
 * latitude.
 */

const ORIGIN: Coordinate = { lon: -75.44, lat: 40.14 };

const METERS_PER_DEGREE_LAT = 111_320;
const METERS_PER_DEGREE_LON = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

/** A coordinate `east` and `north` meters from the fixture origin. */
function at(east: number, north: number): Coordinate {
  return {
    lon: ORIGIN.lon + east / METERS_PER_DEGREE_LON,
    lat: ORIGIN.lat + north / METERS_PER_DEGREE_LAT,
  };
}

/** A straight trace from one position to another, sampled every 25 m. */
function line(
  fromEast: number,
  fromNorth: number,
  toEast: number,
  toNorth: number,
): Coordinate[] {
  const length = Math.hypot(toEast - fromEast, toNorth - fromNorth);
  const steps = Math.max(1, Math.round(length / 25));
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

/** A straight trace east from the origin, `east` meters long. */
function run(east: number, north = 0): Coordinate[] {
  return line(0, 0, east, north);
}

/** The index of the corridor position nearest `point`. */
function nearestIndex(corridor: readonly Coordinate[], point: Coordinate): number {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  corridor.forEach((candidate, index) => {
    const distance = haversine(candidate, point);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

/** How many separate passes of `corridor` come within `tolerance` of `point`. */
function passesNear(
  corridor: readonly Coordinate[],
  point: Coordinate,
  tolerance: number,
): number {
  let passes = 0;
  let inside = false;
  for (let index = 1; index < corridor.length; index += 1) {
    const start = corridor[index - 1];
    const end = corridor[index];
    if (start === undefined || end === undefined) continue;
    const near = pointToSegmentDistanceMeters(point, start, end) <= tolerance;
    if (near && !inside) passes += 1;
    inside = near;
  }
  return passes;
}

describe("buildSketchCorridor — stroke order and gap honesty", () => {
  it("joins two strokes across a gap at or below the join threshold", () => {
    const first = run(200);
    const second = line(220, 0, 420, 0);
    const result = buildSketchCorridor([first, second]);

    expect(result.breaks).toHaveLength(0);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.[0]).toEqual(first[0]);
    expect(result.segments[0]?.at(-1)).toEqual(second.at(-1));
    // 200 m + the 20 m hop + 200 m, with a meter of slack for the geodesy.
    expect(result.lengthMeters).toBeGreaterThan(415);
    expect(result.lengthMeters).toBeLessThan(425);
  });

  it("keeps two strokes 100 m apart as two segments and never bridges them", () => {
    const first = run(200);
    const second = line(300, 0, 500, 0);
    const result = buildSketchCorridor([first, second]);

    expect(result.segments).toHaveLength(2);
    expect(result.breaks).toHaveLength(1);
    const gap = result.breaks[0];
    expect(gap?.gapMeters).toBeCloseTo(100, 0);
    expect(gap?.strokeIndex).toBe(1);
    // The segment split is the drawn split: each segment is its own stroke.
    expect(result.segments[1]?.[0]).toEqual(second[0]);
    // No coordinate of the corridor sits in the un-drawn middle of the gap.
    const middle = at(250, 0);
    const bridge = result.corridor.filter(
      (point) => haversine(point, middle) < 40,
    );
    expect(bridge).toEqual([]);
  });

  it("preserves authoring order across several strokes", () => {
    const a = line(0, 0, 100, 0);
    const b = line(120, 0, 120, 200);
    const c = line(140, 200, 240, 200);
    const result = buildSketchCorridor([a, b, c]);

    expect(result.strokeIndices).toEqual([0, 1, 2]);
    expect(result.derivedEndpoints?.start).toEqual(a[0]);
    expect(result.derivedEndpoints?.finish).toEqual(c.at(-1));
    // Each stroke's own end is passed in authoring order. Nearest-index rather
    // than exact membership: simplification is allowed to drop a vertex.
    const order = [a.at(-1), b.at(-1), c.at(-1)].map((point) =>
      nearestIndex(result.corridor, point as Coordinate),
    );
    expect(order[0]).toBeLessThan(order[1] ?? -1);
    expect(order[1]).toBeLessThan(order[2] ?? -1);
  });

  it("drops strokes that cannot be a trace", () => {
    const result = buildSketchCorridor([[at(0, 0)], [], run(100)]);
    expect(result.strokeIndices).toEqual([2]);
  });
});

describe("buildSketchCorridor — topology hints", () => {
  it("detects a crossing between two strokes at the intersection", () => {
    // East-west through the origin, north-south through (100, 0).
    const horizontal = line(-100, 0, 200, 0);
    const vertical = line(100, -100, 100, 100);
    const result = buildSketchCorridor([horizontal, vertical]);

    const crossing = result.topologyHints.find((hint) => hint.kind === "crossing");
    expect(crossing, "a crossing between the two strokes is reported").toBeDefined();
    expect(crossing?.strokeIndices).toEqual([0, 1]);
    expect(haversine(crossing?.at as Coordinate, at(100, 0))).toBeLessThan(15);
    // A crossing is a hint, not a rewrite: both strokes keep their own points.
    expect(result.segments).toHaveLength(2);
  });

  it("does not report a crossing where strokes merely touch at a shared end", () => {
    const first = run(100);
    const second = line(100, 0, 200, 0);
    const result = buildSketchCorridor([first, second]);
    expect(result.topologyHints.filter((hint) => hint.kind === "crossing")).toEqual([]);
  });

  it("detects a double-back and keeps both passes", () => {
    const there = line(0, 0, 300, 0);
    const back = line(300, 0, 0, 0);
    const result = buildSketchCorridor([[...there, ...back.slice(1)]]);

    const doubleBack = result.topologyHints.find((hint) => hint.kind === "double-back");
    expect(doubleBack).toBeDefined();
    expect(haversine(doubleBack?.at as Coordinate, at(300, 0))).toBeLessThan(30);
    // The two passes are not collapsed into one: ~600 m of drawn trace stays.
    expect(result.lengthMeters).toBeGreaterThan(560);
  });

  it("does not report a double-back for a normal bend", () => {
    const bent = [...run(200), ...line(200, 0, 200, 200).slice(1)];
    const result = buildSketchCorridor([bent]);
    expect(result.topologyHints.filter((hint) => hint.kind === "double-back")).toEqual([]);
  });

  it("recognizes a near-loop and reports both endpoints", () => {
    const out = run(200);
    const around = [at(200, 100), at(50, 100)];
    const result = buildSketchCorridor([[...out, ...around]]);

    expect(result.nearLoop).toBe(true);
    expect(result.topologyHints.some((hint) => hint.kind === "near-loop")).toBe(true);
    const endpoints = result.derivedEndpoints;
    expect(endpoints).not.toBeNull();
    expect(
      haversine(endpoints?.start as Coordinate, endpoints?.finish as Coordinate),
    ).toBeLessThanOrEqual(LOOP_CLOSE_METERS);
  });

  it("does not call a trace a near-loop when it ends far from its start", () => {
    const result = buildSketchCorridor([run(1_000)]);
    expect(result.nearLoop).toBe(false);
    expect(result.topologyHints.some((hint) => hint.kind === "near-loop")).toBe(false);
  });

  it("does not collapse a figure-eight spatially", () => {
    // One stroke: east over the crossing, up, back west, down, east again —
    // a drawn figure-eight through (200, 0).
    const path = [
      ...line(0, 0, 400, 400),
      ...line(400, 400, 0, 400).slice(1),
      ...line(0, 400, 400, 0).slice(1),
    ];
    const result = buildSketchCorridor([path]);

    // The drawn length is preserved (a spatial pinch would be ~570 m instead of
    // the ~1.5 km actually drawn).
    expect(result.lengthMeters).toBeGreaterThan(1_400);
    // The crossing is drawn twice, so two separate passes of the corridor go
    // through it (a pinch would put exactly one pass there).
    expect(passesNear(result.corridor, at(200, 200), 40)).toBe(2);
    expect(result.topologyHints.some((hint) => hint.kind === "crossing")).toBe(true);
  });
});

describe("buildSketchCorridor — simplification", () => {
  it("thins a noisy trace while keeping every dropped point within the tolerance", () => {
    const noisy: Coordinate[] = [];
    for (let index = 0; index <= 400; index += 1) {
      const east = index * 5;
      const wobble = Math.sin(index / 3) * 4;
      noisy.push(at(east, wobble));
    }
    const result = buildSketchCorridor([noisy]);

    expect(result.corridor.length).toBeLessThan(noisy.length / 2);
    // Douglas–Peucker bounds every dropped vertex by the tolerance, so the p95
    // chord error can never exceed it.
    const errors = noisy.map((point) => {
      let nearest = Number.POSITIVE_INFINITY;
      for (let index = 1; index < result.corridor.length; index += 1) {
        const start = result.corridor[index - 1];
        const end = result.corridor[index];
        if (start === undefined || end === undefined) continue;
        nearest = Math.min(nearest, pointToSegmentDistanceMeters(point, start, end));
      }
      return nearest;
    });
    errors.sort((left, right) => left - right);
    const p95 = errors[Math.floor(errors.length * 0.95)];
    expect(p95).toBeLessThanOrEqual(SKETCH_SIMPLIFY_TOLERANCE_METERS);
  });

  it("keeps a stroke's own endpoints exactly", () => {
    const stroke = run(300);
    const result = buildSketchCorridor([stroke]);
    expect(result.corridor[0]).toEqual(stroke[0]);
    expect(result.corridor.at(-1)).toEqual(stroke.at(-1));
  });
});

describe("sampleSketchAnchors", () => {
  it("returns at most the bound and keeps both ends", () => {
    const anchors = sampleSketchAnchors(run(10_000));
    expect(anchors.length).toBeLessThanOrEqual(MAX_SKETCH_REQUEST_ANCHORS);
    expect(anchors[0]).toEqual(at(0, 0));
    expect(anchors.at(-1)).toEqual(at(10_000, 0));
  });

  it("spaces the anchors by arc length, not by vertex index", () => {
    // The first half of the trace is a dense run and the second half sparse: an
    // index-based sample would bunch the anchors where the vertices are.
    const dense = line(0, 0, 2_000, 0);
    const sparse = line(2_000, 0, 4_000, 0).filter((_point, index) => index % 8 === 0);
    const anchors = sampleSketchAnchors([...dense, ...sparse.slice(1)]);
    const gaps = anchors.slice(1).map((point, index) =>
      haversine(anchors[index] as Coordinate, point),
    );
    const smallest = Math.min(...gaps);
    const largest = Math.max(...gaps);
    expect(largest / smallest).toBeLessThan(1.6);
    expect(anchors.length).toBeGreaterThan(2);
  });

  it("keeps a short trace's own points when it has fewer vertices than the bound", () => {
    const stroke = [at(0, 0), at(50, 0), at(100, 0)];
    expect(sampleSketchAnchors(stroke)).toEqual(stroke);
  });
});

describe("sketchAdherence", () => {
  it("measures a route that follows the corridor as fully covered", () => {
    const corridor = run(1_000);
    const adherence = sketchAdherence(corridor, corridor);
    expect(adherence.coveredShare).toBe(1);
    expect(adherence.score).toBe(100);
    expect(adherence.meanDeviationMeters).toBeLessThan(5);
  });

  it("measures a route that ignores the corridor as uncovered", () => {
    const corridor = run(1_000);
    const elsewhere = line(0, 5_000, 1_000, 5_000);
    const adherence = sketchAdherence(elsewhere, corridor);
    expect(adherence.coveredShare).toBe(0);
    expect(adherence.meanDeviationMeters).toBeGreaterThan(4_000);
  });

  it("holds the envelope inside its documented bounds", () => {
    expect(sketchCorridorEnvelopeMeters(run(200))).toBe(MIN_SKETCH_CORRIDOR_ENVELOPE_METERS);
    expect(sketchCorridorEnvelopeMeters(run(1_000_000))).toBe(8_000);
  });
});

describe("sketchAdherenceEvidence", () => {
  it("reports a known status with no warning when the route hugs the trace", () => {
    const corridor = run(1_000);
    const evidence = sketchAdherenceEvidence(sketchAdherence(corridor, corridor));
    expect(evidence.status).toBe("known");
    expect(evidence.confidence).toBe(1);
    expect(evidence.warning).toBeNull();
    expect(evidence.value).not.toBeNull();
  });

  it("reports an estimated status and a warning when the route is materially off it", () => {
    const corridor = run(1_000);
    const evidence = sketchAdherenceEvidence(
      sketchAdherence(line(0, 5_000, 1_000, 5_000), corridor),
    );
    expect(evidence.status).toBe("estimated");
    expect(evidence.warning).toBe("Route deviates from your sketch.");
  });

  it("never claims a value it did not measure", () => {
    const empty = buildSketchCorridor([]);
    expect(empty.corridor).toEqual([]);
    expect(empty.derivedEndpoints).toBeNull();
    expect(empty.nearLoop).toBe(false);
    expect(empty.topologyHints).toEqual([]);
  });
});

describe("buildSketchCorridor — defaults", () => {
  it("uses the documented join gap and loop threshold", () => {
    expect(STROKE_JOIN_GAP_METERS).toBe(30);
    expect(LOOP_CLOSE_METERS).toBe(150);
    // A 30 m gap joins; a 31 m gap does not.
    const joined = buildSketchCorridor([run(200), line(230, 0, 430, 0)]);
    expect(joined.segments).toHaveLength(1);
    const split = buildSketchCorridor([run(200), line(235, 0, 435, 0)]);
    expect(split.segments).toHaveLength(2);
  });
});
