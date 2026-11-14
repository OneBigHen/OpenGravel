import { describe, expect, it } from "vitest";

import { decodeCardLine, encodeCardLine } from "@/application/route-library/card-line";
import { buildGeometry, decodeLine, MAX_RIDE_POINTS, simplifyLine, splitSegments } from "@/application/route-library/geometry";
import type { Coordinate } from "@/domain/ride/types";

/** A line going north that swings about 55 m sideways at every point, so a 5 m tolerance keeps nearly every point. */
function zigzag(count: number): Coordinate[] {
  return Array.from({ length: count }, (_, index) => ({ lat: 35 + index * 0.00005, lon: -84 + (index % 2) * (0.0006 + ((index * 7919) % 13) * 0.00002) }));
}

function eastward(meters: number, steps = 40): Coordinate[] {
  const degrees = meters / (111_319 * Math.cos(35 * Math.PI / 180));
  return Array.from({ length: steps + 1 }, (_, index) => ({ lat: 35, lon: -84 + (degrees * index) / steps }));
}

describe("building a line", () => {
  it("caps a 30,000-point line at 20,000 points", { timeout: 90_000 }, () => {
    const raw = zigzag(30_000);
    expect(simplifyLine(raw, 5).length).toBeGreaterThan(MAX_RIDE_POINTS);
    expect(raw.length).toBe(30_000);
    const built = buildGeometry([raw], { bundle: false });
    expect(built).not.toBeNull();
    expect(built!.points).toBeLessThanOrEqual(MAX_RIDE_POINTS);
    expect(built!.rawPoints).toBe(30_000);
    expect(decodeLine(built!.line).length).toBe(built!.points);
  });

  it("keeps a straight road down to its two ends", () => {
    const built = buildGeometry([eastward(5_000, 200)], { bundle: false })!;
    expect(built.points).toBe(2);
    expect(built.miles).toBeCloseTo(3.1, 1);
  });

  it("keeps bundle segments apart and joins a single ride's segments", () => {
    const first = eastward(2_000);
    const second = eastward(2_000).map((point) => ({ lat: point.lat + 0.05, lon: point.lon }));
    const bundle = buildGeometry([first, second], { bundle: true })!;
    expect(bundle.segmentCount).toBe(2);
    expect(splitSegments(bundle.line)).toHaveLength(2);
    expect(bundle.loop).toBe(false);
    const joined = buildGeometry([first, second], { bundle: false })!;
    expect(joined.segmentCount).toBe(1);
    expect(joined.line).not.toContain(";");
  });

  it("returns null when there is no line", () => {
    expect(buildGeometry([[{ lat: 35, lon: -84 }]], { bundle: false })).toBeNull();
    expect(buildGeometry([], { bundle: false })).toBeNull();
  });
});

describe("loops", () => {
  function ring(gapMeters: number): Coordinate[] {
    const around = Array.from({ length: 60 }, (_, index) => {
      const angle = (index / 60) * Math.PI * 2;
      return { lat: 35 + Math.sin(angle) * 0.01, lon: -84 + Math.cos(angle) * 0.01 };
    });
    return [...around, { lat: around[0]!.lat - gapMeters / 111_319, lon: around[0]!.lon }];
  }

  it("is flagged only when the ends are within 150 m", () => {
    expect(buildGeometry([ring(100)], { bundle: false })!.loop).toBe(true);
    expect(buildGeometry([ring(140)], { bundle: false })!.loop).toBe(true);
    expect(buildGeometry([ring(300)], { bundle: false })!.loop).toBe(false);
    expect(buildGeometry([eastward(8_000)], { bundle: false })!.loop).toBe(false);
  });
});

describe("rough tracks", () => {
  it("flags fewer than 20 points per 30 miles", () => {
    const sparse = [eastward(97_000, 2)][0]!; // about 60 miles, 3 points
    expect(buildGeometry([sparse], { bundle: false })!.rough).toBe(true);
    const dense = eastward(97_000, 400);
    expect(buildGeometry([dense], { bundle: false })!.rough).toBe(false);
  });

  it("flags a jump over 3 miles on a single track but not on a bundle", () => {
    const gap = [...eastward(20_000, 100), ...eastward(20_000, 100).map((point) => ({ lat: point.lat, lon: point.lon + 0.4 }))];
    expect(buildGeometry([gap], { bundle: false })!.rough).toBe(true);
    expect(buildGeometry([eastward(20_000, 100), eastward(20_000, 100).map((point) => ({ lat: point.lat, lon: point.lon + 0.4 }))], { bundle: true })!.rough).toBe(false);
  });
});

describe("card line", () => {
  it("round-trips a shape on the 64 grid, north at the top", () => {
    const encoded = encodeCardLine([
      { lat: 35, lon: -84 },
      { lat: 35.01, lon: -84 },
      { lat: 35.01, lon: -83.99 },
    ]);
    const points = decodeCardLine(encoded);
    expect(points).toHaveLength(3);
    expect(points[0]!.y).toBeGreaterThan(points[1]!.y);
    expect(Math.max(...points.map((point) => Math.max(point.x, point.y)))).toBe(63);
    expect(encoded).toHaveLength(6);
  });

  it("is empty for no shape and for garbage", () => {
    expect(encodeCardLine([{ lat: 1, lon: 1 }])).toBe("");
    expect(decodeCardLine(null)).toEqual([]);
    expect(decodeCardLine("!!!!")).toEqual([]);
  });
});
