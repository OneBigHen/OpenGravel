/**
 * Browser-side `MapLayersSource`: our own `/api/map-layers` route and the
 * traffic-tile proxy, which hold the provider keys. Transport failures read as
 * every provider unavailable, never as an empty map.
 */

import type {
  AlongStopsResult,
  InfoFeature,
  LngLat,
  InfoProvider,
  MapLayerBounds,
  MapLayerId,
  MapLayersResult,
  MapLayersSource,
} from "@/application/map-layers";

export interface HttpMapLayersSourceOptions {
  /** Deployment prefix (`asset-base-path`), e.g. `/ogv`. Empty at the origin root. */
  readonly basePath?: string;
  readonly fetch?: typeof fetch;
  /** The page origin; tile templates must be absolute for the renderer. */
  readonly origin?: string;
}

const ALL_PROVIDERS: readonly InfoProvider[] = ["osm", "tomtom", "nws", "roads", "pa511"];

function isResult(value: unknown): value is MapLayersResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { features?: unknown; unavailable?: unknown };
  return Array.isArray(candidate.features) && Array.isArray(candidate.unavailable);
}

/** Keeps a long route under the endpoint's point limit; the shape is what matters. */
function thin(line: readonly LngLat[], max = 2_000): readonly LngLat[] {
  if (line.length <= max) return line;
  const step = (line.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, index) => line[Math.round(index * step)]!);
}

export function createHttpMapLayersSource(options: HttpMapLayersSourceOptions = {}): MapLayersSource {
  const base = (options.basePath ?? "").replace(/\/+$/, "");
  const origin = options.origin ?? (typeof window === "undefined" ? "" : window.location.origin);
  return {
    async along(line: readonly LngLat[], layerId: MapLayerId, signal?: AbortSignal): Promise<AlongStopsResult> {
      try {
        const response = await (options.fetch ?? fetch)(`${base}/api/map-layers/along`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ line: thin(line), layer: layerId }),
          ...(signal === undefined ? {} : { signal }),
        });
        const body = (await response.json()) as Partial<AlongStopsResult>;
        return Array.isArray(body.stops) && typeof body.available === "boolean"
          ? { stops: body.stops, available: body.available }
          : { stops: [], available: false };
      } catch (error) {
        if (signal?.aborted === true) throw error;
        return { stops: [], available: false };
      }
    },
    trafficTileUrl: `${origin}${base}/api/map-tiles/traffic/{z}/{x}/{y}`,
    async load(bounds: MapLayerBounds, layers: readonly MapLayerId[], signal?: AbortSignal) {
      const params = new URLSearchParams({
        bbox: [bounds.west, bounds.south, bounds.east, bounds.north].map((value) => value.toFixed(5)).join(","),
        layers: layers.join(","),
      });
      let response: Response;
      try {
        response = await (options.fetch ?? fetch)(`${base}/api/map-layers?${params.toString()}`, {
          ...(signal === undefined ? {} : { signal }),
        });
      } catch (error) {
        if (signal?.aborted === true) throw error;
        return { features: [], unavailable: ALL_PROVIDERS };
      }
      try {
        const body: unknown = await response.json();
        if (!isResult(body)) return { features: [], unavailable: ALL_PROVIDERS };
        return { features: body.features as readonly InfoFeature[], unavailable: body.unavailable };
      } catch {
        return { features: [], unavailable: ALL_PROVIDERS };
      }
    },
  };
}
