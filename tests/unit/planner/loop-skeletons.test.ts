import { describe, expect, it } from "vitest";
import { distanceMeters, planLoopRings, type RingAnchor } from "@/application/planner/loop-skeletons";

const start = { lat: 40.1749, lon: -75.1064 };

function field(): RingAnchor[] {
  const anchors: RingAnchor[] = [];
  let n = 0;
  for (let dy = -0.3; dy <= 0.3; dy += 0.03) {
    for (let dx = -0.4; dx <= 0.4; dx += 0.04) {
      anchors.push({ id: `a${n++}`, lat: start.lat + dy, lon: start.lon + dx, quality: 0.3 + ((n * 7) % 10) / 20, lengthMeters: 3000 });
    }
  }
  return anchors;
}

const input = { start, loopMeters: 100_000, seedKey: "k", anchors: field() };

describe("planLoopRings", () => {
  it("gives the same rings for the same ask", () => {
    expect(planLoopRings(input)).toEqual(planLoopRings(input));
  });

  it("makes up to three rings at least 60 degrees apart, never reusing a corridor in a ring", () => {
    const rings = planLoopRings(input);
    expect(rings.length).toBeGreaterThanOrEqual(2);
    expect(rings.length).toBeLessThanOrEqual(3);
    for (const a of rings) for (const b of rings) {
      if (a !== b) expect(Math.min(Math.abs(a.bearing - b.bearing), 360 - Math.abs(a.bearing - b.bearing))).toBeGreaterThanOrEqual(60);
    }
    for (const ring of rings) {
      expect(new Set(ring.anchorIds).size).toBe(ring.anchorIds.length);
      expect(ring.anchors.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("only uses anchors it was given", () => {
    const ids = new Set(input.anchors.map((a) => a.id));
    for (const ring of planLoopRings(input)) for (const id of ring.anchorIds) expect(ids.has(id)).toBe(true);
  });

  it("puts the first ring toward the rider's heading", () => {
    const rings = planLoopRings({ ...input, heading: 90 });
    expect(rings[0]?.bearing).toBe(90);
  });

  it("a bigger scale pushes the anchors farther out", () => {
    const small = planLoopRings(input, [0.6, 0.6, 0.6])[0];
    const large = planLoopRings(input, [1.6, 1.6, 1.6])[0];
    const far = (r: typeof small): number => Math.max(...(r?.anchors ?? []).map((p) => distanceMeters(start, p)));
    expect(far(large)).toBeGreaterThan(far(small));
  });

  it("returns nothing with fewer than two anchors", () => {
    expect(planLoopRings({ ...input, anchors: field().slice(0, 1) })).toEqual([]);
  });
});
