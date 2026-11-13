/**
 * The rider's map layers on the MapLibre host (UX rework phase 8).
 *
 * Provider features for the layers the rider switched on, drawn under the ride:
 * alert areas as tinted fills, road layers as lines styled per layer, and stops
 * as coloured dots with a paper ring. The traffic-flow raster is a separate
 * source the host inserts under the basemap's labels, like satellite imagery.
 */

import { MAP_LAYERS, windArrowProperties, type InfoFeature } from "@/application/map-layers";
import type { MapScene } from "@/application/map/types";

import type { MapLayerSpec, MapPalette } from "./style";


/** Dirt evidence draws dashed, like a dirt road on a paper map. */
const DASHED_LINE_LAYERS = ["gravel"];
export const INFO_SOURCE_ID = "ogv-info";
export const TRAFFIC_FLOW_SOURCE_ID = "ogv-traffic-flow";

export const INFO_LAYER_IDS = {
  fill: "ogv-info-fill",
  slope: "ogv-info-slope",
  outline: "ogv-info-outline",
  line: "ogv-info-line",
  lineCasing: "ogv-info-line-casing",
  point: "ogv-info-point",
  pointSelected: "ogv-info-point-selected",
  /** The wind layer's arrows (map-experience wave 3, item 13). */
  windArrow: "ogv-info-wind-arrow",
  label: "ogv-info-label",
} as const;

/** Layers a tap can land on, top first. */
export const INFO_HIT_LAYERS = [
  INFO_LAYER_IDS.pointSelected,
  INFO_LAYER_IDS.point,
  INFO_LAYER_IDS.windArrow,
  INFO_LAYER_IDS.line,
  `${INFO_LAYER_IDS.line}-minor`,
  "ogv-info-surface",
  INFO_LAYER_IDS.slope,
  INFO_LAYER_IDS.fill,
] as const;

/** `["match", ["get", "layerId"], id, colour, …, fallback]` from the catalogue. */
function colourByLayer(palette: MapPalette): unknown {
  const themed: Partial<Record<InfoFeature["layerId"], string>> = {
    contours: palette.trailBrown, slope: palette.goldenHour, mvum: palette.deepSpruce,
    "work-zones": palette.ember, "active-fire": palette.emberStrong, "public-land": palette.topoSage,
  };
  return ["match", ["get", "layerId"], ...MAP_LAYERS.flatMap((layer) => [layer.id, themed[layer.id] ?? layer.color]), palette.slate];
}

/**
 * Phone first PF-6: the twisty roads are calm until the rider zooms in. Below
 * zoom 11 only the best segments (weight 1050 and up (about 37% of the segments around Langhorne)) draw, 2px wide at 75%;
 * from zoom 11 every segment draws as before. The lesser segments live on
 * their own "-minor" layers that start at zoom 11, so they are not even
 * rendered (or queryable) on the overview.
 */
export const TWISTY_CALM_ZOOM = 11;
export const TWISTY_BEST_WEIGHT = 1050;
const isTwisty = ["==", ["get", "layerId"], "great-roads"];
const twistyWeight = ["coalesce", ["get", "weight"], 0];
const twistyIsBest = [">=", twistyWeight, TWISTY_BEST_WEIGHT];

export function infoLayerSpecs(palette: MapPalette): readonly MapLayerSpec[] {
  const out: MapLayerSpec[] = [];
  for (const spec of baseInfoLayerSpecs(palette)) {
    if (spec.id !== INFO_LAYER_IDS.lineCasing && spec.id !== INFO_LAYER_IDS.line) {
      out.push(spec.id === INFO_LAYER_IDS.point ? calmPoints(spec) : spec);
      continue;
    }
    const casing = spec.id === INFO_LAYER_IDS.lineCasing;
    const paint = spec.paint as Record<string, unknown>;
    const filter = spec.filter as unknown[];
    const width = paint["line-width"] as unknown[];
    const at8 = width[4];
    const at14 = width[6];
    const at11 = ["/", ["+", at8, at14], 2];
    const calmWidth = casing ? 3 : 2;
    const opacity = paint["line-opacity"];
    const best: MapLayerSpec = {
      ...spec,
      filter: ["all", filter, ["any", ["!", isTwisty], twistyIsBest]],
      paint: {
        ...paint,
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          8, ["case", isTwisty, calmWidth, at8],
          TWISTY_CALM_ZOOM - 0.01, ["case", isTwisty, calmWidth, at11],
          TWISTY_CALM_ZOOM, at11,
          14, at14,
        ],
        "line-opacity": ["step", ["zoom"], ["case", isTwisty, 0.75, opacity], TWISTY_CALM_ZOOM, opacity],
      },
    };
    const rest: MapLayerSpec = {
      ...spec,
      id: `${spec.id}-minor`,
      minzoom: TWISTY_CALM_ZOOM,
      filter: ["all", filter, isTwisty, ["!", twistyIsBest]],
    };
    out.push(best, rest);
  }
  return out;
}

