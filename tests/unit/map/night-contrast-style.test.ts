/** Night contrast: the dark-gray high-contrast repaint of navigation-night. */

import { describe, expect, it } from "vitest";

import { NIGHT_CONTRAST, toNightContrast } from "@/infrastructure/map/night-contrast-style";

const STYLE: { version: number; sources: Record<string, unknown>; layers: { id: string; type: string; source?: string; layout?: Record<string, unknown>; paint?: Record<string, unknown> }[] } = {
  version: 8,
  sources: { composite: { type: "vector" }, "mapbox-traffic": { type: "vector" } },
  layers: [
    { id: "land", type: "background", paint: { "background-color": "hsl(214, 17%, 31%)" } },
    { id: "water", type: "fill", source: "composite", paint: { "fill-color": "hsl(197, 15%, 43%)" } },
    { id: "road-street-case-navigation", type: "line", source: "composite", paint: { "line-color": "red" } },
    { id: "road-street-navigation", type: "line", source: "composite", paint: { "line-color": "red", "line-width": 3 } },
    { id: "road-motorway-trunk-navigation", type: "line", source: "composite", paint: { "line-color": "red" } },
    { id: "traffic-road-street-navigation", type: "line", source: "mapbox-traffic", paint: {} },
    { id: "settlement-major-label", type: "symbol", source: "composite", layout: { "text-field": ["get", "name"] }, paint: { "text-color": "blue" } },
    { id: "road-number-shield-navigation", type: "symbol", source: "composite", layout: { "text-field": ["get", "ref"] }, paint: { "text-color": "white" } },
  ],
};

describe("toNightContrast", () => {
  const night = toNightContrast(STYLE);
  const layer = (id: string) => night.layers.find((entry) => entry.id === id);

  it("drops live traffic layers and their source", () => {
    expect(layer("traffic-road-street-navigation")).toBeUndefined();
    expect(night.sources).not.toHaveProperty("mapbox-traffic");
  });

  it("paints dark-gray land and blue water", () => {
    expect(layer("land")?.paint?.["background-color"]).toBe(NIGHT_CONTRAST.land);
    expect(layer("water")?.paint?.["fill-color"]).toBe(NIGHT_CONTRAST.water);
  });

  it("draws roads brighter than the land on near-black casings, and unpaved roads tan", () => {
    expect(layer("road-street-case-navigation")?.paint?.["line-color"]).toBe(NIGHT_CONTRAST.casing);
    expect(layer("road-motorway-trunk-navigation")?.paint?.["line-color"]).toBe(NIGHT_CONTRAST.motorway);
    expect(layer("road-street-navigation")?.paint?.["line-color"]).toEqual([
      "match", ["get", "surface"], "unpaved", NIGHT_CONTRAST.unpaved, NIGHT_CONTRAST.street,
    ]);
    // Geometry and widths are kept.
    expect(layer("road-street-navigation")?.paint?.["line-width"]).toBe(3);
  });

  it("gives labels a light colour on a heavy halo, but leaves shields alone", () => {
    expect(layer("settlement-major-label")?.paint?.["text-color"]).toBe(NIGHT_CONTRAST.label);
    expect(layer("settlement-major-label")?.paint?.["text-halo-color"]).toBe(NIGHT_CONTRAST.halo);
    expect(layer("road-number-shield-navigation")?.paint?.["text-color"]).toBe("white");
  });

  it("does not mutate its input", () => {
    expect(STYLE.layers[0]?.paint?.["background-color"]).toBe("hsl(214, 17%, 31%)");
    expect(STYLE.sources).toHaveProperty("mapbox-traffic");
  });
});
