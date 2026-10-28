import { describe, expect, it, vi } from "vitest";

import {
  EMERGENCY_ROAD_LAYERS,
  readRoadsNear,
  roadLayersVisible,
  roadLinesFromFeatures,
} from "@/application/safety/emergency-roads";
import type { InfoFeature, MapLayersResult, MapLayersSource } from "@/application/map-layers";
import type { Coordinate } from "@/domain/ride/types";

const POINT: Coordinate = { lat: 40.6414, lon: -75.9808 };

function feature(overrides: Partial<InfoFeature> & Pick<InfoFeature, "id" | "layerId">): InfoFeature {
  return {
    name: "Road",
    detail: null,
    weight: null,
    geometry: { type: "LineString", coordinates: [[POINT.lon, POINT.lat], [POINT.lon + 0.01, POINT.lat]] },
    ...overrides,
  };
}

/** A source whose one answer the test controls. */
function source(result: MapLayersResult | Error): {
  readonly source: MapLayersSource;
  readonly load: ReturnType<typeof vi.fn>;
} {
  const load = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return {
    load,
    source: {
      load: load as unknown as MapLayersSource["load"],
      trafficTileUrl: null,
    },
  };
}

const EMPTY: MapLayersResult = { features: [], unavailable: [] };

describe("roadLinesFromFeatures", () => {
  it("keeps named road lines and drops points, polygons and non-road layers", () => {
    const lines = roadLinesFromFeatures([
      feature({ id: "curvy:1", layerId: "great-roads", name: "Ridge Road" }),
      feature({ id: "gravel:2", layerId: "gravel", name: "Dirt road" }),
      feature({ id: "mvum:3", layerId: "mvum", name: "Forest Road 42" }),
      feature({ id: "fuel:4", layerId: "fuel", name: "Gas" }),
      feature({
        id: "camp:5",
        layerId: "camping",
        geometry: { type: "Point", coordinates: [POINT.lon, POINT.lat] },
      }),
      feature({ id: "one:6", layerId: "great-roads", geometry: { type: "LineString", coordinates: [] } }),
    ]);
    expect(lines.map((road) => road.name)).toEqual(["Forest Road 42", "Ridge Road", "Dirt road"]);
    expect(lines[1]?.line).toHaveLength(2);
  });

  it("puts the authoritative forest road first on equal distance", () => {
    const lines = roadLinesFromFeatures([
      feature({ id: "curvy:1", layerId: "great-roads" }),
      feature({ id: "authority:usfs:42", layerId: "mvum" }),
    ]);
    expect(lines.map((road) => road.id)).toEqual(["authority:usfs:42", "curvy:1"]);
  });
});

describe("roadLayersVisible", () => {
  it("is true only when a road layer is drawn", () => {
    expect(roadLayersVisible(["fuel", "great-roads"])).toBe(true);
    expect(roadLayersVisible(["fuel", "camping"])).toBe(false);
    expect(roadLayersVisible([])).toBe(false);
  });
});

describe("readRoadsNear", () => {
  it("asks only for road layers, in a small box around the point", async () => {
    const { source: mapLayers, load } = source(EMPTY);
    await readRoadsNear(mapLayers, POINT);
    const [bounds, layers] = load.mock.calls[0] as [{ west: number; south: number; east: number; north: number }, readonly string[]];
    expect(layers).toEqual(EMERGENCY_ROAD_LAYERS);
    expect(bounds.north - bounds.south).toBeCloseTo(0.11, 2);
    expect(bounds.east - bounds.west).toBeCloseTo(0.15, 2);
    expect(bounds.south).toBeLessThan(POINT.lat);
    expect(bounds.north).toBeGreaterThan(POINT.lat);
  });

  it("reports a loaded, empty answer as loaded", async () => {
    const { source: mapLayers } = source(EMPTY);
    await expect(readRoadsNear(mapLayers, POINT)).resolves.toEqual({ roads: [], loaded: true });
  });

  it("reports a failed provider as unknown, never as an empty map", async () => {
    const { source: mapLayers } = source({ features: [], unavailable: ["roads", "authority"] });
    await expect(readRoadsNear(mapLayers, POINT)).resolves.toEqual({ roads: [], loaded: false });
    const offline = source(new Error("offline"));
    await expect(readRoadsNear(offline.source, POINT)).resolves.toEqual({ roads: [], loaded: false });
  });

  it("keeps road lines when the other providers were unavailable", async () => {
    const { source: mapLayers } = source({
      features: [feature({ id: "mvum:1", layerId: "mvum", name: "Forest Road 42" })],
      unavailable: ["nws"],
    });
    const read = await readRoadsNear(mapLayers, POINT);
    expect(read.loaded).toBe(true);
    expect(read.roads.map((road) => road.name)).toEqual(["Forest Road 42"]);
  });
});
