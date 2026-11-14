import { describe, expect, it } from "vitest";

import { spreadBubbles } from "@/ui/explore/routes-camera";

describe("spreadBubbles", () => {
  it("pushes crowded bubbles at least a bubble apart and leaves a lone one alone", () => {
    const points = [{ x: 100, y: 100 }, { x: 105, y: 102 }, { x: 110, y: 98 }, { x: 400, y: 400 }];
    spreadBubbles(points, 42);
    for (let i = 0; i < 3; i += 1) {
      for (let j = i + 1; j < 3; j += 1) {
        expect(Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y)).toBeGreaterThan(38);
      }
    }
    expect(points[3]).toEqual({ x: 400, y: 400 });
  });

  it("separates bubbles that sit on exactly the same spot", () => {
    const points = [{ x: 50, y: 50 }, { x: 50, y: 50 }];
    spreadBubbles(points, 42);
    expect(Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y)).toBeGreaterThan(38);
  });
});
