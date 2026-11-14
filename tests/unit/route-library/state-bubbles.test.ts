import { describe, expect, it } from "vitest";

import { STATE_BBOXES, STATE_CENTRES } from "@/application/route-library/state-centres";
import type { IndexRow } from "@/application/route-library/types";
import { bubbleSize, COUNTRY_EXTENT, COUNTRY_INSETS, stateBubbles, zoomForBounds } from "@/ui/explore/routes-camera";

const TILE = 512;
const worldX = (lon: number, z: number) => ((lon + 180) / 360) * TILE * 2 ** z;
const worldY = (lat: number, z: number) => {
  const sin = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * TILE * 2 ** z;
};

const REAL_COUNTS: Record<string, number> = { AK: 39, AL: 153, AR: 136, AZ: 140, CA: 475, CO: 163, CT: 46, DC: 3, DE: 16, FL: 185, GA: 186, HI: 14, IA: 59, ID: 120, IL: 99, IN: 109, KS: 84, KY: 211, LA: 126, MA: 92, MD: 105, ME: 92, MI: 215, MN: 119, MO: 157, MS: 37, MT: 103, NC: 273, ND: 23, NE: 26, NH: 85, NJ: 78, NM: 112, NV: 68, NY: 213, OH: 237, OK: 103, OR: 149, PA: 274, RI: 19, SC: 111, SD: 42, TN: 318, TX: 376, UT: 116, VA: 196, VT: 48, WA: 125, WI: 79, WV: 140, WY: 69 };

function rows(): IndexRow[] {
  return Object.entries(REAL_COUNTS).flatMap(([state, count]) =>
    Array.from({ length: count }, (_, i) => ({ id: `${state}${i}`, st: [state] }) as unknown as IndexRow));
}

describe("state centres and boxes", () => {
  it("every state's centre lies inside its own box", () => {
    for (const [state, centre] of Object.entries(STATE_CENTRES)) {
      const box = STATE_BBOXES[state]!;
      expect(centre[1], state).toBeGreaterThanOrEqual(box[0]);
      expect(centre[1], state).toBeLessThanOrEqual(box[2]);
      expect(centre[0], state).toBeGreaterThanOrEqual(box[1]);
      expect(centre[0], state).toBeLessThanOrEqual(box[3]);
    }
  });
});

describe.each([[320, 568], [390, 844]])("country bubbles on a %ix%i phone", (width, height) => {
  const zoom = zoomForBounds([COUNTRY_EXTENT.minLon, COUNTRY_EXTENT.minLat, COUNTRY_EXTENT.maxLon, COUNTRY_EXTENT.maxLat], width - COUNTRY_INSETS.left - COUNTRY_INSETS.right, height - 62 - COUNTRY_INSETS.top - COUNTRY_INSETS.bottom);
  const bubbles = stateBubbles(rows(), zoom);
  const placed = bubbles.filter((bubble) => bubble.inset !== true);

  it("counts every ride exactly once", () => {
    expect(bubbles.reduce((sum, bubble) => sum + bubble.count, 0)).toBe(Object.values(REAL_COUNTS).reduce((a, b) => a + b, 0));
  });

  it("never overlaps two bubbles", () => {
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i]!; const b = placed[j]!;
        const gap = Math.hypot(worldX(a.lon, zoom) - worldX(b.lon, zoom), worldY(a.lat, zoom) - worldY(b.lat, zoom)) - (a.size! + b.size!) / 2;
        expect(gap, `${a.label} / ${b.label}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("keeps each bubble's centre inside the box of the states it counts", () => {
    for (const bubble of placed) {
      const states = bubble.states ?? [bubble.state!];
      const box = states.map((state) => STATE_BBOXES[state]!).reduce((u, b) => [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])]);
      expect(bubble.lon, bubble.label).toBeGreaterThanOrEqual(box[0] - 1e-6);
      expect(bubble.lon, bubble.label).toBeLessThanOrEqual(box[2] + 1e-6);
      expect(bubble.lat, bubble.label).toBeGreaterThanOrEqual(box[1] - 1e-6);
      expect(bubble.lat, bubble.label).toBeLessThanOrEqual(box[3] + 1e-6);
    }
  });

  it("gives Alaska and Hawaii a small labelled bubble each", () => {
    expect(bubbles.filter((bubble) => bubble.inset === true).map((bubble) => bubble.state).sort()).toEqual(["AK", "HI"]);
  });
});

describe("bubbleSize", () => {
  it("grows with the count but stays small", () => {
    expect(bubbleSize(1)).toBeLessThan(bubbleSize(100));
    expect(bubbleSize(1000)).toBeLessThanOrEqual(48);
  });
});
