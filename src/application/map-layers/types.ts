/**
 * Map-layer data as it travels from `/api/map-layers` to the map (UX rework
 * phase 8). Coordinates are `[lon, lat]` GeoJSON order, because the payload is
 * drawn as GeoJSON and never becomes ride geometry.
 */

import type { AlongStopsResult } from "./along";
import type { MapLayerId } from "./catalog";

export type LngLat = readonly [number, number];

export type InfoGeometry =
  | { readonly type: "Point"; readonly coordinates: LngLat }
  | { readonly type: "LineString"; readonly coordinates: readonly LngLat[] }
  | { readonly type: "Polygon"; readonly coordinates: readonly (readonly LngLat[])[] };

export interface InfoMedia {
  /** Current still image, if the provider exposes one without a playback session. */
  readonly previewUrl: string | null;
  /** Same-origin or directly playable media URL. Null until a provider resolves playback safely. */
  readonly playbackUrl: string | null;
  /** Official/source page for the camera or media item. */
  readonly sourceHref: string | null;
  /** Refresh cadence for a still image. Null means do not poll. */
  readonly refreshSeconds: number | null;
  /** Provider says a live stream exists even when playbackUrl is not resolved yet. */
  readonly videoAvailable: boolean;
}

export interface InfoFeature {
  /** Stable per source, e.g. `osm:node/123` or `tomtom:abc`. */
  readonly id: string;
  readonly layerId: MapLayerId;
  /** What the rider reads first: a venue name, "Road closed", "Flood Watch". */
  readonly name: string;
  /** One supporting line: delay, road, rating, opening hours. */
  readonly detail: string | null;
  /** A number the map styles by (curvature rating, incident magnitude), if any. */
  readonly weight: number | null;
  /** A local derived presentation variant, without changing the source layer. */
  readonly overlay?: "road-history";
  /** Optional media shown in the feature card (traffic camera still/video today). */
  readonly media?: InfoMedia | null;
  readonly geometry: InfoGeometry;
}

/** Which providers could not answer; an empty list with no features is a real "nothing here". */
export type InfoProvider = "osm" | "tomtom" | "nws" | "roads" | "road-history" | "traffic-cameras" | "terrain" | "hillshade" | "radar" | "firms" | "padus" | "authority" | "surface";

export interface LayerFreshness {
  readonly layerId: MapLayerId;
  readonly source: string;
  /** Retrieval time, never a substitute for the source observation date. */
  readonly fetchedAt: string;
  readonly observedAt: string | null;
  readonly stale: boolean;
  readonly staleAfterMs?: number;
  readonly note: string;
}

export interface TerrainGrid {
  readonly bounds: MapLayerBounds;
  readonly size: number;
  /** Row-major south to north, west to east. */
  readonly heights: readonly number[];
}

export interface LayerRaster {
  readonly layerId: MapLayerId;
  readonly url: string;
  readonly bounds: MapLayerBounds;
  readonly attribution: string;
}

export interface MapLayersResult {
  readonly features: readonly InfoFeature[];
  readonly unavailable: readonly InfoProvider[];
  readonly freshness?: readonly LayerFreshness[];
  readonly terrainGrid?: TerrainGrid;
  readonly rasters?: readonly LayerRaster[];
}

export interface MapLayerBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/** The browser's view of the layers endpoint. */
export interface MapLayersSource {
  load(
    bounds: MapLayerBounds,
    layers: readonly MapLayerId[],
    signal?: AbortSignal,
  ): Promise<MapLayersResult>;
  /** The URL template for the traffic-flow raster tiles, `{z}/{x}/{y}` style. */
  readonly trafficTileUrl: string | null;
  /** Stops of one layer within about a mile of a route, in route order. */
  along?(
    line: readonly LngLat[],
    layerId: MapLayerId,
    signal?: AbortSignal,
  ): Promise<AlongStopsResult>;
}

/** The largest view the endpoint serves, in degrees; larger views are clipped to the centre. */
export const MAX_LAYER_SPAN_DEGREES = { lon: 1.6, lat: 1.0 } as const;

/** Clips a view to the served span around its centre. */
export function clampLayerBounds(bounds: MapLayerBounds): MapLayerBounds {
  const midLon = (bounds.west + bounds.east) / 2;
  const midLat = (bounds.south + bounds.north) / 2;
  const halfLon = Math.min((bounds.east - bounds.west) / 2, MAX_LAYER_SPAN_DEGREES.lon / 2);
  const halfLat = Math.min((bounds.north - bounds.south) / 2, MAX_LAYER_SPAN_DEGREES.lat / 2);
  return {
    west: midLon - halfLon,
    south: midLat - halfLat,
    east: midLon + halfLon,
    north: midLat + halfLat,
  };
}
