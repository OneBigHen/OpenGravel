/**
 * The route line that says which way and what surface (05 §11).
 *
 * Two annotations on the selected line, and both of them are claims, so the tests
 * are mostly about what must *not* be drawn: an unmeasured stretch never gets a
 * surface colour, an alternative never gets arrows, and neither layer may steal a
 * selection tap or be painted by the route treatments underneath.
 */

import { describe, expect, it } from "vitest";

import type { MapScene, RouteScene, RouteSurfaceRunScene } from "@/application/map/types";
import { ROUTE_SURFACE_FEATURE_STATE } from "@/application/map/types";
import { routeFeatureCollection } from "@/infrastructure/map/maplibre/geojson";
import { routeDetailVisible } from "@/infrastructure/map/maplibre/host";
import { createRouteArrowImage, ROUTE_ARROW_IMAGE_ID } from "@/infrastructure/map/maplibre/marker-images";
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

const SELECTED = asRouteCandidateId("route_selected");
const ALTERNATIVE = asRouteCandidateId("route_alternative");

const STRAIGHT: readonly { lon: number; lat: number }[] = [
  { lon: -75.2, lat: 39.95 },
  { lon: -75.1, lat: 39.95 },
  { lon: -75.0, lat: 39.95 },
];

function route(
  id: ReturnType<typeof asRouteCandidateId>,
  state: RouteScene["state"],
  surface?: readonly RouteSurfaceRunScene[],
  geometry: readonly { lon: number; lat: number }[] = STRAIGHT,
): RouteScene {
  return { id, role: null, geometry, state, ...(surface === undefined ? {} : { surface }) };
}

