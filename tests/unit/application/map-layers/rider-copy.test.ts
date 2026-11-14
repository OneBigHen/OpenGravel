import { describe, expect, it } from "vitest";
import { MAP_LAYERS, RIDER_MAP_LAYERS, layerRiderCopy } from "@/application/map-layers";

// Words that belong in code and engineering notes, never in front of a rider.
const FORBIDDEN = /\b(TODO|canonical|connector|Online only|feeds?|registry|NRT|DEM|MVUM|WZDx|AWS|routing authority|metres?|meters?)\b/i;

describe("rider-facing layer copy", () => {
  it.each(MAP_LAYERS.map((layer) => [layer.id, layer] as const))("%s has no engineering words", (_id, layer) => {
    for (const text of layerRiderCopy(layer)) expect(text).not.toMatch(FORBIDDEN);
  });

  it("keeps each layer's one-line description short", () => {
    for (const layer of MAP_LAYERS) {
      const [, , about] = layerRiderCopy(layer);
      expect(about!.length).toBeLessThanOrEqual(90);
    }
  });

  it("never offers a layer that has no working data source", () => {
    expect(RIDER_MAP_LAYERS.some((layer) => layer.id === "trail-closures")).toBe(false);
    expect(RIDER_MAP_LAYERS.length).toBe(MAP_LAYERS.length - 1);
  });

  it("describes contours in feet", () => {
    const contours = MAP_LAYERS.find((layer) => layer.id === "contours")!;
    expect(layerRiderCopy(contours).join(" ")).toMatch(/feet|ft/);
  });
});
