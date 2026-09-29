/**
 * Basemap modes (05 §1, §22–§23; VNX-011/VNX-012).
 *
 * VNext's hosted primary is Mapbox Standard. That adapter does not exist yet, so
 * the bounded basic renderer is MapLibre GL with one of two no-token basemaps,
 * and the mode is env-driven:
 *
 * - `openfreemap` — preview/production default: MapLibre + the OpenFreeMap
 *   Liberty vector style (no token).
 * - `osm` — raster fallback with the OpenStreetMap attribution.
 * - `empty` — tests, E2E and CI: no tile request at all, so a gate can never
 *   depend on the network and can never go red because a tile server blinked.
 *
 * The resolution is a pure function so the *deployment* claim ("preview shows a
 * real basemap") and the *test* claim ("no tile network") are both unit-tested
 * rather than inferred from a running server.
 */

import { describe, expect, it } from "vitest";

import {
  BASEMAP_MODES,
  OSM_ATTRIBUTION,
  OSM_TILE_URL,
  OPENFREEMAP_STYLE_URL,
  describeBasemap,
  isBasemapMode,
  isPublicMapboxToken,
  mapboxRequestUrl,
  mapboxSatelliteTiles,
  MAPBOX_OUTDOORS_STYLE_URL,
  resolveBasemapMode,
} from "@/infrastructure/map/basemap";

const TOKEN = "pk.test-public-token-1234";

describe("resolveBasemapMode", () => {
  it("uses an explicit mode", () => {
    // Mapbox is explicit too, but only with the token it cannot draw without.
    for (const mode of BASEMAP_MODES) {
      expect(resolveBasemapMode(mode, { nodeEnv: "production", mapboxToken: TOKEN })).toBe(mode);
    }
  });

  it("ignores case and surrounding whitespace", () => {
    expect(resolveBasemapMode(" OpenFreeMap ", {})).toBe("openfreemap");
  });

  it("defaults to the real basemap in a production server", () => {
    expect(resolveBasemapMode(undefined, { nodeEnv: "production" })).toBe(
      "openfreemap",
    );
    expect(resolveBasemapMode("", { nodeEnv: "production" })).toBe("openfreemap");
  });

  it("defaults to the deterministic empty basemap in tests", () => {
    expect(resolveBasemapMode(undefined, { nodeEnv: "test" })).toBe("empty");
  });

  it("defaults to the deterministic empty basemap in CI", () => {
    expect(resolveBasemapMode(undefined, { ci: true, nodeEnv: "production" })).toBe(
      "empty",
    );
  });

  it("falls back to the environment default for an unrecognized value", () => {
    // A typo must not produce a token-less broken map: the environment default
    // (a real basemap in production) is the safe reading.
    expect(resolveBasemapMode("openfreemap2", { nodeEnv: "production" })).toBe(
      "openfreemap",
    );
    expect(resolveBasemapMode("mapbox", { ci: true })).toBe("empty");
  });

  it("defaults to Mapbox Outdoors with a public token, and never without one (OGV-D-265)", () => {
    expect(resolveBasemapMode(undefined, { nodeEnv: "production", mapboxToken: TOKEN })).toBe("mapbox");
    expect(resolveBasemapMode("auto", { nodeEnv: "production", mapboxToken: TOKEN })).toBe("mapbox");
    expect(resolveBasemapMode("mapbox", { nodeEnv: "production" })).toBe("openfreemap");
    expect(resolveBasemapMode("openfreemap", { mapboxToken: TOKEN })).toBe("openfreemap");
    // Tests stay offline even when a token is in the environment.
    expect(resolveBasemapMode(undefined, { ci: true, mapboxToken: TOKEN })).toBe("empty");
    // A secret token is never a basemap token.
    expect(isPublicMapboxToken("sk.secret-token-123456")).toBe(false);
    expect(describeBasemap("mapbox").styleUrl).toBe(MAPBOX_OUTDOORS_STYLE_URL);
  });

  it("rewrites mapbox:// URLs to the API and sends the token nowhere else", () => {
    expect(mapboxRequestUrl("mapbox://styles/mapbox/outdoors-v12", TOKEN)).toBe(
      `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12?access_token=${TOKEN}`,
    );
    expect(mapboxRequestUrl("mapbox://sprites/mapbox/outdoors-v12@2x.json", TOKEN)).toBe(
      `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/sprite@2x.json?access_token=${TOKEN}`,
    );
    expect(mapboxRequestUrl("mapbox://fonts/mapbox/DIN Pro Medium/0-255.pbf", TOKEN)).toBe(
      `https://api.mapbox.com/fonts/v1/mapbox/DIN Pro Medium/0-255.pbf?access_token=${TOKEN}`,
    );
    expect(mapboxRequestUrl("mapbox://mapbox.mapbox-streets-v8,mapbox.mapbox-terrain-v2", TOKEN)).toBe(
      `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8,mapbox.mapbox-terrain-v2.json?secure&access_token=${TOKEN}`,
    );
    const tile = "https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/1/2/3.vector.pbf?sku=x&access_token=abc";
    expect(mapboxRequestUrl(tile, TOKEN)).toBe(tile);
    expect(mapboxRequestUrl("https://tiles.openfreemap.org/styles/liberty", TOKEN)).toBe(
      "https://tiles.openfreemap.org/styles/liberty",
    );
    expect(mapboxSatelliteTiles(TOKEN)).toContain("mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=");
  });

  it("recognizes exactly the documented modes", () => {
    expect([...BASEMAP_MODES]).toEqual(["mapbox", "openfreemap", "osm", "empty"]);
    expect(isBasemapMode("empty")).toBe(true);
    expect(isBasemapMode("OPENFREEMAP")).toBe(false);
    expect(isBasemapMode(undefined)).toBe(false);
  });
});

describe("describeBasemap", () => {
  it("describes the OpenFreeMap style without a token", () => {
    const spec = describeBasemap("openfreemap");

    expect(spec.styleUrl).toBe(OPENFREEMAP_STYLE_URL);
    expect(spec.rasterTiles).toBeNull();
    expect(spec.needsNetwork).toBe(true);
    // The style's own sources carry their attribution; the host must not
    // duplicate it.
    expect(spec.attribution).toBeNull();
  });

  it("describes the OSM raster fallback with its attribution", () => {
    const spec = describeBasemap("osm");

    expect(spec.styleUrl).toBeNull();
    expect(spec.rasterTiles).toBe(OSM_TILE_URL);
    expect(spec.attribution).toBe(OSM_ATTRIBUTION);
    expect(spec.attribution).toContain("OpenStreetMap");
    expect(spec.needsNetwork).toBe(true);
  });

  it("describes the empty basemap as needing no network and no attribution", () => {
    const spec = describeBasemap("empty");

    expect(spec.styleUrl).toBeNull();
    expect(spec.rasterTiles).toBeNull();
    expect(spec.attribution).toBeNull();
    expect(spec.needsNetwork).toBe(false);
  });
});
