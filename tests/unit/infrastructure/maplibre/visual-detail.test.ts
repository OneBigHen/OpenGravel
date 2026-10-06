import { describe, expect, it } from "vitest";

import {
  BUILDING_EXTRUSION_LAYER_ID,
  HILLSHADE_LAYER_ID,
  TERRAIN_EXAGGERATION,
  buildingExtrusionLayerSpec,
  buildingInsertion,
  hillshadeBeforeId,
  hillshadeLayerSpec,
  terrainSourceSpec,
  type HostedStyleLayer,
} from "@/infrastructure/map/maplibre/visual-detail";

describe("MapLibre visual detail", () => {
  it("keeps terrain realistic and on the existing bounded DEM contract", () => {
    expect(TERRAIN_EXAGGERATION).toBe(1.1);
    expect(terrainSourceSpec()).toMatchObject({
      type: "raster-dem",
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 14,
    });
  });

  it("places hillshade below roads when the style exposes transportation", () => {
    const layers: HostedStyleLayer[] = [
      { id: "land", type: "fill" },
      { id: "minor-road", type: "line", source: "openmaptiles", "source-layer": "transportation" },
      { id: "road-label", type: "symbol" },
    ];

    expect(hillshadeBeforeId(layers)).toBe("minor-road");
    expect(hillshadeLayerSpec()).toMatchObject({
      id: HILLSHADE_LAYER_ID,
      type: "hillshade",
    });
  });

  it("falls back to putting hillshade below labels", () => {
    expect(
      hillshadeBeforeId([
        { id: "land", type: "fill" },
        { id: "place-label", type: "symbol" },
      ]),
    ).toBe("place-label");
  });

  it("reuses the hosted style building source and keeps labels above extrusion", () => {
    const layers: HostedStyleLayer[] = [
      { id: "building-flat", type: "fill", source: "openfreemap", "source-layer": "building" },
      { id: "road-label", type: "symbol", source: "openfreemap", "source-layer": "transportation_name" },
    ];

    expect(buildingInsertion(layers)).toEqual({
      source: "openfreemap",
      beforeId: "road-label",
    });
    expect(buildingExtrusionLayerSpec("openfreemap")).toMatchObject({
      id: BUILDING_EXTRUSION_LAYER_ID,
      type: "fill-extrusion",
      source: "openfreemap",
      "source-layer": "building",
      minzoom: 15,
    });
  });

  it("does not invent a building source when the basemap has none", () => {
    expect(buildingInsertion([{ id: "place-label", type: "symbol" }])).toBeNull();
  });
});

it("uses the active Day/Night palette for hillshade", () => {
  expect(hillshadeLayerSpec({ paper: "night-paper", deepSpruce: "night-spruce", slate: "night-slate" })).toMatchObject({ paint: { "hillshade-highlight-color": "rgba(0, 0, 0, 0)", "hillshade-shadow-color": "night-spruce", "hillshade-accent-color": "rgba(0, 0, 0, 0)" } });
});

it("makes the requested hillshade visible over existing relief and satellite imagery", () => {
  expect(hillshadeLayerSpec()).toMatchObject({ paint: { "hillshade-exaggeration": 0.3 } });
  expect(hillshadeBeforeId([
    { id: "land", type: "fill" },
    { id: "tunnel-street", type: "line", "source-layer": "road" },
    { id: "og-satellite", type: "raster" },
    { id: "road-minor", type: "line" },
    { id: "label", type: "symbol" },
  ])).toBe("road-minor");
});

// Lit terrain must reveal the basemap, including its roads and water colors.
it("does not paint a pale mask over the basemap on lit terrain", () => {
  for (const palette of [undefined, { paper: "#fbf9f4", deepSpruce: "#243a35", slate: "#68716f" }, { paper: "#17221e", deepSpruce: "#9fbfa9", slate: "#9ba7a0" }]) {
    expect(hillshadeLayerSpec(palette)).toMatchObject({
      paint: {
        "hillshade-method": "standard",
        "hillshade-highlight-color": "rgba(0, 0, 0, 0)",
        "hillshade-accent-color": "rgba(0, 0, 0, 0)",
      },
    });
  }
});
