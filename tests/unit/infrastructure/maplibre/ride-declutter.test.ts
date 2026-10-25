import { describe, expect, it } from "vitest";

import { declutterTargets, gasOnlyFilter, isBasemapPoiLayer } from "@/infrastructure/map/maplibre/ride-declutter";

describe("ride map declutter", () => {
  it("recognises the basemap's own POI label layers and nothing of ours", () => {
    expect(isBasemapPoiLayer({ id: "poi-label", type: "symbol" })).toBe(true);
    expect(isBasemapPoiLayer({ id: "poi_r20", type: "symbol" })).toBe(true);
    expect(isBasemapPoiLayer({ id: "poi_transit", type: "symbol" })).toBe(true);
    // Road names, places and our own layers stay.
    expect(isBasemapPoiLayer({ id: "road-label", type: "symbol" })).toBe(false);
    expect(isBasemapPoiLayer({ id: "place_village", type: "symbol" })).toBe(false);
    expect(isBasemapPoiLayer({ id: "ogv-places-label", type: "symbol" })).toBe(false);
    expect(isBasemapPoiLayer({ id: "og-poi-pins", type: "symbol" })).toBe(false);
    // Only symbols are labels.
    expect(isBasemapPoiLayer({ id: "poi-area", type: "fill" })).toBe(false);
  });

  it("narrows to gas stations, keeping the style's own filter", () => {
    const gas = gasOnlyFilter(null) as unknown[];
    expect(gas[0]).toBe("any");
    expect(JSON.stringify(gas)).toContain('"fuel"');
    const original = ["==", ["get", "type"], "x"];
    expect(gasOnlyFilter(original)).toEqual(["all", original, gas]);
  });

  it("lists each POI layer with the filter it came with so leaving the ride can restore it", () => {
    const targets = declutterTargets([
      { id: "land", type: "fill" },
      { id: "poi-label", type: "symbol", filter: ["has", "name"] },
      { id: "poi_r1", type: "symbol" },
      { id: "road-label", type: "symbol" },
    ]);
    expect(targets).toEqual([
      { id: "poi-label", original: ["has", "name"] },
      { id: "poi_r1", original: null },
    ]);
  });
});
