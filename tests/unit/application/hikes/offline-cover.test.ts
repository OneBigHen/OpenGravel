import { describe, expect, it } from "vitest";
import { coveringRegion, coversTrail } from "@/application/hikes/offline-cover";

const pa = { regionId: "pa", bounds: { minLon: -80.6, minLat: 39.7, maxLon: -74.6, maxLat: 42.3 } };
const east = { regionId: "pa-east", bounds: { minLon: -77, minLat: 39.7, maxLon: -74.6, maxLat: 42.3 } };
const nj = { regionId: "nj", bounds: { minLon: -75.6, minLat: 38.9, maxLon: -73.9, maxLat: 41.4 } };

describe("offline cover", () => {
  it("needs the whole trail inside the region", () => {
    expect(coversTrail(pa.bounds, [-76, 40.6, -75.9, 40.7])).toBe(true);
    expect(coversTrail(nj.bounds, [-76, 40.6, -75.9, 40.7])).toBe(false);
  });
  it("picks the smallest region that covers the trail", () => {
    expect(coveringRegion([pa, east, nj], [-76, 40.6, -75.9, 40.7])?.regionId).toBe("pa-east");
    expect(coveringRegion([nj], [-76, 40.6, -75.9, 40.7])).toBeNull();
  });
});
