/**
 * Drawing daylight on the route line (docs/vnext/design/MAP-EXPERIENCE-NEXT.md
 * Wave 2, item 8).
 *
 * The split says which stretch is dark; these tests pin what the renderer does
 * with that answer and — more importantly — what it must not draw:
 *
 * - the after-sunset stretch is a dimmer casing over the chosen line, not a
 *   second route treatment that a tap, an arrow or a route name could pick up;
 * - the sunset marker rides the routes source as a point, so the label layer has
 *   to be told not to draw it as a route name;
 * - a scene with no daylight answer draws exactly what it drew before, and a
 *   change of split re-uploads the routes source.
 */

import { describe, expect, it } from "vitest";

import type { MapScene, RouteDaylightScene, RouteScene } from "@/application/map/types";
import {
  ROUTE_AFTER_SUNSET_FEATURE_STATE,
  ROUTE_SUNSET_MARKER_FEATURE_STATE,
} from "@/application/map/types";
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

const ROUTE_ID = asRouteCandidateId("route_selected");

const LINE: readonly { lon: number; lat: number }[] = [
  { lon: -75.2, lat: 39.95 },
  { lon: -75.1, lat: 39.95 },
  { lon: -75.0, lat: 39.95 },
];

const AFTER_SUNSET: readonly { lon: number; lat: number }[] = [LINE[1]!, LINE[2]!];
const SUNSET_AT = LINE[1]!;

function daylight(overrides: Partial<RouteDaylightScene> = {}): RouteDaylightScene {
  return {
    afterSunset: AFTER_SUNSET,
    sunsetAt: SUNSET_AT,
    sunsetIso: "2026-09-17T22:12:00.000Z",
    label: "Sunset around 6:12 PM",
    ...overrides,
  };
}

function route(overrides: Partial<RouteScene> = {}): RouteScene {
  return { id: ROUTE_ID, role: null, geometry: LINE, state: "selected", ...overrides };
}

