import { describe, expect, it } from "vitest";
import { projectSurface, surfaceProvider } from "@/server/map-layers/surface";
import { createKnownRoadsDb } from "@/server/roads/known-roads-db";
describe("canonical surface map projection", () => {
  it("projects the same Gravel Atlas line and routing confidence without implying access", () => {
    const features = projectSurface([{ id: "g", label: "Old Mine Road", confidence: 0.7, line: [{ lon: -75, lat: 40 }, { lon: -75.1, lat: 40.1 }] }]);
    expect(features[0]?.weight).toBe(0.7);
    expect(features[0]?.detail).toContain("70%");
    expect(features[0]?.detail).toContain("not legal access");
    expect(features[0]?.geometry).toMatchObject({ type: "LineString", coordinates: [[-75, 40], [-75.1, 40.1]] });
  });
  it("rejects invalid geometry or confidence instead of inventing surface evidence", () => {
    expect(() => projectSurface([{ id: "bad", label: "", confidence: NaN, line: [] }])).toThrow();
  });
  it("reports a missing canonical catalogue as unavailable, never no gravel", async () => {
    expect(createKnownRoadsDb({}).catalogAvailable?.("gravel")).toBe(false);
    await expect(surfaceProvider.snapshot!({ west: -76, south: 40, east: -75, north: 41 }, ["road-surface"], { env: {}, fetch })).rejects.toThrow();
  });
});
