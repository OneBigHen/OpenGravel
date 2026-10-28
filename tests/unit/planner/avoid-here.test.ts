import { expect, it } from "vitest";
import { avoidHereRing } from "@/application/planner/avoid-here";
import { validateAvoidAreaRings } from "@/application/planner/avoid-area-geometry";

it("creates a valid small area around the selected point", () => {
  const point = { lat: 40.8, lon: -75.7 };
  const ring = avoidHereRing(point);
  expect(validateAvoidAreaRings([ring])).toBeNull();
  expect(ring[0]).toEqual(ring[ring.length - 1]);
  expect(Math.min(...ring.map((p) => p.lat))).toBeLessThan(point.lat);
  expect(Math.max(...ring.map((p) => p.lat))).toBeGreaterThan(point.lat);
});
