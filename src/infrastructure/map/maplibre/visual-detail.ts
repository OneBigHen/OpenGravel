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

/** The old z14 Mapzen DEM, kept for reference by the elevation probe. */
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
  readonly paint?: Readonly<Record<string, unknown>>;
  readonly filter?: unknown;
}

export interface BuildingInsertion {
  readonly source: string;
  readonly beforeId: string | undefined;
}

/** Mapterhorn's terrarium tiles: USGS 3DEP down to about 1 m in the US, 512 px to z16, free and keyless. */
export const MAPTERHORN_TILES = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";

/**
 * HD relief for 3D terrain and hill shading. Mapterhorn draws ridges and
 * stream cuts the old z14 Mapzen tiles smeared, and costs no Mapbox quota.
 */
export function terrainSourceSpec(): Readonly<Record<string, unknown>> {
  return {
    type: "raster-dem",
    tiles: [MAPTERHORN_TILES],
    encoding: "terrarium",
    tileSize: 512,
    maxzoom: 16,
    attribution: "<a href='https://mapterhorn.com/attribution'>© Mapterhorn</a>",
  };
}

/**
 * Sky, horizon haze and ground fog for a tilted map, in the look's own light.
 *
 * This is the static fallback for a map whose sun position is unknown; the
 * sun-driven sky (golden hour, dusk) lives in `sun-lighting.ts`.
 */
export function skySpec(night: boolean): Readonly<Record<string, unknown>> {
  return night
    ? {
        "sky-color": "#0d1a24",
        "horizon-color": "#30424f",
        "fog-color": "#1a252c",
        "sky-horizon-blend": 0.6,
        "horizon-fog-blend": 0.55,
        "fog-ground-blend": 0.75,
        "atmosphere-blend": 0,
      }
    : {
        "sky-color": "#8fbfe0",
        "horizon-color": "#e8eef0",
        "fog-color": "#eef1ec",
        "sky-horizon-blend": 0.55,
        "horizon-fog-blend": 0.6,
        "fog-ground-blend": 0.82,
        "atmosphere-blend": 0,
      };
}

/** MapLibre's own default light, put back when the map lies flat again. */
export const DEFAULT_LIGHT: Readonly<Record<string, unknown>> = {
  anchor: "viewport",
  position: [1.15, 210, 30],
  color: "#ffffff",
  intensity: 0.5,
};

/**
 * The late-afternoon sun, used only when the map cannot compute one.
 *
 * `sun-lighting.ts` replaces this with the real sun's bearing and altitude; the
 * constant stays so an unknown hour is lit by a known, honest default rather
 * than by a made-up midday.
 */
export const SUN_LIGHT: Readonly<Record<string, unknown>> = {
  anchor: "map",
  position: [1.35, 230, 40],
  color: "#fff6ea",
  intensity: 0.42,
};

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
export function buildingExtrusionLayerSpec(source: string, night = false): Readonly<Record<string, unknown>> {
  // OpenMapTiles names heights render_height / render_min_height; Mapbox
  // Streets (under Outdoors) names them height / min_height.
  const height = ["coalesce", ["get", "render_height"], ["get", "height"], 6];
  const base = ["coalesce", ["get", "render_min_height"], ["get", "min_height"], 0];
  return {
    id: BUILDING_EXTRUSION_LAYER_ID,
    type: "fill-extrusion",
    source,
    "source-layer": "building",
    minzoom: 14,
    filter: ["all",
      ["!=", ["to-string", ["coalesce", ["get", "hide_3d"], false]], "true"],
      ["!=", ["to-string", ["coalesce", ["get", "hide_3d"], 0]], "1"],
      ["==", ["to-string", ["coalesce", ["get", "extrude"], "true"]], "true"],
      ["!=", ["to-string", ["coalesce", ["get", "underground"], false]], "true"],
    ],
    paint: {
      // Warm stone low, paler with height, like daylight on a town.
      "fill-extrusion-color": night
        ? ["interpolate", ["linear"], height, 0, "#2c3a42", 60, "#3a4b55", 200, "#4b5f6b"]
        : ["interpolate", ["linear"], height, 0, "#dcd5c6", 40, "#e6e0d3", 150, "#f1ede4"],
      "fill-extrusion-opacity": 0.9,
      "fill-extrusion-vertical-gradient": true,
      "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 14, 0, 15.5, height],
      "fill-extrusion-base": ["interpolate", ["linear"], ["zoom"], 14, 0, 15.5, base],
    },
  };
}
