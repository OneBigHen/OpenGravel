/**
 * `/api/map-layers`: the key boundary for the rider's map layers (UX rework
 * phase 8). The browser sends a view and a list of layers; provider keys stay
 * here. Answers are cached per provider and per view snapped to a grid, so a
 * rider panning around one area costs each provider a handful of calls.
 *
 * A provider that cannot answer is named in `unavailable` and its layers stay
 * empty; the rest of the answer is still served. With `OGV_MAP_LAYERS_FIXTURE=1`
 * every provider is replaced by a small deterministic set for browser gates.
 */

import {
  clampLayerBounds,
  isMapLayerId,
  mapLayer,
  type InfoFeature,
  type InfoProvider,
  type MapLayerBounds,
  type MapLayerId,
  type MapLayersResult,
} from "@/application/map-layers";
import { knownRoadsFromEnv } from "@/server/roads/known-roads-db";

import {
  knownRoadsProvider,
  nwsAlertsProvider,
  overpassProvider,
  tomtomIncidentsProvider,
  tomtomStopsProvider,
  type LayerProvider,
} from "./providers";

export interface MapLayersHandlerResult {
  readonly status: number;
  readonly body: MapLayersResult | { readonly error: { readonly code: "validation"; readonly message: string } };
}

export interface MapLayersDeps {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof fetch;
  readonly providers?: readonly LayerProvider[];
  readonly now?: () => number;
}

/** The grid a view is snapped to for caching, in degrees. */
const CACHE_GRID_DEGREES = 0.05;
const CACHE_MAX_ENTRIES = 512;

const cache = new Map<string, { readonly features: readonly InfoFeature[]; readonly expiresAt: number }>();

export function clearMapLayersCache(): void {
  cache.clear();
}

function validation(message: string): MapLayersHandlerResult {
  return { status: 400, body: { error: { code: "validation", message } } };
}

export function parseBounds(raw: string | null): MapLayerBounds | string {
  if (raw === null) return "bbox is required (west,south,east,north).";
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return "bbox must be four numbers.";
  const [west, south, east, north] = parts as [number, number, number, number];
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) {
    return "bbox is out of range or inverted.";
  }
  return clampLayerBounds({ west, south, east, north });
}

export function parseLayers(raw: string | null): readonly MapLayerId[] | string {
  const ids = [...new Set((raw ?? "").split(",").map((id) => id.trim()).filter((id) => id !== ""))];
  if (ids.length === 0) return "layers is required.";
  if (!ids.every(isMapLayerId)) return "layers names an unknown layer.";
  const features = ids.filter((id) => mapLayer(id).kind === "features");
  return features.length === 0 ? "layers names no data layer." : features;
}

function snap(bounds: MapLayerBounds): MapLayerBounds {
  const down = (value: number): number => Math.floor(value / CACHE_GRID_DEGREES) * CACHE_GRID_DEGREES;
  const up = (value: number): number => Math.ceil(value / CACHE_GRID_DEGREES) * CACHE_GRID_DEGREES;
  return clampLayerBounds({ west: down(bounds.west), south: down(bounds.south), east: up(bounds.east), north: up(bounds.north) });
}

function remember(key: string, features: readonly InfoFeature[], expiresAt: number): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { features, expiresAt });
}

function fixtureFeatures(bounds: MapLayerBounds, layers: readonly MapLayerId[]): readonly InfoFeature[] {
  const lon = (bounds.west + bounds.east) / 2;
  const lat = (bounds.south + bounds.north) / 2;
  const dx = (bounds.east - bounds.west) / 8;
  const dy = (bounds.north - bounds.south) / 8;
  return layers.map((layerId, index): InfoFeature => {
    const definition = mapLayer(layerId);
    const offset = (index % 5) - 2;
    return {
      id: `fixture:${layerId}`,
      layerId,
      name: `${definition.name} (fixture)`,
      detail: definition.legend,
      weight: 5,
      geometry: layerId === "great-roads" || layerId === "gravel" || layerId === "forest-roads"
        ? { type: "LineString", coordinates: [[lon - dx, lat + offset * dy], [lon + dx, lat + offset * dy]] }
        : { type: "Point", coordinates: [lon + offset * dx, lat - dy] },
    };
  });
}

export function defaultProviders(env: Readonly<Record<string, string | undefined>>): readonly LayerProvider[] {
  return [
    tomtomStopsProvider,
    tomtomIncidentsProvider,
    nwsAlertsProvider,
    knownRoadsProvider(knownRoadsFromEnv(env)),
    overpassProvider,
  ];
}

export async function handleMapLayersRequest(
  url: URL,
  deps: MapLayersDeps = {},
  signal?: AbortSignal,
): Promise<MapLayersHandlerResult> {
  const bounds = parseBounds(url.searchParams.get("bbox"));
  if (typeof bounds === "string") return validation(bounds);
  const layers = parseLayers(url.searchParams.get("layers"));
  if (typeof layers === "string") return validation(layers);
  const env = deps.env ?? process.env;
  if (env["OGV_MAP_LAYERS_FIXTURE"] === "1") {
    return { status: 200, body: { features: fixtureFeatures(bounds, layers), unavailable: [] } };
  }

  const now = deps.now ?? Date.now;
  const view = snap(bounds);
  const providers = deps.providers ?? defaultProviders(env);
  const context = { fetch: deps.fetch ?? fetch, env, ...(signal === undefined ? {} : { signal }) };
  const unavailable = new Set<InfoProvider>();
  const answers = await Promise.all(providers.map(async (provider) => {
    const wanted = layers.filter((layer) => provider.layers.includes(layer));
    if (wanted.length === 0) return [];
    const key = `${provider.id}:${provider.layers.join("+")}:${wanted.join("+")}:${view.west.toFixed(2)},${view.south.toFixed(2)},${view.east.toFixed(2)},${view.north.toFixed(2)}`;
    const cached = cache.get(key);
    if (cached !== undefined && cached.expiresAt > now()) return cached.features;
    try {
      const features = await provider.load(view, wanted, context);
      remember(key, features, now() + provider.ttlMs);
      return features;
    } catch {
      unavailable.add(provider.id);
      return [];
    }
  }));
  return { status: 200, body: { features: answers.flat(), unavailable: [...unavailable] } };
}

/**
 * The traffic-flow tile proxy: TomTom's relative-speed raster for one tile.
 * Returns `null` when no key is configured or the coordinates are invalid.
 */
export function trafficTileUpstream(
  z: number,
  x: number,
  y: number,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const key = env["TOMTOM_TRAFFIC_API_KEY"] ?? env["TOMTOM_API_KEY"];
  if (key === undefined || key.trim() === "") return null;
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 22) return null;
  const max = 2 ** z;
  if (x < 0 || y < 0 || x >= max || y >= max) return null;
  return `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/${z}/${x}/${y}.png?key=${encodeURIComponent(key.trim())}&tileSize=512`;
}
