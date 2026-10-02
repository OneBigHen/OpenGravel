import { describe, expect, it } from "vitest";

import { MAP_LAYERS, type MapLayerId } from "@/application/map-layers";

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

  it("keeps OSM provenance on the access layers that are actually served by Overpass", () => {
    const definitions = new Map(MAP_LAYERS.map((layer) => [layer.id, layer]));

    for (const id of ["public-land", "forest-roads", "cell-towers"] as const) {
      expect(definitions.get(id)?.source).toBe("OpenStreetMap");
    }
  });
});
