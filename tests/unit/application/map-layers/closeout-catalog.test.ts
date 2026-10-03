import { describe, expect, it } from "vitest";
import { MAP_LAYERS } from "@/application/map-layers";

describe("terrain catalog", () => {
  it.each(["hillshade", "contours", "slope"])("offers %s with honest resolution and legend", (id) => {
    const layer = MAP_LAYERS.find((entry) => entry.id === id);
    expect(layer).toBeDefined();
    expect(layer?.source).toContain("Terrarium");
    expect(layer?.caveat).toContain("resolution");
    expect(layer?.legend).toBeTruthy();
  });
});
it("offers timestamped NOAA radar with coverage limits", () => {
  const radar = MAP_LAYERS.find((entry) => entry.id === "weather-radar");
  expect(radar?.source).toContain("NOAA");
  expect(radar?.caveat).toContain("Stale");
});
it("offers FIRMS hotspots separately from closures", () => {
  const layer = MAP_LAYERS.find((entry) => entry.id === "active-fire");
  expect(layer?.source).toContain("NASA");
  expect(layer?.caveat).toContain("Hotspots are not road closures");
});
it("uses PAD-US as primary protected land and names OSM fallback", () => {
  const layer = MAP_LAYERS.find((entry) => entry.id === "public-land");
  expect(layer?.source).toContain("PAD-US");
  expect(layer?.caveat).toContain("motorized access");
});
it.each(["mvum", "work-zones"])("exposes canonical %s authority separately from OSM context", (id) => {
  const layer = MAP_LAYERS.find((entry) => entry.id === id);
  expect(layer).toBeDefined();
  expect(layer?.caveat).toContain("unknown");
});
it("offers scoped canonical surface evidence with confidence and unknown gaps", () => {
  const layer = MAP_LAYERS.find((entry) => entry.id === "road-surface");
  expect(layer?.source).toContain("Gravel Atlas");
  expect(layer?.caveat).toContain("unknown");
});