function scene(routes: readonly RouteScene[]): MapScene {
  return {
    mode: "plan",
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

/** The Night cartography: light ink, dark paper, a dark route casing. */
const NIGHT_PALETTE: MapPalette = {
  ...DEFAULT_MAP_PALETTE,
  ink: "#ecf1ee",
  paper: "#131a17",
  routeCasing: "#131a17",
  emphasis: "1.4",
};

function byId(palette: MapPalette, id: string) {
  const layer = routeLayers(palette).find((candidate) => candidate.id === id);
  expect(layer, id).toBeDefined();
  return layer!;
}

function featureStates(sceneValue: MapScene): string[] {
  return routeFeatureCollection(sceneValue).features
    .map((feature) => String(feature.properties["state"]))
    .filter((state) => state === ROUTE_AFTER_SUNSET_FEATURE_STATE || state === ROUTE_SUNSET_MARKER_FEATURE_STATE);
}

describe("the after-sunset stretch", () => {
  it("is a dimmer casing on the routes source, filtered to its own state", () => {
    const layer = byId(DEFAULT_MAP_PALETTE, MAP_LAYER_IDS.routeAfterSunset);

    expect(layer.type).toBe("line");
    expect(layer.source).toBe(MAP_SOURCE_IDS.routes);
    expect(layer.filter).toEqual(["==", ["get", "state"], ROUTE_AFTER_SUNSET_FEATURE_STATE]);
    expect(layer.paint?.["line-opacity"]).toBeLessThan(1);
  });

  it("dims the same width as the line it covers, in both themes", () => {
    for (const palette of [DEFAULT_MAP_PALETTE, NIGHT_PALETTE]) {
      const veil = byId(palette, MAP_LAYER_IDS.routeAfterSunset);
      const casing = byId(palette, MAP_LAYER_IDS.routeCasing);
      // Same width expression: the veil must cover the casing, not sit inside it.
      expect(veil.paint?.["line-width"]).toEqual(casing.paint?.["line-width"]);
      // The veil is the line's own casing colour at reduced opacity — a dimmer
      // version of the edge the rider already reads, dark in both themes (Night's
      // palette ink is near-white and would brighten the line instead).
      expect(veil.paint?.["line-color"]).toBe(casing.paint?.["line-color"]);
      expect(Number(veil.paint?.["line-opacity"])).toBeLessThan(Number(casing.paint?.["line-opacity"] ?? 1));
    }
  });

  it("is drawn over the line and its surface band, but under the direction arrows", () => {
    const ids = routeLayers(DEFAULT_MAP_PALETTE).map((layer) => layer.id);
    const veil = ids.indexOf(MAP_LAYER_IDS.routeAfterSunset);

    expect(veil).toBeGreaterThan(ids.indexOf(MAP_LAYER_IDS.routeSelected));
    expect(veil).toBeGreaterThan(ids.indexOf(MAP_LAYER_IDS.routeSurface));
    expect(veil).toBeLessThan(ids.indexOf(MAP_LAYER_IDS.routeArrow));
  });

  it("is never a hit target", () => {
    expect(HIT_LAYER_IDS).not.toContain(MAP_LAYER_IDS.routeAfterSunset);
    expect(HIT_LAYER_IDS).not.toContain(MAP_LAYER_IDS.routeSunsetMarker);
  });
});

describe("the sunset marker", () => {
  it("is a small Golden Hour disc on the routes source, filtered to its own state", () => {
    const layer = byId(DEFAULT_MAP_PALETTE, MAP_LAYER_IDS.routeSunsetMarker);

    expect(layer.type).toBe("circle");
    expect(layer.source).toBe(MAP_SOURCE_IDS.routes);
    expect(layer.filter).toEqual(["==", ["get", "state"], ROUTE_SUNSET_MARKER_FEATURE_STATE]);
    expect(layer.paint?.["circle-color"]).toBe(DEFAULT_MAP_PALETTE.goldenHour);
    expect(Number(layer.paint?.["circle-radius"])).toBeLessThanOrEqual(8);
  });

  it("is not drawn as a route name", () => {
    const label = byId(DEFAULT_MAP_PALETTE, MAP_LAYER_IDS.routeLabel);
    const filter = JSON.stringify(label.filter);

    expect(filter).toContain(ROUTE_SUNSET_MARKER_FEATURE_STATE);
    expect(filter).toContain("!=");
  });
});

describe("the scene it draws", () => {
  it("emits the after-sunset line and the marker at the split", () => {
    const collection = routeFeatureCollection(scene([route({ daylight: daylight() })]));
    const veil = collection.features.find(
      (feature) => feature.properties["state"] === ROUTE_AFTER_SUNSET_FEATURE_STATE,
    );
    const marker = collection.features.find(
      (feature) => feature.properties["state"] === ROUTE_SUNSET_MARKER_FEATURE_STATE,
    );

    expect(veil).toBeDefined();
    expect(veil!.geometry.type).toBe("LineString");
    expect(veil!.geometry.coordinates).toEqual(AFTER_SUNSET.map((point) => [point.lon, point.lat]));
    expect(marker).toBeDefined();
    expect(marker!.geometry.type).toBe("Point");
    expect(marker!.geometry.coordinates).toEqual([SUNSET_AT.lon, SUNSET_AT.lat]);
  });

  it("draws nothing extra when the daylight answer is missing", () => {
    expect(featureStates(scene([route()]))).toEqual([]);
    // The surface band and the route line are still exactly one feature each.
    const collection = routeFeatureCollection(scene([route()]));
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]!.properties["state"]).toBe("selected");
  });

  it("is not attached to an alternative or a stale line", () => {
    expect(featureStates(scene([route({ state: "alternative", daylight: daylight() })]))).toEqual([]);
    expect(featureStates(scene([route({ state: "previous", daylight: daylight() })]))).toEqual([]);
  });

  it("re-uploads the routes source when the split moves", () => {
    const before = fingerprintScene(scene([route({ daylight: daylight() })]));
    const moved = fingerprintScene(
      scene([
        route({
          daylight: daylight({ afterSunset: [LINE[2]!], sunsetAt: LINE[2]!, sunsetIso: "2026-09-17T22:20:00.000Z" }),
        }),
      ]),
    );

    expect(moved.routes).not.toBe(before.routes);
  });

  it("does not re-upload the route when the answer is unchanged", () => {
    expect(fingerprintScene(scene([route({ daylight: daylight() })])).routes)
      .toBe(fingerprintScene(scene([route({ daylight: daylight() })])).routes);
  });
});