function scene(routes: readonly RouteScene[]): MapScene {
  return {
    mode: "plan",
    routes,
    selectedRouteId: routes.find((candidate) => candidate.state === "selected")?.id ?? null,
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

function band(features: ReturnType<typeof routeFeatureCollection>["features"]) {
  return features.filter((feature) => feature.properties["state"] === ROUTE_SURFACE_FEATURE_STATE);
}

/** The `match` expression's colour for one surface, i.e. what MapLibre would paint. */
function bandColour(palette: MapPalette, surface: string): unknown {
  const layer = routeLayers(palette).find((candidate) => candidate.id === MAP_LAYER_IDS.routeSurface);
  const expression = layer?.paint?.["line-color"] as unknown[];
  expect(expression[0]).toBe("match");
  // ["match", ["get", key], value, colour, …, fallback]
  for (let index = 2; index < expression.length - 1; index += 2) {
    if (expression[index] === surface) return expression[index + 1];
  }
  return expression[expression.length - 1];
}

function byId(id: string) {
  const layer = routeLayers(DEFAULT_MAP_PALETTE).find((candidate) => candidate.id === id);
  expect(layer, id).toBeDefined();
  return layer!;
}

describe("the surface band", () => {
  it("draws above the selected core, under the arrows", () => {
    const ids = routeLayers(DEFAULT_MAP_PALETTE).map((layer) => layer.id);

    expect(ids.indexOf(MAP_LAYER_IDS.routeSurface)).toBeGreaterThan(
      ids.indexOf(MAP_LAYER_IDS.routeSelected),
    );
    expect(ids.indexOf(MAP_LAYER_IDS.routeArrow)).toBeGreaterThan(
      ids.indexOf(MAP_LAYER_IDS.routeSurface),
    );
  });

  it("is a narrow, round-capped band on the routes source", () => {
    const surface = byId(MAP_LAYER_IDS.routeSurface);

    expect(surface.type).toBe("line");
    expect(surface.source).toBe(MAP_SOURCE_IDS.routes);
    expect(surface.layout?.["line-cap"]).toBe("round");
    expect(surface.paint?.["line-width"]).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      12,
      3,
      15,
      3.5,
      17,
      4.5,
    ]);
    expect(surface.paint?.["line-opacity"]).toBe(0.95);
  });

  it("paints the three measured surfaces in the card strip's own hues", () => {
    expect(bandColour(DEFAULT_MAP_PALETTE, "paved")).toBe(DEFAULT_MAP_PALETTE.topoSage);
    expect(bandColour(DEFAULT_MAP_PALETTE, "gravel")).toBe(DEFAULT_MAP_PALETTE.goldenHour);
    expect(bandColour(DEFAULT_MAP_PALETTE, "dirt")).toBe(DEFAULT_MAP_PALETTE.trailBrown);
  });

  it("keeps the surface hues identical in Day and Night", () => {
    // The two looks differ in paper/ink, never in the surface facts (12 §9).
    const day: MapPalette = { ...DEFAULT_MAP_PALETTE, ink: "#161d1c", paper: "#fbf9f4" };
    const night: MapPalette = { ...day, ink: "#f2efe6", paper: "#0d1211" };

    for (const surface of ["paved", "gravel", "dirt"]) {
      expect(bandColour(night, surface)).toBe(bandColour(day, surface));
    }
  });

  it("never lets an unknown surface borrow a known colour", () => {
    // The projection emits no feature for an unknown run; the paint's fallback is
    // the second guard, and it is transparent rather than paved.
    expect(bandColour(DEFAULT_MAP_PALETTE, "unknown")).toBe("rgba(0,0,0,0)");
  });

  it("emits no band for an unknown stretch and keeps the route colour there", () => {
    const features = routeFeatureCollection(
      scene([route(SELECTED, "selected", [{ kind: "unknown", from: 0, to: 1 }])]),
    ).features;
    const selectedFeature = features.find((feature) => feature.properties["state"] === "selected");

    expect(band(features)).toEqual([]);
    expect(selectedFeature?.properties).not.toHaveProperty("surface");
    // The line keeps the route tint: `ogv-route-selected` paints by `tint` only.
    expect(JSON.stringify(byId(MAP_LAYER_IDS.routeSelected).paint)).not.toContain("surface");
  });

  it("draws a known-gravel run in the gravel colour", () => {
    const features = routeFeatureCollection(
      scene([route(SELECTED, "selected", [{ kind: "gravel", from: 0, to: 1 }])]),
    ).features;

    const gravel = band(features);
    expect(gravel).toHaveLength(1);
    expect(gravel[0]?.properties).toMatchObject({ surface: "gravel", id: SELECTED });
    expect(bandColour(DEFAULT_MAP_PALETTE, String(gravel[0]?.properties["surface"]))).toBe(
      DEFAULT_MAP_PALETTE.goldenHour,
    );
    // One surface for the whole line is unambiguous, so the line names it too.
    expect(features[0]?.properties["surface"]).toBe("gravel");
  });

  it("cuts the band at each run boundary and leaves the mixed line unnamed", () => {
    const features = routeFeatureCollection(
      scene([
        route(SELECTED, "selected", [
          { kind: "paved", from: 0, to: 0.5 },
          { kind: "gravel", from: 0.5, to: 0.75 },
          { kind: "unknown", from: 0.75, to: 1 },
        ]),
      ]),
    ).features;
    const bands = band(features);

    expect(bands.map((feature) => feature.properties["surface"])).toEqual(["paved", "gravel"]);
    // Half the line is paved, a quarter gravel, a quarter unknown — so the last
    // quarter of the geometry has no band at all.
    const paved = bands[0]?.geometry.coordinates as number[][];
    const gravel = bands[1]?.geometry.coordinates as number[][];
    expect(paved).toHaveLength(2);
    expect(paved[0]?.[0]).toBeCloseTo(-75.2, 6);
    expect(paved[1]?.[0]).toBeCloseTo(-75.1, 6);
    expect(gravel[0]?.[0]).toBeCloseTo(-75.1, 6);
    expect(gravel[1]?.[0]).toBeCloseTo(-75.05, 6);
    // A mixed line gets no single surface name.
    expect(features[0]?.properties).not.toHaveProperty("surface");
  });

  it("draws nothing on an alternative, even when it carries runs", () => {
    const features = routeFeatureCollection(
      scene([
        route(SELECTED, "selected"),
        route(ALTERNATIVE, "alternative", [{ kind: "paved", from: 0, to: 1 }]),
      ]),
    ).features;

    expect(band(features)).toEqual([]);
  });

  it("caps a 300 km route at one band per run, never one per vertex", () => {
    const points = Array.from({ length: 600 }, (_, index) => ({
      lon: -75.2 + (3.7 * index) / 599,
      lat: 39.95,
    }));
    const runs = Array.from({ length: 120 }, (_, index) => ({
      kind: (index % 3 === 2 ? "unknown" : index % 2 === 0 ? "paved" : "gravel") as
        | "paved"
        | "gravel"
        | "unknown",
      from: index / 120,
      to: (index + 1) / 120,
    }));
    const features = routeFeatureCollection(scene([route(SELECTED, "selected", runs, points)])).features;
    const bands = band(features);

    expect(bands.length).toBeLessThanOrEqual(runs.length);
    expect(bands.length).toBe(80);
    for (const feature of bands) {
      expect((feature.geometry.coordinates as number[][]).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("stays out of hit-testing, so a tap on the band is a tap on the route", () => {
    expect(HIT_LAYER_IDS).not.toContain(MAP_LAYER_IDS.routeSurface);
    expect(HIT_LAYER_IDS).not.toContain(MAP_LAYER_IDS.routeArrow);
    // The route treatments filter on their own states, so a band feature is never
    // painted (or hit-tested) as the route itself.
    for (const id of [MAP_LAYER_IDS.routeSelected, MAP_LAYER_IDS.routeCasing]) {
      expect(byId(id).filter).toEqual(["==", ["get", "state"], "selected"]);
    }
    expect(byId(MAP_LAYER_IDS.routeSurface).filter).toEqual([
      "==",
      ["get", "state"],
      ROUTE_SURFACE_FEATURE_STATE,
    ]);
  });

  it("re-uploads the routes when only the surface runs change", () => {
    const without = fingerprintScene(scene([route(SELECTED, "selected")]));
    const withSurface = fingerprintScene(
      scene([route(SELECTED, "selected", [{ kind: "gravel", from: 0, to: 1 }])]),
    );

    expect(without.routes).not.toBe(withSurface.routes);
    expect(withSurface.routes).toContain("gravel");
  });
});

describe("the direction arrows", () => {
  it("are line-placed symbols on the selected route only", () => {
    const arrow = byId(MAP_LAYER_IDS.routeArrow);

    expect(arrow.type).toBe("symbol");
    expect(arrow.source).toBe(MAP_SOURCE_IDS.routes);
    expect(arrow.filter).toEqual(["==", ["get", "state"], "selected"]);
    expect(arrow.layout).toMatchObject({
      "symbol-placement": "line",
      // Line placement orients the icon; the image itself points up.
      "icon-rotate": 0,
      "icon-size": 1,
      "icon-image": ROUTE_ARROW_IMAGE_ID,
      "icon-ignore-placement": true,
      "icon-allow-overlap": true,
      "symbol-sort-key": 0,
    });
  });

  it("thins out as the rider zooms in, measured in screen pixels", () => {
    const arrow = byId(MAP_LAYER_IDS.routeArrow);

    // Spacing is the frame-time bound: a 300 km route draws one arrow per 72–180
    // px of line on screen, never one per vertex.
    expect(arrow.layout?.["symbol-spacing"]).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      12,
      180,
      14,
      120,
      17,
      72,
    ]);
  });

  it("is drawn as a two-tone chevron that flips for Night", () => {
    const day = createRouteArrowImage(DEFAULT_MAP_PALETTE, "day");
    const night = createRouteArrowImage(DEFAULT_MAP_PALETTE, "night");
    /** The arrow's interior, just above the notch, is the fill colour. */
    const fillAt = (image: ReturnType<typeof createRouteArrowImage>): readonly number[] => {
      const at = (13 * image.data.width + 14) * 4;
      return [...image.data.data.slice(at, at + 4)];
    };

    expect(day.id).toBe(night.id);
    expect(day.options.pixelRatio).toBe(2);
    // 14 CSS px of arrow at 2× (05 §11's icon size), halo included.
    expect(day.data.width).toBe(28);
    expect(fillAt(day)).toEqual([0xfb, 0xf9, 0xf4, 255]);
    expect(fillAt(night)).toEqual([0x16, 0x1d, 0x1c, 255]);
  });

  it("hides both details while a drawing tool owns the pointer", () => {
    expect(routeDetailVisible("pan")).toBe(true);
    for (const tool of ["sketch", "road-span-select", "point-drag", "avoid-area", "polygon-edit", "route-sculpt"] as const) {
      expect(routeDetailVisible(tool), tool).toBe(false);
    }
  });
});
