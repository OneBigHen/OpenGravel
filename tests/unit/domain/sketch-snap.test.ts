import { describe, expect, it } from "vitest";

import { haversine, pointToSegmentDistanceMeters } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import {
  SKETCH_ANCHOR_MAX_SPACING_METERS,
  SKETCH_ANCHOR_MIN_SPACING_METERS,
  chunkSketchWaypoints,
  createLineIndex,
  cumulativeMeters,
  isSpurAt,
  locateInOrder,
  pointAlong,
  resampleSketchCorridor,
  reviewSketchLeg,
  routeShareNearLine,
  shapeAwareSketchAnchors,
  sketchAnchorHeadings,
  sketchCorridorBand,
  sketchStraySections,
  sliceLineByAlong,
  stitchSketchLines,
} from "@/domain/sketch/snap";
import { SAMPLE_STROKE } from "../../fixtures/sketch/sample-stroke";

const ORIGIN = { lon: -75.9, lat: 40.4 };
const M_LAT = 1 / 111_320;
const M_LON = M_LAT / Math.cos((ORIGIN.lat * Math.PI) / 180);

/** A position `east`/`north` meters from the origin. */
function at(east: number, north: number): Coordinate {
  return { lon: ORIGIN.lon + east * M_LON, lat: ORIGIN.lat + north * M_LAT };
}

/** A straight east-running line of `meters`, one vertex every `step`. */
function straight(meters: number, step = 50): Coordinate[] {
  return Array.from({ length: Math.floor(meters / step) + 1 }, (_value, index) => at(index * step, 0));
}

/** A zig-zag: `bends` switchbacks of `leg` meters each. */
function zigzag(bends: number, leg: number, step = 25): Coordinate[] {
  const line: Coordinate[] = [];
  for (let bend = 0; bend < bends; bend += 1) {
    for (let offset = 0; offset < leg; offset += step) {
      line.push(at(bend * leg * 0.5 + offset * 0.5, bend % 2 === 0 ? offset : leg - offset));
    }
  }
  return line;
}

function length(line: readonly Coordinate[]): number {
  return cumulativeMeters(line).at(-1) ?? 0;
}

function bruteNearest(point: Coordinate, line: readonly Coordinate[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < line.length; index += 1) {
    best = Math.min(best, pointToSegmentDistanceMeters(point, line[index - 1]!, line[index]!));
  }
  return best;
}

describe("resampleSketchCorridor", () => {
  it("fits the 1,000-point stroke to the budget, keeping both ends and the shape", () => {
    const fitted = resampleSketchCorridor(SAMPLE_STROKE, 200);
    expect(fitted.length).toBeLessThanOrEqual(200);
    expect(fitted[0]).toEqual(SAMPLE_STROKE[0]);
    expect(fitted.at(-1)).toEqual(SAMPLE_STROKE.at(-1));
    // Douglas–Peucker bounds every dropped vertex: nothing drawn is lost by
    // more than the tolerance it settled on (a few tens of meters here).
    const worst = Math.max(...SAMPLE_STROKE.map((point) => bruteNearest(point, fitted)));
    expect(worst).toBeLessThan(60);
  });

  it("returns a corridor already inside the budget unchanged", () => {
    const line = straight(1_000, 100);
    expect(resampleSketchCorridor(line, 50)).toEqual(line);
  });

  it("never exceeds the budget, even for a budget of two", () => {
    expect(resampleSketchCorridor(SAMPLE_STROKE, 2)).toEqual([SAMPLE_STROKE[0], SAMPLE_STROKE.at(-1)]);
  });
});

