/**
 * Our own basemap archives (Lane A2): one PMTiles file per offline region,
 * extracted from the Protomaps OpenStreetMap build, under
 * `OGV_BASEMAP_ROOT` (default `data/basemap`) as `<regionId>.pmtiles`.
 *
 * Archives are hundreds of megabytes, so they are streamed by byte range and
 * never read whole into memory.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";

import { isSafeRegionId } from "./region-files";

export function basemapRoot(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env.OGV_BASEMAP_ROOT || join(process.cwd(), "data", "basemap");
}

export interface BasemapArchive {
  readonly path: string;
  readonly bytes: number;
  /** Size plus modification time: changes whenever the archive is replaced. */
  readonly etag: string;
}

/** The archive for a region, or `null` when it has none. */
export async function findBasemapArchive(regionId: string, root = basemapRoot()): Promise<BasemapArchive | null> {
  if (!isSafeRegionId(regionId)) return null;
  const path = join(root, `${regionId}.pmtiles`);
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) return null;
    return { path, bytes: info.size, etag: `"pm-${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"` };
  } catch {
    return null;
  }
}

export function streamArchive(archive: BasemapArchive, start: number, end: number): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(archive.path, { start, end })) as ReadableStream<Uint8Array>;
}
