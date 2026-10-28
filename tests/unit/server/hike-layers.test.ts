import { describe, expect, it } from "vitest";
import { overpassQuery, parseOverpass } from "@/server/map-layers/providers";
import { parseHikingRelations, parseOsmMapRelations } from "@/server/map-layers/hiking-routes";
import { parseGameLands } from "@/server/map-layers/pa-game-lands";

describe("hiking OSM layers", () => {
  it("requests and identifies the mapped features without inventing water safety", () => {
    const layers = ["water-sources", "trailheads", "shelters", "summits"] as const;
    const query = overpassQuery({ west: -76, south: 40, east: -75, north: 41 }, layers);
    expect(query).toContain('"natural"="spring"');
    expect(query).toContain('"amenity"="drinking_water"');
    expect(query).toContain('"information"="trailhead"');
    const features = parseOverpass({ elements: [
      { type: "node", id: 1, lon: -75.5, lat: 40.5, tags: { natural: "spring" } },
      { type: "node", id: 2, lon: -75.5, lat: 40.5, tags: { tourism: "camp_site" } },
      { type: "node", id: 3, lon: -75.5, lat: 40.5, tags: { natural: "peak" } },
      { type: "node", id: 4, lon: -75.5, lat: 40.5, tags: { information: "trailhead" } },
    ] }, layers);
    expect(features.map((f) => f.layerId)).toEqual(["water-sources", "shelters", "summits", "trailheads"]);
    expect(features[0]?.detail).toBeNull();
  });

  it("keeps only real hiking relation member geometry and safe colours", () => {
    const features = parseHikingRelations({ elements: [
      { type: "relation", id: 7, tags: { route: "hiking", name: "Ridge Trail", colour: "blue" }, members: [{ type: "way", ref: 12, geometry: [{ lon: -75.6, lat: 40.5 }, { lon: -75.5, lat: 40.6 }] }] },
      { type: "relation", id: 8, tags: { route: "bicycle" }, members: [{ type: "way", ref: 13, geometry: [{ lon: -75.6, lat: 40.5 }, { lon: -75.5, lat: 40.6 }] }] },
      { type: "relation", id: 9, tags: { route: "foot", colour: "url(evil)" }, members: [{ type: "way", ref: 14, geometry: [{ lon: -75.6, lat: 40.5 }, { lon: -75.5, lat: 40.6 }] }] },
    ] }, { west: -76, south: 40, east: -75, north: 41 });
    expect(features).toHaveLength(2);
    expect(features[0]).toMatchObject({ id: "osm:relation/7/way/12", color: "#2869ae", geometry: { type: "LineString", coordinates: [[-75.6, 40.5], [-75.5, 40.6]] } });
    expect(features[1]?.color).toBeUndefined();
    expect(() => parseHikingRelations({ elements: [], remark: "runtime error" }, { west: -76, south: 40, east: -75, north: 41 })).toThrow();
  });

  it("preserves PGC boundary dates and never invents season dates", () => {
    const features = parseGameLands({ features: [{ properties: { OBJECTID: 1, sgl: 141, last_edited_date: Date.UTC(2026, 5, 18) }, geometry: { type: "MultiPolygon", coordinates: [[[[-75.6, 40.5], [-75.5, 40.5], [-75.5, 40.6], [-75.6, 40.5]]]] } }] }, "2026-10-27T00:00:00.000Z");
    expect(features[0]).toMatchObject({ name: "State Game Lands 141", detail: "Pennsylvania Game Commission · boundary updated 2026-06-18 · retrieved 2026-10-27 · Season dates: check PGC", geometry: { type: "Polygon" } });
    expect(() => parseGameLands({ features: [], exceededTransferLimit: true }, "2026-10-27T00:00:00.000Z")).toThrow();
  });

  it("reconstructs only complete relation ways in an OSM map response", () => {
    const bounds = { west: -76, south: 40, east: -75, north: 41 };
    const features = parseOsmMapRelations({ elements: [
      { type: "node", id: 1, lon: -75.6, lat: 40.5 },
      { type: "node", id: 2, lon: -75.5, lat: 40.6 },
      { type: "way", id: 3, nodes: [1, 2] },
      { type: "way", id: 4, nodes: [1, 999] },
      { type: "relation", id: 5, tags: { route: "foot", name: "Foot route" }, members: [{ type: "way", ref: 3 }, { type: "way", ref: 4 }, { type: "way", ref: 6 }] },
    ] }, bounds);
    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({ id: "osm:relation/5/way/3", geometry: { type: "LineString", coordinates: [[-75.6, 40.5], [-75.5, 40.6]] } });
  });
});
