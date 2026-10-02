import { describe, expect, it } from "vitest";

import { parsePennDotLocalRoads } from "@/infrastructure/roads/pa-penndot-local-source";

describe("PennDOT current local-road recon", () => {
  it("keeps gravel/unimproved as candidate hints instead of claiming exact surface", () => {
    const parsed = parsePennDotLocalRoads({
      type: "FeatureCollection",
      features: [{
        id: 42,
        properties: {
          OBJECTID: 42,
          LR_NAME: "Mountain Road",
          GRAVEL_MIL: 2.75,
          UNIMPROVED: 1.25,
          BITUMINOUS: 0.5,
          ROAD_OWNER: "TOWNSHIP",
          TRAFFIC_PA: 120,
        },
        geometry: {
          type: "LineString",
          coordinates: [[-75.9, 40.5], [-75.8, 40.6]],
        },
      }],
    });

    expect(parsed.truncated).toBe(false);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]).toMatchObject({
      name: "Mountain Road",
      surfaceHints: ["gravel-present", "unimproved-present"],
      roadOwner: "TOWNSHIP",
      trafficCount: 120,
      confidence: 0.95,
    });
    expect(parsed.records[0]?.notes.join(" ")).toMatch(/2\.75 mi gravel/);
    expect(parsed.records[0]?.notes.join(" ")).toMatch(/1\.25 mi unimproved/);
  });

  it("drops rows with no gravel or unimproved mileage", () => {
    const parsed = parsePennDotLocalRoads({
      type: "FeatureCollection",
      features: [{
        id: 7,
        properties: { OBJECTID: 7, LR_NAME: "Paved Road", GRAVEL_MIL: 0, UNIMPROVED: 0 },
        geometry: { type: "LineString", coordinates: [[-75.9, 40.5], [-75.8, 40.6]] },
      }],
    });
    expect(parsed.records).toEqual([]);
  });

  it("marks an ArcGIS transfer-limit response as truncated", () => {
    const parsed = parsePennDotLocalRoads({
      type: "FeatureCollection",
      exceededTransferLimit: true,
      features: [{
        id: 1,
        properties: { OBJECTID: 1, LR_NAME: "Gravel Road", GRAVEL_MIL: 1, UNIMPROVED: 0 },
        geometry: { type: "LineString", coordinates: [[-75.9, 40.5], [-75.8, 40.6]] },
      }],
    });
    expect(parsed.truncated).toBe(true);
  });
});
