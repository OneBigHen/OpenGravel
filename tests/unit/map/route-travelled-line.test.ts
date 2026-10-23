/**
 * The ridden half of the line (08 §5, 05 §11).
 *
 * Ride Focus draws the road behind the rider dimmer than the road ahead, so the
 * map answers "how far have I come" without opening the sheet. The tests pin the
 * three things that would make that a lie: the treatment is not the `previous`
 * route state, it is never hit-testable, and it is drawn under the line the
 * rider is still following.
 */

import { describe, expect, it } from "vitest";

import type { MapScene, RouteScene } from "@/application/map/types";
import { routeFeatureCollection } from "@/infrastructure/map/maplibre/geojson";
import { fingerprintScene } from "@/infrastructure/map/maplibre/scene-diff";
import {
  DEFAULT_MAP_PALETTE,
  HIT_LAYER_IDS,
  MAP_LAYER_IDS,
  MAP_SOURCE_IDS,
  routeLayers,
  type MapPalette,
} from "@/infrastructure/map/maplibre/style";
import { asRouteCandidateId } from "@/domain/route/ids";

const ROUTE_ID = asRouteCandidateId("route_followed");

const AHEAD: readonly { lon: number; lat: number }[] = [
  { lon: -75.1, lat: 39.95 },
  { lon: -75.0, lat: 39.95 },
];
const TRAVELLED: readonly { lon: number; lat: number }[] = [
  { lon: -75.2, lat: 39.95 },
  { lon: -75.1, lat: 39.95 },
];

function travelled(geometry: readonly { lon: number; lat: number }[] = TRAVELLED): RouteScene {
  return { id: ROUTE_ID, role: null, geometry, state: "travelled" };
}

function ahead(geometry: readonly { lon: number; lat: number }[] = AHEAD): RouteScene {
  return { id: ROUTE_ID, role: null, geometry, state: "selected" };
}

function scene(routes: readonly RouteScene[]): MapScene {
  return {
    mode: "ride",
    routes,
    selectedRouteId: ROUTE_ID,
    points: [],
    preview: null,
    avoidAreas: [],
    roadSpans: [],
    sketch: null,
    avoidHandles: [],
    previewArea: null,
    selectedObject: null,
  };
}

function byId(id: string) {
  const layer = routeLayers(DEFAULT_MAP_PALETTE).find((candidate) => candidate.id === id);
  expect(layer, id).toBeDefined();
  return layer!;
}

describe("the travelled line", () => {
  it("is its own route state on the routes source, never the previous-answer one", () => {
    const layer = byId(MAP_LAYER_IDS.routeTravelled);

    expect(layer.type).toBe("line");
    expect(layer.source).toBe(MAP_SOURCE_IDS.routes);
    expect(layer.filter).toEqual(["==", ["get", "state"], "travelled"]);
  });

  it("is dim Topo Sage with no casing and a flat 5 px, so the road ahead stays heaviest", () => {
    const layer = byId(MAP_LAYER_IDS.routeTravelled);
    const aheadLayer = byId(MAP_LAYER_IDS.routeSelected);

    expect(layer.paint?.["line-color"]).toBe(DEFAULT_MAP_PALETTE.topoSage);
    expect(layer.paint?.["line-width"]).toBe(5);
    expect(layer.paint?.["line-dasharray"]).toBeUndefined();
    expect(layer.paint?.["line-opacity"]).toBe(0.5);
    // The ahead line still grows with zoom from a heavier base, so it always
    // reads as the line being followed.
    const widths = aheadLayer.paint?.["line-width"] as unknown[];
    expect(widths[0]).toBe("interpolate");
    expect(Number(widths[4])).toBeGreaterThan(5);
    expect(Number(widths.at(-1))).toBeGreaterThan(5);
  });

  it("lifts to 0.62 on the brighter Day ride map and stays 0.5 at Night", () => {
    const day: MapPalette = { ...DEFAULT_MAP_PALETTE, routeCasing: "#1d0b05", emphasis: "1.25" };
    const opacity = (palette: MapPalette): unknown =>
      routeLayers(palette).find((layer) => layer.id === MAP_LAYER_IDS.routeTravelled)?.paint?.[
        "line-opacity"
      ];

    expect(opacity(day)).toBe(0.62);
    expect(opacity(DEFAULT_MAP_PALETTE)).toBe(0.5);
  });

  it("is drawn under the selected route's casing and core", () => {
    const ids = routeLayers(DEFAULT_MAP_PALETTE).map((layer) => layer.id);

    expect(ids.indexOf(MAP_LAYER_IDS.routeTravelled)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(MAP_LAYER_IDS.routeTravelled)).toBeLessThan(
      ids.indexOf(MAP_LAYER_IDS.routeCasing),
    );
    expect(ids.indexOf(MAP_LAYER_IDS.routeTravelled)).toBeLessThan(
      ids.indexOf(MAP_LAYER_IDS.routeSelected),
    );
  });

  it("is not a hit target: the ridden road is not a control", () => {
    expect(HIT_LAYER_IDS).not.toContain(MAP_LAYER_IDS.routeTravelled);
  });

  it("is emitted as its own feature beside the selected half", () => {
    const features = routeFeatureCollection(scene([ahead(), travelled()])).features;
    const ridden = features.find((feature) => feature.properties["state"] === "travelled");

    expect(ridden).toBeDefined();
    // GeoJSON order: [lon, lat], in travel order, ending where the rider is.
    expect(ridden?.geometry.type).toBe("LineString");
    expect(ridden?.geometry.coordinates).toEqual([
      [-75.2, 39.95],
      [-75.1, 39.95],
    ]);
    expect(features.some((feature) => feature.properties["state"] === "selected")).toBe(true);
    // The surface band is a reading of the selected line only; the ridden half
    // carries no band of its own.
    expect(features.filter((feature) => feature.properties["state"] === "surface")).toEqual([]);
  });

  it("re-uploads the route when the split point moves", () => {
    const before = fingerprintScene(scene([ahead(), travelled()]));
    const moved = fingerprintScene(
      scene([
        ahead([{ lon: -75.05, lat: 39.95 }, { lon: -75.0, lat: 39.95 }]),
        travelled([
          { lon: -75.2, lat: 39.95 },
          { lon: -75.1, lat: 39.95 },
          { lon: -75.05, lat: 39.95 },
        ]),
      ]),
    );

    expect(moved.routes).not.toBe(before.routes);
    expect(moved.routes).toContain("travelled");
    expect(before.routes).toContain("travelled");
  });
});
