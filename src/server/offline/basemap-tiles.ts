/**
 * One map tile at a time from our own basemap archives (R3-7, "Keep for no
 * signal").
 *
 * A kept ride stores only the tiles along its line, so the phone asks for them
 * one by one (`/api/offline/tiles/{z}/{x}/{y}`) and this reads each from the
 * Protomaps archives under `OGV_BASEMAP_ROOT` by byte range. These archives are
 * ours to hand out and to keep; the Mapbox style the online map draws is never
 * served or cached here.
 *
 * Three answers, kept apart:
 * - 200 with the tile's bytes (an empty body where the archive has no data,
 *   for example open water: that tile is genuinely blank);
 * - 404 `OFFLINE_TILE_NOT_COVERED` when no archive reaches this tile, so a ride
 *   outside our map is refused rather than kept with holes in it;
 * - 400 for a tile address that does not exist.
 */

import { open, readdir, stat, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

import { PMTiles, type Header, type Source } from "pmtiles";

import { createRateLimiter, type RateLimiter } from "@/server/rate-limit";

import { basemapRoot } from "./basemap-files";

export interface BasemapTileDeps {
  readonly limiter: RateLimiter;
  readonly root: string;
}

// A 60 mi loop is about 150 tiles; a rider keeping a few rides in a minute fits.
const tileLimiter = createRateLimiter({ windowMs: 60_000, max: 1_500 });

function defaults(): BasemapTileDeps {
  return { limiter: tileLimiter, root: basemapRoot() };
}

interface OpenArchive {
  readonly path: string;
  readonly stamp: string;
  readonly archive: PMTiles;
  readonly header: Header;
  readonly handle: FileHandle;
}

function fileSource(path: string, handle: FileHandle): Source {
  return {
    getKey: () => path,
    getBytes: async (offset, length) => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return { data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + bytesRead) as ArrayBuffer };
    },
  };
}

const opened = new Map<string, OpenArchive>();

/** Every archive in the root, reopened when a file is replaced. */
async function archives(root: string): Promise<readonly OpenArchive[]> {
  let names: string[];
  try {
    names = (await readdir(root)).filter((name) => name.endsWith(".pmtiles")).sort();
  } catch {
    return [];
  }
  const result: OpenArchive[] = [];
  for (const name of names) {
    const path = join(root, name);
    try {
      const info = await stat(path);
      const stamp = `${info.size}-${info.mtimeMs}`;
      let entry = opened.get(path);
      if (entry === undefined || entry.stamp !== stamp) {
        await entry?.handle.close().catch(() => undefined);
        const handle = await open(path, "r");
        const archive = new PMTiles(fileSource(path, handle));
        entry = { path, stamp, archive, header: await archive.getHeader(), handle };
        opened.set(path, entry);
      }
      result.push(entry);
    } catch {
      // An unreadable archive covers nothing.
    }
  }
  return result;
}

function tileBounds(z: number, x: number, y: number): { minLon: number; minLat: number; maxLon: number; maxLat: number } {
  const n = 2 ** z;
  const lon = (tx: number) => (tx / n) * 360 - 180;
  const lat = (ty: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
  return { minLon: lon(x), maxLon: lon(x + 1), minLat: lat(y + 1), maxLat: lat(y) };
}

function covers(header: Header, z: number, x: number, y: number): boolean {
  if (z < header.minZoom || z > header.maxZoom) return false;
  const tile = tileBounds(z, x, y);
  return tile.minLon < header.maxLon && tile.maxLon > header.minLon && tile.minLat < header.maxLat && tile.maxLat > header.minLat;
}

function parseIndex(value: string): number | null {
  if (!/^\d{1,7}$/.test(value)) return null;
  return Number(value);
}

function json(status: number, code: string, message: string, headers: Record<string, string> = {}): Response {
  return Response.json({ error: { code, message } }, { status, headers });
}

export async function handleBasemapTile(
  request: Request,
  params: { readonly z: string; readonly x: string; readonly y: string },
  deps: BasemapTileDeps = defaults(),
): Promise<Response> {
  const retry = deps.limiter.check(request);
  if (retry !== null) {
    return json(429, "OFFLINE_RATE_LIMITED", "Too many map tile requests; try again shortly.", { "retry-after": String(retry) });
  }
  const z = parseIndex(params.z);
  const x = parseIndex(params.x);
  const y = parseIndex(params.y);
  if (z === null || x === null || y === null || z > 22 || x >= 2 ** z || y >= 2 ** z) {
    return json(400, "OFFLINE_INVALID_REQUEST", "That is not a map tile.");
  }
  const covering = (await archives(deps.root)).filter((entry) => covers(entry.header, z, x, y));
  if (covering.length === 0) {
    return json(404, "OFFLINE_TILE_NOT_COVERED", "The no-signal map does not reach here yet.");
  }
  try {
    for (const entry of covering) {
      const tile = await entry.archive.getZxy(z, x, y);
      if (tile !== undefined && tile.data.byteLength > 0) {
        return new Response(request.method === "HEAD" ? null : tile.data, {
          headers: {
            "content-type": "application/x-protobuf",
            "content-length": String(tile.data.byteLength),
            "cache-control": "public, max-age=86400",
          },
        });
      }
    }
  } catch {
    return json(500, "OFFLINE_UNAVAILABLE", "Offline maps are unavailable");
  }
  // Inside an archive's reach with no data: a blank tile, not a missing one.
  return new Response(null, {
    headers: { "content-type": "application/x-protobuf", "content-length": "0", "cache-control": "public, max-age=86400", "x-og-tile": "empty" },
  });
}