/** Orange and red dots wait for zoom 11, then grow from 3px to 5px at zoom 14. */
function calmPoints(spec: MapLayerSpec): MapLayerSpec {
  return {
    ...spec,
    minzoom: TWISTY_CALM_ZOOM,
    paint: { ...(spec.paint as Record<string, unknown>), "circle-radius": ["interpolate", ["linear"], ["zoom"], TWISTY_CALM_ZOOM, 3, 14, 5] },
  };
}

function baseInfoLayerSpecs(palette: MapPalette): readonly MapLayerSpec[] {
  const isPolygon = ["==", ["geometry-type"], "Polygon"];
  const isLine = ["==", ["geometry-type"], "LineString"];
  const isPoint = ["==", ["geometry-type"], "Point"];
  return [
    {
      id: INFO_LAYER_IDS.fill,
      type: "fill",
      source: INFO_SOURCE_ID,
      filter: ["all", isPolygon, ["!=", ["get", "layerId"], "slope"]],
      paint: {
        "fill-color": colourByLayer(palette),
        "fill-opacity": ["match", ["get", "layerId"], "weather", 0.16, 0.12],
      },
    },
    {
      id: INFO_LAYER_IDS.slope,
      type: "fill",
      source: INFO_SOURCE_ID,
      filter: ["all", isPolygon, ["==", ["get", "layerId"], "slope"]],
      paint: {
        // Adjacent DEM cells are a continuous tint, not a grid of outlined boxes.
        "fill-antialias": false,
        "fill-color": ["step", ["get", "weight"], palette.trailBrown, 10, palette.goldenHour, 25, palette.ember],
        // Flat ground (including water) stays clear; steep ground never hides roads.
        "fill-opacity": ["step", ["get", "weight"], 0, 10, 0.12, 25, 0.22],
      },
    },
    {
      id: INFO_LAYER_IDS.outline,
      type: "line",
      source: INFO_SOURCE_ID,
      filter: ["all", isPolygon, ["!=", ["get", "layerId"], "slope"]],
      layout: { "line-join": "round" },
      paint: {
        "line-color": colourByLayer(palette),
        "line-width": 1.5,
        "line-opacity": 0.7,
        "line-dasharray": [3, 2],
      },
    },
    {
      id: INFO_LAYER_IDS.lineCasing,
      type: "line",
      source: INFO_SOURCE_ID,
      filter: ["all", isLine, ["in", ["get", "layerId"], ["literal", ["great-roads", "road-history", "live-traffic", "trails"]]]],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": ["case", ["==", ["get", "layerId"], "trails"], ["coalesce", ["get", "color"], "#b54e36"], palette.paper],
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8,
          ["match", ["get", "layerId"], "road-history", 2, "trails", 4, 3.5],
          14,
          ["match", ["get", "layerId"], "road-history", 4, "trails", 8, 8],
        ],
        "line-opacity": ["match", ["get", "layerId"], "road-history", 0.34, 0.85],
      },
    },
    {
      id: INFO_LAYER_IDS.line,
      type: "line",
      source: INFO_SOURCE_ID,
      filter: ["all", isLine, ["!", ["in", ["get", "layerId"], ["literal", DASHED_LINE_LAYERS]]]],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        // Terrain and access use the active Day/Night palette.
        "line-color": [
          "case",
          ["==", ["get", "layerId"], "trails"], palette.paper,
          ["==", ["get", "layerId"], "mvum"],
          ["step", ["get", "weight"], palette.ember, 0.25, palette.goldenHour, 0.75, palette.deepSpruce],
          ["==", ["get", "layerId"], "great-roads"],
          ["interpolate", ["linear"], ["coalesce", ["get", "weight"], 0], 600, palette.goldenHour, 1000, palette.ember, 1500, palette.emberStrong],
          colourByLayer(palette),
        ],
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8,
          ["match", ["get", "layerId"], "great-roads", ["interpolate", ["linear"], ["coalesce", ["get", "weight"], 0], 600, 1.5, 1500, 3], "rider-picked", 1.3, "road-history", 1.2, "contours", ["get", "weight"], "live-traffic", 2.5, "trails", 1.4, 1.5],
          14,
          ["match", ["get", "layerId"], "great-roads", ["interpolate", ["linear"], ["coalesce", ["get", "weight"], 0], 600, 3.5, 1500, 7], "rider-picked", 2.2, "road-history", 3, "contours", ["get", "weight"], "live-traffic", 6, "trails", 3, 3.5],
        ],
        "line-opacity": ["match", ["get", "layerId"], "great-roads", 0.9, "rider-picked", 0.85, "road-history", 0.42, 0.85],
      },
    },
    {
      id: "ogv-info-surface", type: "line", source: INFO_SOURCE_ID,
      filter: ["all", isLine, ["in", ["get", "layerId"], ["literal", DASHED_LINE_LAYERS]]],
      layout: { "line-join": "round", "line-cap": "butt" },
      paint: { "line-color": palette.trailBrown, "line-width": ["interpolate", ["linear"], ["zoom"], 8, ["interpolate", ["linear"], ["coalesce", ["get", "weight"], 0], 0, 1.5, 1, 3], 14, ["interpolate", ["linear"], ["coalesce", ["get", "weight"], 0], 0, 3, 1, 6]], "line-dasharray": [2, 1.2], "line-opacity": 0.92 },
    },
    {
      id: INFO_LAYER_IDS.point,
      type: "circle",
      source: INFO_SOURCE_ID,
      // Wind points are arrows, not dots: they must never be drawn twice.
      filter: ["all", isPoint, ["!=", ["get", "layerId"], "wind"], ["!=", ["get", "selected"], true]],
      paint: {
        // Small at overview zooms so a busy layer never buries the ride.
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 2.5, 11, 4, 14, 7],
        "circle-color": colourByLayer(palette),
        "circle-stroke-color": palette.paper,
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 8, 1, 12, 2],
      },
    },
    {
      id: INFO_LAYER_IDS.pointSelected,
      type: "circle",
      source: INFO_SOURCE_ID,
      filter: ["all", ["==", ["get", "selected"], true], ["!=", ["get", "layerId"], "wind"]],
      paint: {
        "circle-radius": 10,
        "circle-color": colourByLayer(palette),
        "circle-stroke-color": palette.ink,
        "circle-stroke-width": 3,
      },
    },
    {
      // Wind arrows (map-experience wave 3, item 13): an image per strength band,
      // turned downwind by the reading. The size and image are the reading's own
      // projection ({@link windArrowProperties}), so the layer has no scale of its own.
      id: INFO_LAYER_IDS.windArrow,
      type: "symbol",
      source: INFO_SOURCE_ID,
      filter: ["all", isPoint, ["==", ["get", "layerId"], "wind"]],
      minzoom: 8,
      // The catalogue stops the layer at zoom 12; the renderer's own maxzoom is
      // exclusive, so 13 keeps every zoom the layer is on for.
      maxzoom: 13,
      layout: {
        "icon-image": ["get", "icon"],
        "icon-rotate": ["coalesce", ["get", "direction"], 0],
        "icon-rotation-alignment": "map",
        "icon-pitch-alignment": "map",
        "icon-size": ["case", ["==", ["get", "selected"], true], ["*", ["get", "size"], 1.3], ["get", "size"]],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-padding": 0,
        // The speed sits under the arrow, upright, so the reading is legible at a glance.
        "text-field": ["to-string", ["get", "speed"]],
        "text-font": ["Open Sans Bold"],
        "text-size": 12,
        "text-offset": [0, 1.6],
        "text-rotation-alignment": "viewport",
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: { "icon-opacity": 0.92, "text-color": palette.ink, "text-halo-color": palette.paper, "text-halo-width": 1.5 },
    },
    {
      id: INFO_LAYER_IDS.label,
      type: "symbol",
      source: INFO_SOURCE_ID,
      filter: ["all", isPoint, ["!=", ["get", "layerId"], "wind"]],
      minzoom: 13,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Open Sans Bold"],
        "text-size": 11.5,
        "text-offset": [0, 1.1],
        "text-anchor": "top",
        "text-max-width": 9,
        "text-optional": true,
      },
      paint: {
        "text-color": palette.ink,
        "text-halo-color": palette.paper,
        "text-halo-width": 1.5,
      },
    },
  ];
}

/** GeoJSON for the info source: each feature carries its layer and selection. */
export function infoFeatureCollection(scene: MapScene): {
  readonly type: "FeatureCollection";
  readonly features: readonly unknown[];
} {
  const layers = scene.infoLayers ?? null;
  if (layers === null) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: layers.features.map((feature: InfoFeature) => ({
      type: "Feature",
      id: undefined,
      properties: {
        id: feature.id,
        layerId: feature.layerId,
        name: feature.name,
        weight: feature.weight ?? 0,
        ...(feature.color === undefined ? {} : { color: feature.color }),
        ...(feature.overlay === undefined ? {} : { overlay: feature.overlay }),
        ...windArrowProperties(feature.wind),
        selected: feature.id === layers.selectedId,
      },
      geometry: feature.geometry,
    })),
  };
}
