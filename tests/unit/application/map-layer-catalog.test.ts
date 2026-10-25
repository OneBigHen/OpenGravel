import { describe, expect, it } from "vitest";

import { MAP_LAYERS, MAP_LAYER_LENSES, type MapLayerId } from "@/application/map-layers";

const TOMTOM_STOP_LAYERS: readonly MapLayerId[] = [
  "fuel",
  "food",
  "coffee",
  "viewpoints",
  "camping",
  "lodging",
  "repair",
];

describe("map layer catalogue provenance", () => {
  it("names TomTom for every stop layer currently served by the TomTom adapter", () => {
    const definitions = new Map(MAP_LAYERS.map((layer) => [layer.id, layer]));

    for (const id of TOMTOM_STOP_LAYERS) {
      expect(definitions.get(id)?.source).toBe("TomTom Search");
      expect(definitions.get(id)?.caveat).toMatch(/Provider POI/);
    }
  });

  it("describes weather coverage as map-center scoped", () => {
    const weather = MAP_LAYERS.find((layer) => layer.id === "weather");
    expect(weather?.legend).toContain("center");
    expect(weather?.caveat).toContain("not every visible point");
  });

  it("no longer offers the Overpass layers that failed on every request", () => {
    const ids = new Set(MAP_LAYERS.map((layer) => layer.id));
    for (const id of ["forest-roads", "cell-towers", "closures", "road-surface"]) expect(ids.has(id as never)).toBe(false);
  });

  it("builds every lens from layers the panel offers", () => {
    const ids = new Set(MAP_LAYERS.map((layer) => layer.id));
    for (const lens of MAP_LAYER_LENSES) for (const id of lens.layers) expect(ids.has(id)).toBe(true);
  });

  it("credits PAD-US first and OSM as the fallback for public land", () => {
    const publicLand = MAP_LAYERS.find((layer) => layer.id === "public-land");
    expect(publicLand?.source).toBe("USGS PAD-US (OpenStreetMap fallback)");
  });
});
