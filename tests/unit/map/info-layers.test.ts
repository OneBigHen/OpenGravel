import { describe, expect, it } from "vitest";

import { MAP_LAYERS } from "@/application/map-layers";
import { clampLayerBounds } from "@/application/map-layers";
import { INFO_HIT_LAYERS, infoFeatureCollection, infoLayerSpecs } from "@/infrastructure/map/maplibre/info-layers";
import { DEFAULT_MAP_PALETTE, MAP_SOURCE_IDS, overlayLayers } from "@/infrastructure/map/maplibre/style";
import { planSceneSync } from "@/infrastructure/map/maplibre/scene-diff";
import type { MapScene } from "@/application/map/types";
import { filterTrafficCamerasToRoute, zoomOf } from "@/ui/layers/useMapLayers";

const EMPTY_SCENE: MapScene = {
  mode: "plan",
  routes: [],
  selectedRouteId: null,
  points: [],
  preview: null,
  avoidAreas: [],
  roadSpans: [],
  sketch: null,
  avoidHandles: [],
  previewArea: null,
  selectedObject: null,
};

describe("map layers on the renderer (phase 8)", () => {
  it("every layer has a distinct id, a colour and a source", () => {
    expect(new Set(MAP_LAYERS.map((layer) => layer.id)).size).toBe(MAP_LAYERS.length);
    for (const layer of MAP_LAYERS) {
      expect(layer.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(layer.source.length).toBeGreaterThan(0);
    }
  });

  it("draws info features under places and routes", () => {
    const ids = overlayLayers({} as never).map((layer) => layer.id);
    const infoIds = infoLayerSpecs({} as never).map((layer) => layer.id);
    expect(ids.slice(0, infoIds.length)).toEqual(infoIds);
    expect(Object.values(MAP_SOURCE_IDS)).toContain("ogv-info");
  });

  it("marks the selected feature and re-uploads only when the features or selection change", () => {
    const feature = { id: "f1", layerId: "fuel", name: "Wawa", detail: null, weight: null, geometry: { type: "Point", coordinates: [-75.4, 40.1] } } as const;
    const scene = { ...EMPTY_SCENE, infoLayers: { features: [feature], trafficFlowTiles: null, selectedId: "f1", visible: ["fuel"] } } as MapScene;
    const collection = infoFeatureCollection(scene);
    expect(collection.features[0]).toMatchObject({ properties: { id: "f1", layerId: "fuel", selected: true } });
    const first = planSceneSync(null, scene);
    const same = planSceneSync(first.fingerprints, scene);
    expect(same.infoLayers).toBe(false);
    const deselected = planSceneSync(first.fingerprints, { ...scene, infoLayers: { ...scene.infoLayers!, selectedId: null } });
    expect(deselected.infoLayers).toBe(true);
    expect(deselected.routes).toBe(false);
  });

  it("reads the zoom of a view and clips views to the served span", () => {
    // MapLibre's 512 px tiles: one degree across 1024 px is zoom ~9.5.
    expect(zoomOf({ minLon: -76, minLat: 39, maxLon: -75, maxLat: 40 }, 1024)).toBeCloseTo(9.49, 1);
    expect(clampLayerBounds({ west: -80, south: 30, east: -70, north: 50 })).toEqual({ west: -75.8, south: 39.5, east: -74.2, north: 40.5 });
  });

  it("can keep traffic cameras near the selected route without filtering other layers", () => {
    const near = { id: "near", layerId: "traffic-cameras", name: "Near", detail: null, weight: 1, geometry: { type: "Point", coordinates: [-75.25, 40.01] } } as const;
    const far = { id: "far", layerId: "traffic-cameras", name: "Far", detail: null, weight: 1, geometry: { type: "Point", coordinates: [-75.25, 40.1] } } as const;
    const fuel = { id: "fuel", layerId: "fuel", name: "Fuel", detail: null, weight: null, geometry: { type: "Point", coordinates: [-75.25, 40.2] } } as const;
    const filtered = filterTrafficCamerasToRoute(
      [near, far, fuel],
      [[-75.5, 40], [-75.0, 40]],
      5_000,
    );
    expect(filtered.map((feature) => feature.id)).toEqual(["near", "fuel"]);
  });
});

it("renders slope separately without cell seams or a mask over flat ground", () => {
  const specs = infoLayerSpecs(DEFAULT_MAP_PALETTE);
  const slope = specs.find((layer) => layer.id === "ogv-info-slope");
  expect(INFO_HIT_LAYERS).toContain("ogv-info-slope");
  expect(slope).toMatchObject({
    type: "fill",
    filter: ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "layerId"], "slope"]],
    paint: {
      "fill-antialias": false,
      "fill-opacity": ["step", ["get", "weight"], 0, 10, 0.12, 25, 0.22],
    },
  });
  expect(specs.find((layer) => layer.id === "ogv-info-fill")?.filter).toEqual(["all", ["==", ["geometry-type"], "Polygon"], ["!=", ["get", "layerId"], "slope"]]);
});
