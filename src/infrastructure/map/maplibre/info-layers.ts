/**
 * The rider's map layers on the MapLibre host (UX rework phase 8).
 *
 * Provider features for the layers the rider switched on, drawn under the ride:
 * alert areas as tinted fills, road layers as lines styled per layer, and stops
 * as coloured dots with a paper ring. The traffic-flow raster is a separate
 * source the host inserts under the basemap's labels, like satellite imagery.
 */

import { MAP_LAYERS, type InfoFeature } from "@/application/map-layers";
import type { MapScene } from "@/application/map/types";

import type { MapLayerSpec, MapPalette } from "./style";

export const INFO_SOURCE_ID = "ogv-info";
export const TRAFFIC_FLOW_SOURCE_ID = "ogv-traffic-flow";

export const INFO_LAYER_IDS = {
  fill: "ogv-info-fill",
  outline: "ogv-info-outline",
  line: "ogv-info-line",
  lineCasing: "ogv-info-line-casing",
  point: "ogv-info-point",
  pointSelected: "ogv-info-point-selected",
  label: "ogv-info-label",
} as const;

/** Layers a tap can land on, top first. */
export const INFO_HIT_LAYERS = [
  INFO_LAYER_IDS.pointSelected,
  INFO_LAYER_IDS.point,
  INFO_LAYER_IDS.line,
  "ogv-info-surface",
  INFO_LAYER_IDS.fill,
] as const;

/** `["match", ["get", "layerId"], id, colour, …, fallback]` from the catalogue. */
function colourByLayer(palette: MapPalette): unknown {
  const themed: Partial<Record<InfoFeature["layerId"], string>> = {
    contours: palette.trailBrown, slope: palette.goldenHour, mvum: palette.deepSpruce,
    "work-zones": palette.ember, "active-fire": palette.emberStrong, "public-land": palette.topoSage,
    "road-surface": palette.trailBrown,
  };
  return ["match", ["get", "layerId"], ...MAP_LAYERS.flatMap((layer) => [layer.id, themed[layer.id] ?? layer.color]), palette.slate];
}

export function infoLayerSpecs(palette: MapPalette): readonly MapLayerSpec[] {
  const isPolygon = ["==", ["geometry-type"], "Polygon"];
  const isLine = ["==", ["geometry-type"], "LineString"];
  const isPoint = ["==", ["geometry-type"], "Point"];
  return [
    {
      id: INFO_LAYER_IDS.fill,
      type: "fill",
      source: INFO_SOURCE_ID,
      filter: isPolygon,
      paint: {
        "fill-color": ["case", ["==", ["get", "layerId"], "slope"], ["step", ["get", "weight"], palette.trailBrown, 10, palette.goldenHour, 25, palette.ember], colourByLayer(palette)],
        "fill-opacity": ["match", ["get", "layerId"], "weather", 0.16, "slope", 0.45, 0.12],
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
      filter: ["all", isLine, ["in", ["get", "layerId"], ["literal", ["great-roads", "road-history", "live-traffic"]]]],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": palette.paper,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8,
          ["match", ["get", "layerId"], "road-history", 2, 3.5],
          14,
          ["match", ["get", "layerId"], "road-history", 4, 8],
        ],
        "line-opacity": ["match", ["get", "layerId"], "road-history", 0.34, 0.85],
      },
    },
    {
      id: INFO_LAYER_IDS.line,
      type: "line",
      source: INFO_SOURCE_ID,
      filter: ["all", isLine, ["!=", ["get", "layerId"], "road-surface"]],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        // Terrain and access use the active Day/Night palette.
        "line-color": [
          "case",
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
          ["match", ["get", "layerId"], "great-roads", ["interpolate", ["linear"], ["coalesce", ["get", "weight"], 0], 600, 1.5, 1500, 3], "road-history", 1.2, "contours", ["get", "weight"], "live-traffic", 2.5, 1.5],
          14,
          ["match", ["get", "layerId"], "great-roads", ["interpolate", ["linear"], ["coalesce", ["get", "weight"], 0], 600, 3.5, 1500, 7], "road-history", 3, "contours", ["get", "weight"], "live-traffic", 6, 3.5],
        ],
        "line-opacity": ["match", ["get", "layerId"], "great-roads", 0.9, "road-history", 0.42, 0.85],
      },
    },
    {
      id: "ogv-info-surface", type: "line", source: INFO_SOURCE_ID,
      filter: ["all", isLine, ["==", ["get", "layerId"], "road-surface"]],
      paint: { "line-color": palette.trailBrown, "line-width": ["interpolate", ["linear"], ["get", "weight"], 0, 2, 1, 5], "line-dasharray": [3, 2] },
    },
    {
      id: INFO_LAYER_IDS.point,
      type: "circle",
      source: INFO_SOURCE_ID,
      filter: ["all", isPoint, ["!=", ["get", "selected"], true]],
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
      filter: ["==", ["get", "selected"], true],
      paint: {
        "circle-radius": 10,
        "circle-color": colourByLayer(palette),
        "circle-stroke-color": palette.ink,
        "circle-stroke-width": 3,
      },
    },
    {
      id: INFO_LAYER_IDS.label,
      type: "symbol",
      source: INFO_SOURCE_ID,
      filter: isPoint,
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
        ...(feature.overlay === undefined ? {} : { overlay: feature.overlay }),
        selected: feature.id === layers.selectedId,
      },
      geometry: feature.geometry,
    })),
  };
}
