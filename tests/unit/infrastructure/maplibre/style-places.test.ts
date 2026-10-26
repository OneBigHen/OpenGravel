import { describe, expect, it } from "vitest";

import { infoLayerSpecs } from "@/infrastructure/map/maplibre/info-layers";
import {
  DEFAULT_MAP_PALETTE,
  MAP_LAYER_IDS,
  MAP_SOURCE_IDS,
  overlayLayers,
  placeLayers,
} from "@/infrastructure/map/maplibre/style";

describe("place map layers", () => {
  it("draws place marks first, below the route and editing overlays", () => {
    const layers = overlayLayers(DEFAULT_MAP_PALETTE);
    const firstRoute = layers.findIndex((layer) => layer.id === MAP_LAYER_IDS.routeSelected);
    const firstPlace = layers.findIndex((layer) => layer.id === MAP_LAYER_IDS.placeDot);
    const firstSketch = layers.findIndex((layer) => layer.id === MAP_LAYER_IDS.sketchLine);

    // Map-layer information (phase 8) sits under places; places lead the rest.
    expect(firstPlace).toBe(infoLayerSpecs(DEFAULT_MAP_PALETTE).length);
    expect(firstPlace).toBeLessThan(firstRoute);
    expect(firstPlace).toBeLessThan(firstSketch);
    expect(layers.filter((layer) => layer.source === MAP_SOURCE_IDS.places).length).toBeGreaterThan(1);
  });

  it("uses the place palette without Ember or Signal Blue", () => {
    const placePaint = placeLayers(DEFAULT_MAP_PALETTE)
      .map((layer) => layer.paint ?? {})
      .map((paint) => JSON.stringify(paint))
      .join(" ");

    expect(placePaint).not.toContain(DEFAULT_MAP_PALETTE.ember);
    expect(placePaint).not.toContain(DEFAULT_MAP_PALETTE.emberStrong);
    expect(placePaint).not.toContain(DEFAULT_MAP_PALETTE.signalBlue);
    expect(placePaint).toContain(DEFAULT_MAP_PALETTE.goldenHour);
  });

  it("keeps search circle pins at street zoom without relying on text glyphs", () => {
    const dot = placeLayers(DEFAULT_MAP_PALETTE).find((layer) => layer.id === MAP_LAYER_IDS.placeDot);
    expect(dot?.maxzoom).toBeUndefined();
    expect(dot?.paint?.["circle-radius"]).toEqual(["case", ["==", ["get", "kind"], "search"], 8, ["match", ["get", "tone"], "live", 5, 4]]);
    expect(dot?.paint?.["circle-opacity"]).toEqual(["step", ["zoom"], ["match", ["get", "tone"], "live", 1, "soon", 0.85, 0.6], 11.5, ["case", ["==", ["get", "kind"], "search"], 1, 0]]);
  });

  it("keeps the selected pill visible through symbol collisions", () => {
    const selected = placeLayers(DEFAULT_MAP_PALETTE).find(
      (layer) => layer.id === MAP_LAYER_IDS.placeSelected,
    );

    expect(selected?.filter).toEqual(["==", ["get", "selected"], true]);
    expect(selected?.layout).toMatchObject({
      "icon-allow-overlap": true,
      "text-allow-overlap": true,
    });
    expect(selected?.layout?.["text-field"]).toEqual(["get", "pill"]);
  });
});
