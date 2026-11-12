/**
 * Where a kept ride lives on the device (R3-7).
 *
 * - Tiles: Cache Storage (`ogv-ride-tiles`), keyed by their own URL. The page
 *   reads them back through a MapLibre protocol (`offline-basemap.ts`), so the
 *   map draws them with or without a service worker in control; the shell's
 *   service worker never touches this cache.
 * - The ride's data: its own small IndexedDB database, like offline regions,
 *   so it can be dropped without touching the rider's library.
 */

import Dexie, { type Table } from "dexie";

import {
  RideTileError,
  type RidePackRecord,
  type RidePackStorePort,
  type RideTileStorePort,
} from "@/application/offline/ride-pack";

import { BASEMAP_ASSET_CACHE, BASEMAP_ASSET_PATHS } from "./basemap-archive-store";
import { hasSpaceFor, isQuotaExceeded } from "./storage-quota";

export const RIDE_TILE_CACHE = "ogv-ride-tiles";
export const RIDE_PACK_DB_NAME = "ogv-ride-packs";

class RidePackDatabase extends Dexie {
  packs!: Table<RidePackRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ packs: "rideId" });
  }
}

export function createIndexedDbRidePackStore(name = RIDE_PACK_DB_NAME): RidePackStorePort {
  let db: RidePackDatabase | null = null;
  const open = (): RidePackDatabase => (db ??= new RidePackDatabase(name));
  return {
    async get(rideId) { return (await open().packs.get(rideId)) ?? null; },
    async put(record) { await open().packs.put(record); },
    async delete(rideId) { await open().packs.delete(rideId); },
    async list() { return open().packs.toArray(); },
  };
}

export async function deleteRidePackDatabase(name = RIDE_PACK_DB_NAME): Promise<void> {
  await Dexie.delete(name);
  if (typeof caches !== "undefined") await caches.delete(RIDE_TILE_CACHE);
}

function cacheStorage(): CacheStorage {
  if (typeof caches === "undefined") throw new RideTileError("network", "This browser cannot keep a map.");
  return caches;
}

export function createCacheRideTileStore(options: { readonly fetcher?: typeof fetch } = {}): RideTileStorePort {
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const open = () => cacheStorage().open(RIDE_TILE_CACHE);
  return {
    async fetchAndKeep(path, signal) {
      let response: Response;
      try {
        response = await fetcher(path, { cache: "no-store", ...(signal === undefined ? {} : { signal }) });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new RideTileError("network", "A map tile did not download.");
      }
      if (response.status === 404) throw new RideTileError("not-covered", "The no-signal map does not reach here.");
      if (!response.ok) throw new RideTileError("network", "A map tile did not download.");
      const bytes = await response.arrayBuffer();
      try {
        await (await open()).put(path, new Response(bytes, {
          headers: { "content-type": "application/x-protobuf", "x-og-kept-at": new Date().toISOString() },
        }));
      } catch (error) {
        if (isQuotaExceeded(error)) throw new RideTileError("quota", "Storage is full.");
        throw error;
      }
      return bytes.byteLength;
    },
    async missing(paths) {
      if (typeof caches === "undefined") return [...paths];
      const cache = await open();
      const keys = new Set((await cache.keys()).map((request) => new URL(request.url).pathname));
      return paths.filter((path) => !keys.has(new URL(path, "http://og.local").pathname));
    },
    async remove(paths) {
      if (typeof caches === "undefined" || paths.length === 0) return;
      const cache = await open();
      await Promise.all(paths.map((path) => cache.delete(path)));
    },
    async sizeOf(path) {
      const hit = await (await open()).match(path);
      return hit === undefined ? 0 : (await hit.arrayBuffer()).byteLength;
    },
    async keepMapAssets() {
      const cache = await cacheStorage().open(BASEMAP_ASSET_CACHE);
      await Promise.all(BASEMAP_ASSET_PATHS.map(async (path) => {
        if ((await cache.match(path)) !== undefined) return;
        const response = await fetcher(path);
        if (!response.ok) throw new RideTileError("network", "The map's labels did not download.");
        await cache.put(path, response);
      }));
    },
    async hasMapAssets() {
      if (typeof caches === "undefined") return false;
      const cache = await caches.open(BASEMAP_ASSET_CACHE);
      const hits = await Promise.all(BASEMAP_ASSET_PATHS.map((path) => cache.match(path)));
      return hits.every((hit) => hit !== undefined);
    },
  };
}

/** Asks the browser to keep this origin's data, then whether the bytes fit. */
export function rideHasSpaceFor(bytes: number): Promise<boolean> {
  return hasSpaceFor(bytes, { requestPersistence: true });
}

/** A kept tile's bytes, or `null` when it was never kept. */
export async function readKeptTile(path: string): Promise<ArrayBuffer | null> {
  if (typeof caches === "undefined") return null;
  const hit = await (await caches.open(RIDE_TILE_CACHE)).match(path);
  return hit === undefined ? null : hit.arrayBuffer();
}

/** Whether any ride's tiles are on this device at all. */
export async function hasKeptTiles(): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  try {
    if (!(await caches.has(RIDE_TILE_CACHE))) return false;
    return (await (await caches.open(RIDE_TILE_CACHE)).keys()).length > 0;
  } catch {
    return false;
  }
}
