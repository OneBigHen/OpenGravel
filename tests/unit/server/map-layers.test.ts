/**
 * The rider's map layers on the server (UX rework phase 8): provider payloads
 * become InfoFeatures, a failing provider is named instead of looking empty,
 * views are validated and clipped, and answers are cached per view.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearMapLayersCache,
  handleMapLayersRequest,
  parseBounds,
  parseLayers,
  trafficTileUpstream,
} from "@/server/map-layers/handler";
import {
  knownRoadsProvider,
  overpassQuery,
  parseNwsAlerts,
  parseOverpass,
  parseTomTomIncidents,
  parseTomTomStops,
  type LayerProvider,
} from "@/server/map-layers/providers";

const VIEW = { west: -75.6, south: 39.9, east: -75.0, north: 40.3 };

beforeEach(() => clearMapLayersCache());

describe("provider payloads", () => {
  it("reads TomTom stops inside the view with brand, street and phone", () => {
    const features = parseTomTomStops({
      results: [
        {
          id: "a1",
          poi: { name: "Wawa", brands: [{ name: "Wawa" }], phone: "+1 610-555-0100" },
          address: { streetName: "Dekalb Pike", municipality: "King of Prussia" },
          position: { lat: 40.09, lon: -75.39 },
        },
        { id: "far", poi: { name: "Outside" }, position: { lat: 41.5, lon: -75.39 } },
      ],
    }, "fuel", VIEW);
    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({
      id: "tomtom:a1",
      layerId: "fuel",
      name: "Wawa",
      detail: "Dekalb Pike, King of Prussia · +1 610-555-0100",
      geometry: { type: "Point", coordinates: [-75.39, 40.09] },
    });
  });

  it("names TomTom incidents the way a rider says them, with delay and extent", () => {
    const [closure] = parseTomTomIncidents({
      incidents: [{
        type: "Feature",
        properties: { id: "t1", iconCategory: 8, magnitudeOfDelay: 4, events: [{ description: "Closed" }], from: "Main St", to: "Oak Ave", delay: 600 },
        geometry: { type: "LineString", coordinates: [[-75.5, 40.1], [-75.49, 40.1]] },
      }],
    });
    expect(closure).toMatchObject({ layerId: "live-traffic", name: "Road closed", detail: "Closed · +10 min · Main St → Oak Ave", weight: 4 });
    expect(closure?.geometry.type).toBe("LineString");
  });

  it("turns NWS multipolygons into one alert area per part", () => {
    const ring = [[-75.5, 40], [-75.4, 40], [-75.4, 40.1], [-75.5, 40]];
    const features = parseNwsAlerts({
      features: [{ id: "w1", properties: { event: "Flood Watch", severity: "Moderate" }, geometry: { type: "MultiPolygon", coordinates: [[ring], [ring]] } }],
    });
    expect(features).toHaveLength(2);
    expect(features[0]).toMatchObject({ layerId: "weather", name: "Flood Watch" });
  });

  it("asks Overpass only for the layers it serves, lines with geometry and points by centre", () => {
    expect(overpassQuery(VIEW, ["fuel"])).toBeNull();
    const query = overpassQuery(VIEW, ["forest-roads", "cell-towers"]);
    expect(query).toContain("out geom");
    expect(query).toContain("out center");
    const features = parseOverpass({
      elements: [
        { type: "way", id: 1, tags: { highway: "track", ref: "FS 123", surface: "gravel" }, geometry: [{ lat: 40, lon: -75.5 }, { lat: 40.01, lon: -75.49 }] },
        { type: "node", id: 2, lat: 40.05, lon: -75.3, tags: { man_made: "mast", "tower:type": "communication", operator: "Verizon" } },
      ],
    }, ["forest-roads", "cell-towers"]);
    expect(features.map((feature) => [feature.layerId, feature.name, feature.detail])).toEqual([
      ["forest-roads", "FS 123", "FS 123 · gravel"],
      ["cell-towers", "Cell tower", "Verizon"],
    ]);
  });

  it("serves great roads twistiest first from the local catalogue", async () => {
    const provider = knownRoadsProvider({
      curvyRoadsNear: () => [
        { id: "a", name: "", rating: 1200, line: [{ lon: -75.5, lat: 40 }, { lon: -75.4, lat: 40 }] },
        { id: "b", name: "Decker Road", rating: 5200, line: [{ lon: -75.5, lat: 40.1 }, { lon: -75.4, lat: 40.1 }] },
      ],
      gravelCorridorsNear: () => [],
    });
    const features = await provider.load(VIEW, ["great-roads"], { fetch, env: {} });
    expect(features.map((feature) => feature.name)).toEqual(["Decker Road", "Twisty road"]);
  });
});

describe("handleMapLayersRequest", () => {
  const url = (query: string): URL => new URL(`http://x/api/map-layers?${query}`);

  it("validates the view and the layers", () => {
    expect(parseBounds(null)).toBeTypeOf("string");
    expect(parseBounds("-75,40,-76,41")).toBeTypeOf("string");
    expect(parseLayers("fuel,nonsense")).toBeTypeOf("string");
    expect(parseLayers("traffic-flow")).toBeTypeOf("string");
    expect(parseLayers("fuel,traffic-flow,fuel")).toEqual(["fuel"]);
  });

  it("clips a huge view to the served span around its centre", () => {
    const bounds = parseBounds("-80,35,-70,45");
    expect(bounds).toEqual({ west: -75.8, south: 39.5, east: -74.2, north: 40.5 });
  });

  it("names a failing provider and still serves the others, then caches per view", async () => {
    const good: LayerProvider = {
      id: "roads",
      layers: ["great-roads"],
      ttlMs: 60_000,
      load: vi.fn(async () => [{ id: "r", layerId: "great-roads", name: "Road", detail: null, weight: 1, geometry: { type: "LineString", coordinates: [[-75.5, 40], [-75.4, 40]] } }] as const),
    };
    const bad: LayerProvider = { id: "tomtom", layers: ["fuel"], ttlMs: 60_000, load: vi.fn(async () => { throw new Error("down"); }) };
    const deps = { env: {}, providers: [good, bad], now: () => 1_000 };
    const first = await handleMapLayersRequest(url("bbox=-75.6,39.9,-75.0,40.3&layers=great-roads,fuel"), deps);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ unavailable: ["tomtom"] });
    expect("features" in first.body && first.body.features).toHaveLength(1);
    await handleMapLayersRequest(url("bbox=-75.6,39.9,-75.0,40.3&layers=great-roads,fuel"), deps);
    expect(good.load).toHaveBeenCalledTimes(1);
    expect(bad.load).toHaveBeenCalledTimes(2);
  });

  it("answers from the fixture when asked", async () => {
    const result = await handleMapLayersRequest(url("bbox=-75.6,39.9,-75.0,40.3&layers=fuel,gravel"), { env: { OGV_MAP_LAYERS_FIXTURE: "1" } });
    expect("features" in result.body && result.body.features.map((feature) => feature.layerId)).toEqual(["fuel", "gravel"]);
  });

  it("builds a keyed traffic tile URL only for a valid tile and a configured key", () => {
    expect(trafficTileUpstream(10, 1, 1, {})).toBeNull();
    expect(trafficTileUpstream(10, 2000, 1, { TOMTOM_API_KEY: "k" })).toBeNull();
    expect(trafficTileUpstream(10, 300, 380, { TOMTOM_API_KEY: "k" })).toContain("/flow/relative0/10/300/380.png?key=k&tileSize=512");
  });
});

describe("stops along a route", () => {
  it("samples the route, keeps stations within a mile, in route order, and measures the gaps", async () => {
    const { handleStopsAlong } = await import("@/server/map-layers/along");
    const { gapSummary } = await import("@/application/map-layers");
    // A straight 30-mile route east along 40°N.
    const line = [[-75.6, 40], [-75.03, 40]];
    const fetcher = vi.fn(async (url: string) => {
      const lon = Number(new URL(url).searchParams.get("lon"));
      return new Response(JSON.stringify({
        results: [
          { id: `near-${lon.toFixed(1)}`, poi: { name: "Near" }, position: { lat: 40.001, lon: Number(lon.toFixed(1)) } },
          { id: "far", poi: { name: "Far" }, position: { lat: 40.2, lon } },
        ],
      }));
    });
    const result = await handleStopsAlong({ line, layer: "fuel" }, { env: { TOMTOM_API_KEY: "k" }, fetch: fetcher as unknown as typeof fetch });
    expect(result.status).toBe(200);
    if (!("stops" in result.body)) throw new Error("expected stops");
    expect(result.body.available).toBe(true);
    expect(result.body.stops.every((stop) => stop.feature.name === "Near")).toBe(true);
    const along = result.body.stops.map((stop) => stop.alongMeters);
    expect([...along].sort((a, b) => a - b)).toEqual(along);
    const summary = gapSummary(result.body.stops, 48_500, 20_000);
    expect(summary.longestGapMeters).toBeGreaterThan(0);
  });

  it("refuses a non-stop layer and answers unavailable without a key", async () => {
    const { handleStopsAlong } = await import("@/server/map-layers/along");
    const line = [[-75.6, 40], [-75.5, 40]];
    expect((await handleStopsAlong({ line, layer: "weather" }, { env: { TOMTOM_API_KEY: "k" } })).status).toBe(400);
    expect((await handleStopsAlong({ line, layer: "fuel" }, { env: {} })).body).toEqual({ stops: [], available: false });
  });
});
