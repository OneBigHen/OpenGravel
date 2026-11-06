import { describe, it, expect } from "vitest";
import { featureGrid, alongTrailFeatures } from "../../../../infra/trails/lib/features";
const node = (id: number, lon: number, lat: number, properties = { tourism: "viewpoint" }) => ({ properties: { "@type": "node", "@id": id, ...properties }, geometry: { type: "Point", coordinates: [lon, lat] } });
describe("along-trail OSM features", () => {
  it("matches a segment interior, excludes distant points, retains licence and along-distance", () => {
    const grid = featureGrid([node(1,-75,40.005),node(2,-74.99,40.005)]);
    const result = alongTrailFeatures([[{lon:-75,lat:40},{lon:-75,lat:40.01}]],grid);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "osm:node/1", kind: "viewpoint", distanceFromTrailMeters: 0, lineIndex: 0, source: { licence: "ODbL 1.0", url: "https://www.openstreetmap.org/node/1" } });
    expect(result[0]!.distanceAlongMeters).toBeCloseTo(556,-1);
  });
  it("detects a river crossing without a nearby vertex and deduplicates repeated encounters", () => {
    const river = { properties: { "@type": "way", "@id": 2, waterway: "river" }, geometry: { type: "LineString", coordinates: [[-75.01,40.005],[-74.99,40.005]] } };
    const grid = featureGrid([river,river]);
    const result = alongTrailFeatures([[{lon:-75,lat:40},{lon:-75,lat:40.01},{lon:-75,lat:40}]],grid);
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe("water");
    expect(result[0]!.distanceFromTrailMeters).toBe(0);
  });
  it("never matches across a gap or includes its length", () => {
    const grid = featureGrid([node(1,-75,40.02),node(2,-75,40.032)]);
    const result = alongTrailFeatures([[{lon:-75,lat:40},{lon:-75,lat:40.01}],[{lon:-75,lat:40.03},{lon:-75,lat:40.04}]],grid);
    expect(result).toHaveLength(1);
    expect(result[0]!.lineIndex).toBe(1);
    expect(result[0]!.distanceAlongMeters).toBeCloseTo(1334,-1);
  });
});
