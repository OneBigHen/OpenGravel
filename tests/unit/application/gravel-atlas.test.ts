import { describe, expect, it } from "vitest";

import type { GravelAtlasPort } from "@/application/roads/gravel-atlas";
import { corridorsInReachableEllipse } from "@/application/roads/gravel-atlas";

function fakeAtlas(): GravelAtlasPort {
  const calls: { west: number; east: number; south: number; north: number }[] = [];
  return {
    corridorsNear(bounds, kind) {
      calls.push(bounds);
      return [{
        id: "dirt-1",
        kind,
        geometry: [{ lon: -77, lat: 40 }, { lon: -76.9, lat: 40.1 }],
        lengthMeters: 10_000,
        longestDirtRunMeters: 9_500,
        bendShare: 0.24,
        francoScore: 800,
        curvaturePerKm: 80,
        quality: 0.8,
        reversible: true,
        gradeMix: { grade2: 7_000, grade3: 3_000 },
        maxTrackGrade: 3,
        legalConfidence: 0.9,
        access: { legal: true, unknownRestrictionFlags: [], sandShare: 0 },
        seasonal: { closed: false, seasonalClosed: false, flags: [] },
        sourceIds: ["way/1"],
        areaHints: ["michaux"],
      }];
    },
    availability: () => ({ available: true, path: "/tmp/atlas.sqlite", schemaVersion: 3, corridorCount: 1 }),
  };
}

describe("Gravel Atlas application port", () => {
  it("queries the complete reachable ellipse between endpoints", () => {
    const result = corridorsInReachableEllipse(
      fakeAtlas(),
      { lon: -77, lat: 40 },
      { lon: -76, lat: 41 },
      10_000,
      "dirt",
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.gradeMix.grade3).toBe(3_000);
    expect(result[0]?.access.legal).toBe(true);
  });
});