describe("shapeAwareSketchAnchors", () => {
  it("keeps the drawing's own endpoints exactly", () => {
    const anchors = shapeAwareSketchAnchors(SAMPLE_STROKE, { maxAnchors: 400 });
    expect(anchors[0]?.at).toEqual(SAMPLE_STROKE[0]);
    expect(anchors.at(-1)?.at).toEqual(SAMPLE_STROKE.at(-1));
    expect(anchors[0]?.heading).toBeNull();
  });

  it("spaces anchors between the minimum and maximum spacing on a 60-mile stroke", () => {
    const anchors = shapeAwareSketchAnchors(SAMPLE_STROKE, { maxAnchors: 400 });
    const gaps = anchors.slice(1).map((anchor, index) => anchor.alongMeters - anchors[index]!.alongMeters);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(SKETCH_ANCHOR_MIN_SPACING_METERS);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(SKETCH_ANCHOR_MAX_SPACING_METERS + 1);
    // ~60 mi at 0.5–1.5 mi apart.
    expect(anchors.length).toBeGreaterThan(40);
    expect(anchors.length).toBeLessThan(125);
  });

  it("is denser where the drawing twists than on a straight", () => {
    const flat = shapeAwareSketchAnchors(straight(20_000), { maxAnchors: 400 });
    const twisty = shapeAwareSketchAnchors(zigzag(40, 500), { maxAnchors: 400 });
    const perKm = (anchors: typeof flat, line: Coordinate[]) => anchors.length / (length(line) / 1_000);
    expect(perKm(twisty, zigzag(40, 500))).toBeGreaterThan(perKm(flat, straight(20_000)) * 1.5);
    // A straight still gets an anchor at least every max spacing.
    expect(flat.length).toBeGreaterThanOrEqual(Math.ceil(20_000 / SKETCH_ANCHOR_MAX_SPACING_METERS));
  });

  it("thins to the anchor budget on a 300-mile drawing", () => {
    const long = straight(483_000, 200);
    const wiggly = long.map((point, index) => ({ ...point, lat: point.lat + Math.sin(index / 3) * 400 * M_LAT }));
    const anchors = shapeAwareSketchAnchors(wiggly, { maxAnchors: 50 });
    expect(anchors.length).toBeLessThanOrEqual(50);
    expect(anchors[0]?.at).toEqual(wiggly[0]);
    expect(anchors.at(-1)?.at).toEqual(wiggly.at(-1));
  });

  it("gives every interior anchor the heading the stroke was drawn in", () => {
    const anchors = shapeAwareSketchAnchors(straight(10_000), { maxAnchors: 400 });
    for (const anchor of anchors.slice(1, -1)) expect(anchor.heading).toBe(90);
  });
});

describe("locateInOrder and sketchAnchorHeadings", () => {
  it("keeps an out-and-back's return anchor on the return pass", () => {
    // East 3 km, then back west along the same road.
    const out = straight(3_000, 50);
    const back = [...out].reverse().slice(1);
    const line = [...out, ...back];
    const anchors = [at(1_000, 0), at(2_500, 0), at(2_000, 0), at(500, 0)];
    // The helper's meters are a flat approximation; the along values agree to
    // a few meters.
    const located = locateInOrder(line, anchors).map((hit) => hit.alongMeters);
    [1_000, 2_500, 4_000, 5_500].forEach((expected, index) =>
      expect(Math.abs((located[index] ?? 0) - expected)).toBeLessThan(10),
    );
    // A plain nearest projection would give the return anchors the outbound
    // direction (east, 90°) and force the router into a loop.
    expect(sketchAnchorHeadings(line, anchors)).toEqual([90, 90, 270, 270]);
  });
});

describe("createLineIndex", () => {
  it("answers the same distance as a brute-force scan", () => {
    const index = createLineIndex(SAMPLE_STROKE);
    for (let probe = 0; probe < 200; probe += 1) {
      const base = SAMPLE_STROKE[(probe * 37) % SAMPLE_STROKE.length]!;
      const point = {
        lon: base.lon + Math.sin(probe) * 0.02,
        lat: base.lat + Math.cos(probe * 1.7) * 0.02,
      };
      expect(index.nearest(point).distanceMeters).toBeCloseTo(bruteNearest(point, SAMPLE_STROKE), 6);
    }
  });
});

describe("chunkSketchWaypoints", () => {
  it("splits into requests that share their joins and cover every waypoint once", () => {
    const points = Array.from({ length: 65 }, (_value, index) => index);
    const chunks = chunkSketchWaypoints(points, 24);
    expect(chunks.length).toBe(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(24);
    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index]![0]).toBe(chunks[index - 1]!.at(-1));
    }
    const joined = chunks.flatMap((chunk, index) => (index === 0 ? chunk : chunk.slice(1)));
    expect(joined).toEqual(points);
  });

  it("fits the hosted plan's five points per request", () => {
    const chunks = chunkSketchWaypoints(Array.from({ length: 13 }, (_value, index) => index), 5);
    expect(chunks.every((chunk) => chunk.length <= 5 && chunk.length >= 2)).toBe(true);
    expect(chunks.flatMap((chunk, index) => (index === 0 ? chunk : chunk.slice(1)))).toHaveLength(13);
  });

  it("keeps a short list as one request", () => {
    expect(chunkSketchWaypoints([1, 2, 3], 24)).toEqual([[1, 2, 3]]);
  });
});

