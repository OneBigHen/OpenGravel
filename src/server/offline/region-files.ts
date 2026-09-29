/**
 * Reads the published offline road-graph regions from disk (ported from
 * SwitchBack `src/lib/server/offline-region-files.ts`).
 *
 * Layout: `<root>/<regionId>/active.json {version}` points at
 * `<root>/<regionId>/<version>/manifest.json` and `tiles/<tileId>.json.gz`.
 * The root is `OGV_OFFLINE_REGION_ROOT`, else `data/offline-regions`.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  isOfflineRegionManifest,
  type OfflineBounds,
  type OfflineRegionManifest,
} from "@/domain/offline/graph-tile";

const REGION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const TILE_ID = /^[a-z0-9][a-z0-9_-]*$/;

export class OfflineRegionFileError extends Error {
  constructor(
    readonly status: 400 | 404 | 500,
    message: string,
  ) {
    super(message);
  }
}

/** What the region picker needs, without the full tile inventory. */
export interface OfflineRegionSummary {
  readonly regionId: string;
  readonly regionName: string;
  readonly version: string;
  readonly bounds: OfflineBounds;
  readonly tileCount: number;
  readonly tileByteTotal: number;
  readonly sourceDataDate: string;
}

export function offlineRegionRoot(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env.OGV_OFFLINE_REGION_ROOT || join(process.cwd(), "data", "offline-regions");
}

export function isSafeRegionId(value: string): boolean {
  return REGION_ID.test(value);
}

export function isSafeTileId(value: string): boolean {
  return TILE_ID.test(value);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

export async function readActiveManifest(regionId: string, root = offlineRegionRoot()): Promise<OfflineRegionManifest> {
  if (!isSafeRegionId(regionId)) throw new OfflineRegionFileError(400, "Invalid region identifier");
  try {
    const active = JSON.parse(await readFile(join(root, regionId, "active.json"), "utf8")) as { version?: unknown };
    if (typeof active.version !== "string" || !VERSION_ID.test(active.version)) {
      throw new OfflineRegionFileError(500, "Offline region activation metadata is invalid");
    }
    const raw: unknown = JSON.parse(await readFile(join(root, regionId, active.version, "manifest.json"), "utf8"));
    if (!isOfflineRegionManifest(raw)) throw new OfflineRegionFileError(500, "Offline region manifest is corrupt");
    if (raw.regionId !== regionId || raw.version !== active.version) {
      throw new OfflineRegionFileError(500, "Offline region activation does not match its manifest");
    }
    return raw;
  } catch (error) {
    if (error instanceof OfflineRegionFileError) throw error;
    if (isMissing(error)) throw new OfflineRegionFileError(404, "Offline region is not available");
    throw new OfflineRegionFileError(500, "Offline region metadata could not be read");
  }
}

export async function readManifestTile(
  manifest: OfflineRegionManifest,
  tileId: string,
  root = offlineRegionRoot(),
): Promise<{ bytes: Uint8Array; sha256: string }> {
  if (!isSafeTileId(tileId)) throw new OfflineRegionFileError(400, "Invalid tile identifier");
  const entry = manifest.tiles.find((tile) => tile.tileId === tileId);
  if (!entry) throw new OfflineRegionFileError(404, "Offline tile was not found");
  try {
    const bytes = await readFile(join(root, manifest.regionId, manifest.version, "tiles", `${tileId}.json.gz`));
    if (bytes.byteLength !== entry.bytes) {
      throw new OfflineRegionFileError(500, "Offline tile size does not match its manifest");
    }
    return { bytes, sha256: entry.sha256 };
  } catch (error) {
    if (error instanceof OfflineRegionFileError) throw error;
    if (isMissing(error)) throw new OfflineRegionFileError(404, "Offline tile was not found");
    throw new OfflineRegionFileError(500, "Offline tile could not be read");
  }
}

/** Every region with a valid active manifest; broken ones are skipped, not fatal. */
export async function listRegions(root = offlineRegionRoot()): Promise<OfflineRegionSummary[]> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const summaries: OfflineRegionSummary[] = [];
  for (const name of names.filter(isSafeRegionId).sort()) {
    try {
      const manifest = await readActiveManifest(name, root);
      summaries.push({
        regionId: manifest.regionId,
        regionName: manifest.regionName,
        version: manifest.version,
        bounds: manifest.bounds,
        tileCount: manifest.tiles.length,
        tileByteTotal: manifest.tileByteTotal,
        sourceDataDate: manifest.sourceDataDate,
      });
    } catch {
      // A half-published region is invisible until its active.json is valid.
    }
  }
  return summaries;
}
