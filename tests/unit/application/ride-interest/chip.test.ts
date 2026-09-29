/**
 * The "coming up" chip (OGV#13): at most one, always the nearest ahead
 * point, worded as the rider reads it at a glance.
 */

import { describe, expect, it } from "vitest";

import { comingUpChip, kindLabel } from "@/application/ride-interest/chip";
import type { AheadRideInterestPoint } from "@/application/ride-interest/ahead-of-rider";
import type { RideInterestPoint } from "@/application/ride-interest/types";

function entry(id: string, aheadMiles: number, overrides: Partial<RideInterestPoint> = {}): AheadRideInterestPoint {
  const point: RideInterestPoint = {
    id,
    filter: "scenic",
    kind: "waterfall",
    name: "Test Falls",
    coordinate: { lon: -75.3, lat: 40 },
    summary: null,
    photoUrl: null,
    detailUrl: null,
    attribution: "Test",
    ...overrides,
  };
  return { point, aheadMiles, offRouteMiles: 0 };
}

describe("comingUpChip", () => {
  it("returns null for an empty list", () => {
    expect(comingUpChip([])).toBeNull();
  });

  it("picks the nearest (first) entry, trusting the caller's sort", () => {
    const nearer = entry("near", 0.8, { name: "Trap Falls" });
    const farther = entry("far", 3.2, { name: "Faraway Falls" });
    const chip = comingUpChip([nearer, farther]);
    expect(chip?.point.id).toBe("near");
  });

  it("formats sub-10-mile distances to one decimal and rounds farther ones", () => {
    expect(comingUpChip([entry("a", 0.83, { kind: "waterfall" })])?.label).toBe("Waterfall 0.8 mi");
    expect(comingUpChip([entry("b", 12.4, { kind: "viewpoint" })])?.label).toBe("Viewpoint 12 mi");
  });

  it("labels a kind it knows, and falls back to the raw kind otherwise", () => {
    expect(kindLabel("waterfall")).toBe("Waterfall");
    expect(kindLabel("fuel")).toBe("Gas");
    expect(kindLabel("public-art")).toBe("Public art");
    expect(kindLabel("some-unlisted-kind" as never)).toBe("some unlisted kind");
  });
});
