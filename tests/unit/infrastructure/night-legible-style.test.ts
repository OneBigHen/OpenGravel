import { describe, expect, it } from "vitest";
import { toNightLegible } from "@/infrastructure/map/night-legible-style";
import { contrastRatio } from "../../helpers/contrast";

/** A slice of OpenFreeMap's `dark` style, with its own near-black paint. */
function darkStyle() {
  return {
    version: 8,
    layers: [
      { id: "background", type: "background", paint: { "background-color": "rgb(12,12,12)" } },
      { id: "highway_minor", type: "line", paint: { "line-color": "#181818", "line-width": 1 } },
      { id: "highway_major_inner", type: "line", paint: { "line-color": "hsl(0,0%,7%)" } },
      { id: "place_town", type: "symbol", paint: { "text-color": "rgb(101,101,101)" } },
      { id: "place_city", type: "symbol", paint: { "text-color": "rgb(101,101,101)" } },
      { id: "something_new", type: "line", paint: { "line-color": "#123456" } },
    ],
  };
}

describe("the Night basemap without Mapbox (OpenFreeMap dark, repainted)", () => {
  it("draws labels a rider can read and a road hierarchy on the Night ground", () => {
    const style = toNightLegible(darkStyle());
    const paint = (id: string) => style.layers.find((layer) => layer.id === id)?.paint as unknown as Record<string, string | number>;
    const ground = paint("background")["background-color"] as string;
    expect(ground).toBe("#0b100e");
    // Town and city names clear body-text contrast on the ground, with a halo.
    expect(contrastRatio(paint("place_town")["text-color"] as string, ground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(paint("place_city")["text-color"] as string, ground)).toBeGreaterThanOrEqual(7);
    expect(paint("place_town")["text-halo-color"]).toBe(ground);
    // Bigger roads are lighter than smaller ones; all are visible on the ground.
    const minor = contrastRatio(paint("highway_minor")["line-color"] as string, ground);
    const major = contrastRatio(paint("highway_major_inner")["line-color"] as string, ground);
    expect(minor).toBeGreaterThan(1.4);
    expect(major).toBeGreaterThan(minor);
    // Layout and widths are untouched; a layer it does not know keeps its paint.
    expect(paint("highway_minor")["line-width"]).toBe(1);
    expect(paint("something_new")["line-color"]).toBe("#123456");
  });
});
