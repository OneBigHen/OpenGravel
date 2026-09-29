/**
 * Elevation from Terrarium DEM tiles (server only).
 *
 * The tiles are the AWS Open Data "Terrain Tiles" set (Mapzen Terrarium
 * encoding: `height = R * 256 + G + B / 256 - 32768` metres), public and keyless.
 * They send no CORS headers, so the browser asks our `/api/elevation` and this
 * adapter reads the tiles here. Decoded tiles are kept in a small LRU, so the
 * alternates of one plan — which share most of their ground — cost one fetch per
 * tile, not one per route.
 */

import type { ElevationResult, ElevationSource } from "@/application/elevation/profile";
import type { Coordinate } from "@/domain/ride/types";

import { decodePng, type DecodedPng } from "./png-decode";

/** ~38 m per pixel at the equator, ~29 m in Pennsylvania: finer than a road's grade matters. */
export const TERRARIUM_ZOOM = 12;
const TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const TILE_CACHE_MAX = 96;
const FETCH_TIMEOUT_MS = 8_000;

export interface TerrariumSourceOptions {
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
}

function tileKey(x: number, y: number): string {
  return `${TERRARIUM_ZOOM}/${x}/${y}`;
}

/** The point's position in global pixel space at the tile zoom (Web Mercator). */
function pixelOf(point: Coordinate): { readonly px: number; readonly py: number } {
  const scale = 256 * 2 ** TERRARIUM_ZOOM;
  const lat = Math.max(-85.0511, Math.min(85.0511, point.lat));
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    px: ((point.lon + 180) / 360) * scale,
    py: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function heightAt(tile: DecodedPng, x: number, y: number): number {
  const index = (Math.min(255, Math.max(0, y)) * tile.width + Math.min(255, Math.max(0, x))) * tile.channels;
  return tile.data[index]! * 256 + tile.data[index + 1]! + tile.data[index + 2]! / 256 - 32768;
}

export function createTerrariumElevationSource(options: TerrariumSourceOptions = {}): ElevationSource {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? TILE_URL;
  const cache = new Map<string, Promise<DecodedPng>>();

  const tile = (x: number, y: number, signal?: AbortSignal): Promise<DecodedPng> => {
    const key = tileKey(x, y);
    const cached = cache.get(key);
    if (cached !== undefined) {
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }
    const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const pending = fetchImpl(`${baseUrl}/${key}.png`, {
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    }).then(async (response) => {
      if (!response.ok) throw new Error(`tile ${response.status}`);
      return decodePng(new Uint8Array(await response.arrayBuffer()));
    });
    cache.set(key, pending);
    // A failed tile is not remembered: the next plan may reach it.
    pending.catch(() => cache.delete(key));
    while (cache.size > TILE_CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return pending;
  };

  return {
    async elevations(points, signal): Promise<ElevationResult> {
      try {
        const heights = await Promise.all(
          points.map(async (point) => {
            // Bilinear between the four nearest pixels, so the profile is smooth
            // rather than stepped at pixel edges.
            const { px, py } = pixelOf(point);
            const x0 = Math.floor(px - 0.5);
            const y0 = Math.floor(py - 0.5);
            const fx = px - 0.5 - x0;
            const fy = py - 0.5 - y0;
            const sample = async (gx: number, gy: number): Promise<number> => {
              const decoded = await tile(Math.floor(gx / 256), Math.floor(gy / 256), signal);
              return heightAt(decoded, ((gx % 256) + 256) % 256, ((gy % 256) + 256) % 256);
            };
            const [a, b, c, d] = await Promise.all([
              sample(x0, y0),
              sample(x0 + 1, y0),
              sample(x0, y0 + 1),
              sample(x0 + 1, y0 + 1),
            ]);
            return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
          }),
        );
        return { availability: "available", elevationsMeters: heights.map((h) => Math.round(h * 10) / 10) };
      } catch {
        return { availability: "unavailable", reason: "Elevation data is not available right now." };
      }
    },
  };
}
