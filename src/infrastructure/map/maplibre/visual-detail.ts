import type { MapPalette } from "@/infrastructure/map/maplibre/style";

/**
 * Bounded visual-detail helpers for the MapLibre adapter.
 *
 * These functions describe renderer detail only. They never own camera state,
 * route state, React state, or persistence. Keeping the source/layer specs here
 * prevents host.ts from becoming the permanent home for every visual feature.
 */

export const TERRAIN_SOURCE_ID = "og-terrain-dem";
export const HILLSHADE_LAYER_ID = "og-terrain-hillshade";
export const BUILDING_EXTRUSION_LAYER_ID = "og-buildings-3d";

/** Existing production fallback until the PA/NJ DEM benchmark selects a source. */
export const LEGACY_TERRARIUM_TILES =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

/** Current external HD benchmark used by MapLibre's own terrain examples. */
export const MAPTERHORN_TILEJSON_URL = "https://tiles.mapterhorn.com/tilejson.json";

/** Realistic relief. Navigation readability matters more than dramatic mountains. */
export const TERRAIN_EXAGGERATION = 1.1;

export interface HostedStyleLayer {
  readonly id: string;
  readonly type: string;
  readonly source?: string;
  readonly "source-layer"?: string;
  readonly layout?: Readonly<Record<string, unknown>>;
}

export interface BuildingInsertion {
  readonly source: string;
  readonly beforeId: string | undefined;
}

/** Current low-risk DEM source. The builder will later replace this with our own TileJSON/PMTiles. */
export function terrainSourceSpec(): Readonly<Record<string, unknown>> {
  return {
    type: "raster-dem",
    tiles: [LEGACY_TERRARIUM_TILES],
    encoding: "terrarium",
    tileSize: 256,
    maxzoom: 14,
    attribution: "Elevation © Mapzen, AWS",
  };
}

/**
 * Subtle relief under roads. It intentionally reuses the terrain source in the
 * first slice to avoid another independent tile request stream on a phone.
 */
export function hillshadeLayerSpec(palette?: Pick<MapPalette, "deepSpruce" | "paper" | "slate">): Readonly<Record<string, unknown>> {
  return {
    id: HILLSHADE_LAYER_ID,
    type: "hillshade",
    source: TERRAIN_SOURCE_ID,
    paint: {
      "hillshade-method": "standard",
      "hillshade-exaggeration": 0.3,
      "hillshade-shadow-color": palette?.deepSpruce ?? "#33413b",
      // Only add shadows: opaque highlights bleach the hosted basemap.
      "hillshade-highlight-color": "rgba(0, 0, 0, 0)",
      "hillshade-accent-color": "rgba(0, 0, 0, 0)",
    },
  };
}

/**
 * Put hillshade under transportation when the hosted style exposes a useful
 * road layer; otherwise put it beneath labels. Returning undefined appends it.
 */
export function hillshadeBeforeId(layers: readonly HostedStyleLayer[]): string | undefined {
  // An opaque raster (including satellite) would completely cover relief.
  const lastRaster = layers.reduce((last, layer, index) => layer.type === "raster" && !layer.id.startsWith("ogv-") ? index : last, -1);
  const aboveRasters = layers.slice(lastRaster + 1);
  const road = aboveRasters.find(
    (layer) =>
      layer.type === "line" &&
      (layer["source-layer"] === "transportation" ||
        /(?:^|[-_])(road|street|highway|transportation)(?:$|[-_])/i.test(layer.id)),
  );
  if (road !== undefined) return road.id;
  return aboveRasters.find((layer) => layer.type === "symbol")?.id;
}

/**
 * Reuse the hosted basemap's building vector source rather than downloading a
 * second building dataset at runtime. OpenFreeMap exposes source-layer=building;
 * compatible hosted styles can opt in automatically through the same shape.
 */
export function buildingInsertion(layers: readonly HostedStyleLayer[]): BuildingInsertion | null {
  const building = layers.find(
    (layer) => layer["source-layer"] === "building" && typeof layer.source === "string",
  );
  if (building?.source === undefined) return null;
  const firstLabel = layers.find((layer) => layer.type === "symbol")?.id;
  return { source: building.source, beforeId: firstLabel };
}

/** Native MapLibre extrusion: cheap, high-zoom orientation detail, never a 3D-model framework. */
export function buildingExtrusionLayerSpec(source: string): Readonly<Record<string, unknown>> {
  return {
    id: BUILDING_EXTRUSION_LAYER_ID,
    type: "fill-extrusion",
    source,
    "source-layer": "building",
    minzoom: 15,
    filter: ["!=", ["get", "hide_3d"], true],
    paint: {
      "fill-extrusion-color": "#d7d3c8",
      "fill-extrusion-opacity": 0.72,
      "fill-extrusion-height": [
        "interpolate",
        ["linear"],
        ["zoom"],
        15,
        0,
        16,
        ["coalesce", ["get", "render_height"], 6],
      ],
      "fill-extrusion-base": [
        "case",
        [">=", ["zoom"], 16],
        ["coalesce", ["get", "render_min_height"], 0],
        0,
      ],
    },
  };
}
