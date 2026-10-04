import { describe, expect, it } from "vitest";

import { classify, corridorQuality, mergeWays } from "../../../scripts/build-gravel-atlas";

function way(id: string, properties: Record<string, string>, coordinates: number[][]) {
  return { geometry: { type: "LineString", coordinates }, properties: { "@id": `way/${id}`, ...properties } };
}

describe("Gravel Atlas builder", () => {
  it("keeps motor-legal dirt and drops sand, private, no-motor-vehicle and paved grade-1 track", () => {
    const line = [[-77.5, 40.0], [-77.49, 40.01]];
    expect(classify(way("1", { highway: "track", tracktype: "grade2" }, line))?.kind).toBe("dirt");
    expect(classify(way("2", { highway: "unclassified", surface: "gravel" }, line))?.kind).toBe("dirt");
    expect(classify(way("3", { highway: "track", surface: "sand" }, line))).toBeNull();
    expect(classify(way("4", { highway: "track", tracktype: "grade2", access: "private" }, line))).toBeNull();
    expect(classify(way("5", { highway: "track", tracktype: "grade2", motor_vehicle: "no" }, line))).toBeNull();
    expect(classify(way("6", { highway: "track", tracktype: "grade1" }, line))).toBeNull();
    expect(classify(way("7", { highway: "track", tracktype: "grade5" }, line))).toBeNull();
    expect(classify(way("8", { highway: "path", surface: "gravel" }, line))).toBeNull();
    expect(classify(way("9", { highway: "path", surface: "gravel", motorcycle: "yes" }, line))?.kind).toBe("dirt");
    expect(classify(way("10", { highway: "tertiary", surface: "asphalt" }, line))?.kind).toBe("backroad");
  });

  it("chains ways through two-way nodes into one corridor and never branches", () => {
    const ways = [
      classify(way("a", { highway: "track", tracktype: "grade2", name: "Forest Rd" }, [[-77.5, 40.0], [-77.49, 40.0]])),
      classify(way("b", { highway: "track", tracktype: "grade2", name: "Forest Rd" }, [[-77.48, 40.0], [-77.49, 40.0]])),
      classify(way("c", { highway: "track", tracktype: "grade2", name: "Forest Rd" }, [[-77.48, 40.0], [-77.47, 40.0]])),
      // A different road joining at the same node must not be pulled in.
      classify(way("d", { highway: "track", tracktype: "grade2", name: "Spur" }, [[-77.49, 40.0], [-77.49, 40.01]])),
    ].flatMap((value) => (value === null ? [] : [value]));
    const corridors = mergeWays(ways);
    const main = corridors.find((corridor) => corridor.sourceIds.includes("way/a"));
    expect(main?.sourceIds).toEqual(["way/a", "way/b", "way/c"]);
    expect(main?.line[0]?.lon).toBeCloseTo(-77.5, 5);
    expect(main?.line.at(-1)?.lon).toBeCloseTo(-77.47, 5);
  });

  it("scores longer, curvier, kinder corridors higher", () => {
    const base = { lengthMeters: 6_000, curvaturePerKm: 100, legalConfidence: 0.9, roughShare: 0 };
    expect(corridorQuality({ ...base, curvaturePerKm: 400 })).toBeGreaterThan(corridorQuality(base));
    expect(corridorQuality({ ...base, roughShare: 1 })).toBeLessThan(corridorQuality(base));
    expect(corridorQuality({ ...base, legalConfidence: 0.5 })).toBeLessThan(corridorQuality(base));
  });
});
