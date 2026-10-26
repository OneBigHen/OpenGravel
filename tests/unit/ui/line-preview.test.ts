import { describe, expect, it } from "vitest";

import { PREVIEW_HEIGHT, PREVIEW_WIDTH, linePreviewPoints } from "@/ui/explore/line-preview";

/** "x,y x,y" → numbers, for the assertions below. */
function coordinates(points: string): readonly (readonly [number, number])[] {
  return points.split(" ").map((pair) => {
    const [x, y] = pair.split(",");
    return [Number(x), Number(y)] as const;
  });
}

describe("a ride's own line in a card frame", () => {
  it("draws nothing when there is no line to draw", () => {
    expect(linePreviewPoints([])).toBe("");
    expect(linePreviewPoints([{ lon: -75.5, lat: 40.5 }])).toBe("");
  });

  it("keeps the route's proportions inside the frame instead of stretching it", () => {
    // A 0.3° x 0.0° line is a straight east-west line: it must not be squashed
    // into a diagonal just to fill the box.
    const points = coordinates(linePreviewPoints([
      { lon: -75.5, lat: 40.5 },
      { lon: -75.2, lat: 40.5 },
    ]));
    const ys = new Set(points.map(([, y]) => y));
    expect(ys.size).toBe(1);
    const xs = points.map(([x]) => x);
    expect(Math.min(...xs)).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThan(PREVIEW_WIDTH);
  });

  it("puts north at the top of the frame", () => {
    const [south, north] = coordinates(linePreviewPoints([
      { lon: -75.5, lat: 40.4 },
      { lon: -75.5, lat: 40.8 },
    ]));
    expect(north![1]).toBeLessThan(south![1]);
  });

  it("never lets the line touch the frame's edge", () => {
    const points = coordinates(linePreviewPoints([
      { lon: -75.5, lat: 40.5 },
      { lon: -75.2, lat: 40.7 },
    ], PREVIEW_WIDTH, PREVIEW_HEIGHT, 16));
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(16);
      expect(x).toBeLessThanOrEqual(PREVIEW_WIDTH - 16);
      expect(y).toBeGreaterThanOrEqual(16);
      expect(y).toBeLessThanOrEqual(PREVIEW_HEIGHT - 16);
    }
  });

  it("thins a long route but keeps both ends", () => {
    const line = Array.from({ length: 1_000 }, (_, index) => ({ lon: -75.5 + index / 10_000, lat: 40.5 + index / 20_000 }));
    const points = coordinates(linePreviewPoints(line));
    expect(points.length).toBeLessThanOrEqual(120);
    expect(points[0]![0]).toBeLessThan(points.at(-1)![0]);
    expect(points.at(-1)![1]).toBeLessThan(points[0]![1]);
  });
});