describe("stitchSketchLines", () => {
  it("drops the duplicated join and reports each chunk's offset", () => {
    const a = [at(0, 0), at(100, 0), at(200, 0)];
    const b = [at(200, 0), at(300, 0)];
    const c = [at(300, 0), at(400, 0), at(500, 0)];
    const { line, offsets } = stitchSketchLines([a, b, c]);
    expect(line).toHaveLength(6);
    expect(offsets).toEqual([0, 2, 3]);
    expect(line[offsets[2]!]).toEqual(c[0]);
  });

  it("keeps both points when a join does not coincide", () => {
    const { line, offsets } = stitchSketchLines([[at(0, 0), at(100, 0)], [at(105, 0), at(200, 0)]]);
    expect(line).toHaveLength(4);
    expect(offsets).toEqual([0, 2]);
  });
});

describe("adherence measures", () => {
  it("routeShareNearLine is the share of route length within the tolerance", () => {
    const drawn = straight(10_000);
    const route = [...straight(8_000), at(8_000, 500), at(10_000, 500)];
    const share = routeShareNearLine(route, drawn, 100);
    // 8 km on the line, 0.5 km climbing away, 2 km parallel 500 m off.
    expect(share).toBeGreaterThan(0.75);
    expect(share).toBeLessThan(0.8);
  });

  it("sketchStraySections reports the drawn stretch the route left", () => {
    const drawn = straight(10_000);
    const route = [...straight(4_000), at(4_000, 800), at(6_000, 800), ...straight(10_000).slice(120)];
    const sections = sketchStraySections(route, drawn);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.fromAlongMeters).toBeGreaterThan(4_000);
    expect(sections[0]!.toAlongMeters).toBeLessThan(6_100);
    expect(sections[0]!.farthestDistanceMeters).toBeGreaterThan(700);
  });

  it("sketchStraySections is empty when the route follows the drawing", () => {
    expect(sketchStraySections(straight(10_000), straight(10_000))).toEqual([]);
  });
});

describe("leg review", () => {
  const drawn = straight(10_000);

  it("finds the out-and-back spur a dead-end via produces", () => {
    const spur = [...straight(2_000), at(2_000, 300), at(2_000, 0), ...straight(4_000).slice(41)];
    const viaIndex = 41; // the spur's tip
    expect(isSpurAt(spur, viaIndex)).toBe(true);
    expect(isSpurAt(straight(4_000), 40)).toBe(false);
  });

  it("calls a leg that rides miles for a short drawn span a detour", () => {
    const leg = [at(1_000, 0), at(1_000, 3_000), at(2_000, 3_000), at(2_000, 0)];
    expect(reviewSketchLeg(leg, drawn, 1_000, 2_000).kind).toBe("detour");
  });

  it("asks for an anchor where a leg left the drawing", () => {
    const leg = [at(0, 0), at(2_000, 600), at(4_000, 0)];
    const verdict = reviewSketchLeg(leg, drawn, 0, 4_000);
    expect(verdict.kind).toBe("stray");
    if (verdict.kind !== "stray") return;
    expect(haversine(verdict.at, at(2_000, 0))).toBeLessThan(300);
    expect(verdict.heading).toBe(90);
  });

  it("passes a leg on the drawing", () => {
    expect(reviewSketchLeg(straight(4_000), drawn, 0, 4_000).kind).toBe("ok");
  });
});

describe("sketchCorridorBand and sliceLineByAlong", () => {
  it("covers every drawn position with closed rectangles", () => {
    const rings = sketchCorridorBand(SAMPLE_STROKE, 80, 600);
    expect(rings.length).toBeLessThanOrEqual(600);
    for (const ring of rings) {
      expect(ring).toHaveLength(5);
      expect(ring[0]).toEqual(ring[4]);
    }
  });

  it("slices the stretch between two along distances", () => {
    const line = straight(10_000);
    const slice = sliceLineByAlong(line, 2_000, 3_000);
    expect(length(slice)).toBeCloseTo(1_000, 0);
    const cumulative = cumulativeMeters(line);
    expect(haversine(slice[0]!, pointAlong(line, cumulative, 2_000))).toBeLessThan(0.01);
    expect(haversine(slice.at(-1)!, pointAlong(line, cumulative, 3_000))).toBeLessThan(0.01);
  });
});
