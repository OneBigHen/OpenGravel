/**
 * Basemap modes (05-MAP-INTERACTION-AND-CARTOGRAPHY §1, §22–§23; VNX-011/012).
 *
 * VNext's primary hosted renderer is Mapbox Standard. That adapter is a separate
 * option and does not exist yet; what exists is the bounded basic renderer
 * MapLibre GL, which is not a plugin framework and claims no premium parity
 * (VNX-012). It draws one of three basemaps, chosen from the environment:
 *
 * - `openfreemap` — the preview/production default: the OpenFreeMap Liberty
 *   vector style. No token, real cartography.
 * - `osm` — the raster fallback, with the OpenStreetMap attribution the tile
 *   policy requires.
 * - `empty` — the default in tests, E2E and CI: a background colour plus our own
 *   GeoJSON layers, no tile request at all. A gate must never depend on a tile
 *   server, and a deployment must never show a blank map by accident.
 *
 * The environment default is what makes that last sentence true. A production
 * server that sets nothing still draws OpenFreeMap, so the failure mode of a
 * missing variable is "real basemap", not "blank canvas"; `empty` has to be asked
 * for (or be running under a test/CI process).
 */

import type { BasemapMode } from "@/application/map/map-host";

export type { BasemapMode };

/** The modes, in the order the docs present them. */
export const BASEMAP_MODES: readonly BasemapMode[] = ["mapbox", "openfreemap", "osm", "empty"];

/**
 * Mapbox Outdoors (M3, OGV-D-265): hillshade, contours, trails and road
 * classes a rider plans by. MapLibre draws this classic style once its
 * `mapbox://` URLs are rewritten ({@link mapboxRequestUrl}); Mapbox Standard
 * (v3 imports) would need `mapbox-gl` itself, which VNext does not ship.
 */
export const MAPBOX_OUTDOORS_STYLE_URL = "mapbox://styles/mapbox/outdoors-v12";

const MAPBOX_API = "https://api.mapbox.com";

/** A public Mapbox token: `pk.` and something after it. Secret tokens never ship. */
export function isPublicMapboxToken(token: string | undefined | null): token is string {
  return typeof token === "string" && /^pk\.[\w.-]{10,}$/.test(token.trim());
}

function withToken(url: string, token: string): string {
  if (/[?&]access_token=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
}

/**
 * Rewrites a `mapbox://` style, sprite, glyph or tileset URL to the HTTPS API
 * and adds the token to any Mapbox API request that lacks one. Everything
 * else passes through untouched: the token is never sent to another host.
 */
export function mapboxRequestUrl(url: string, token: string): string {
  if (url.startsWith("mapbox://styles/")) {
    return withToken(`${MAPBOX_API}/styles/v1/${url.slice("mapbox://styles/".length)}`, token);
  }
  if (url.startsWith("mapbox://sprites/")) {
    // MapLibre asks for `…/outdoors-v12@2x.json`; the API serves `…/outdoors-v12/sprite@2x.json`.
    const match = /^mapbox:\/\/sprites\/([^/]+)\/([^@.?]+)(@2x)?(\.json|\.png)?(.*)$/.exec(url);
    if (match !== null) {
      const [, user, style, retina = "", extension = "", rest = ""] = match;
      return withToken(`${MAPBOX_API}/styles/v1/${user}/${style}/sprite${retina}${extension}${rest}`, token);
    }
  }
  if (url.startsWith("mapbox://fonts/")) {
    return withToken(`${MAPBOX_API}/fonts/v1/${url.slice("mapbox://fonts/".length)}`, token);
  }
  if (url.startsWith("mapbox://")) {
    return withToken(`${MAPBOX_API}/v4/${url.slice("mapbox://".length)}.json?secure`, token);
  }
  if (/^https:\/\/([a-z]\.)?(api|tiles)\.mapbox\.com\//.test(url)) return withToken(url, token);
  return url;
}

/** Mapbox satellite raster tiles, for the satellite layer under the ride. */
export function mapboxSatelliteTiles(token: string): string {
  return withToken(`${MAPBOX_API}/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90`, token);
}

/** OpenFreeMap's token-free Liberty vector style. */
export const OPENFREEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/** OpenStreetMap's standard raster tiles (fallback only, per the tile policy). */
export const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/** The attribution the OSM tile usage policy requires on the map (05 §23). */
export const OSM_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** True for a value the environment actually declared as a mode. */
export function isBasemapMode(value: string | undefined | null): value is BasemapMode {
  if (typeof value !== "string") return false;
  return (BASEMAP_MODES as readonly string[]).includes(value);
}

export interface BasemapEnvironment {
  /** `process.env.NODE_ENV`. */
  readonly nodeEnv?: string;
  /** Whether the process is a CI run (`process.env.CI` present). */
  readonly ci?: boolean;
  /** `NEXT_PUBLIC_MAPBOX_TOKEN`: with a public token the default is Mapbox. */
  readonly mapboxToken?: string;
}

/**
 * The mode for one process.
 *
 * An explicit, recognized value always wins. Otherwise: a test or CI process is
 * deterministic and offline (`empty`), and everything else — production,
 * preview, development — gets the real, token-free basemap.
 *
 * An unrecognized value is treated as unset rather than as an error: a typo in a
 * deployment variable must not blank the map, and the safe reading in every
 * non-test environment is the real basemap.
 */
export function resolveBasemapMode(
  raw: string | undefined,
  environment: BasemapEnvironment = {},
): BasemapMode {
  const normalized = typeof raw === "string" ? raw.trim().toLowerCase() : undefined;
  const hasMapbox = isPublicMapboxToken(environment.mapboxToken);
  // Asking for Mapbox without a token would draw nothing, so that request is
  // read as unset and the environment's default applies.
  if (normalized === "mapbox" && hasMapbox) return "mapbox";
  if (normalized !== "mapbox" && isBasemapMode(normalized)) return normalized;
  if (environment.ci === true) return "empty";
  if (environment.nodeEnv === "test") return "empty";
  return hasMapbox ? "mapbox" : "openfreemap";
}

/** What the renderer must do to draw one mode. */
export interface BasemapSpec {
  readonly mode: BasemapMode;
  /** A MapLibre style URL, or `null` when the mode has no hosted style. */
  readonly styleUrl: string | null;
  /** A raster tile template, or `null`. */
  readonly rasterTiles: string | null;
  /**
   * Attribution the *data* requires, or `null` when the style's own sources
   * already carry it (05 §23: preserve it, never duplicate it).
   */
  readonly attribution: string | null;
  /** True when drawing the mode requires a network request. */
  readonly needsNetwork: boolean;
}

/** The spec for one mode. Pure, so a deployment claim is testable. */
export function describeBasemap(mode: BasemapMode): BasemapSpec {
  switch (mode) {
    case "mapbox":
      return {
        mode,
        styleUrl: MAPBOX_OUTDOORS_STYLE_URL,
        rasterTiles: null,
        attribution: null,
        needsNetwork: true,
      };
    case "openfreemap":
      return {
        mode,
        styleUrl: OPENFREEMAP_STYLE_URL,
        rasterTiles: null,
        attribution: null,
        needsNetwork: true,
      };
    case "osm":
      return {
        mode,
        styleUrl: null,
        rasterTiles: OSM_TILE_URL,
        attribution: OSM_ATTRIBUTION,
        needsNetwork: true,
      };
    case "empty":
      return {
        mode,
        styleUrl: null,
        rasterTiles: null,
        attribution: null,
        needsNetwork: false,
      };
  }
}
