/**
 * Downloaded offline road-graph regions in IndexedDB (ported from SwitchBack
 * `src/lib/storage/region-download-client.ts`).
 *
 * Tiles are stored per region version and verified by size and sha256 before
 * they are kept. A download resumes by skipping tiles already verified, and
 * a new version becomes active only after every tile is in; the version
 * before it is kept until the next update, then removed.
 *
 * Its own database, so a region download never takes part in the ride
 * schema's migrations. The database opens in the page and in the routing
 * worker alike.
 */

import Dexie, { type Table } from "dexie";

import {
  boundsIntersect,
  isOfflineGraphTile,
  isOfflineRegionManifest,
  type OfflineBounds,
  type OfflineGraphTile,
  type OfflineRegionManifest,
} from "@/domain/offline/graph-tile";
import type {
  InstalledOfflineRegion,
  OfflineDownloadProgress,
  OfflineRegionOffer,
  OfflineRegionsPort,
} from "@/application/offline/offline-regions";

export const OFFLINE_REGION_DB_NAME = "ogv-offline-regions";

interface RegionPointer extends InstalledOfflineRegion {
  readonly previousVersion: string | null;
}

interface StoredVersion {
  readonly id: string;
  readonly regionId: string;
  readonly version: string;
  readonly manifest: OfflineRegionManifest;
}

interface StoredTile {
  readonly id: string;
  readonly regionId: string;
  readonly versionKey: string;
  readonly tileId: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly bytes: Uint8Array;
}

function summaryOf(pointer: RegionPointer): InstalledOfflineRegion {
  return {
    regionId: pointer.regionId,
    regionName: pointer.regionName,
    version: pointer.version,
    bounds: pointer.bounds,
    byteSize: pointer.byteSize,
    sourceDataDate: pointer.sourceDataDate,
    downloadedAt: pointer.downloadedAt,
  };
}

export class OfflineRegionError extends Error {
  constructor(
    readonly code: "manifest" | "tile" | "integrity" | "quota" | "missing",
    message: string,
  ) {
    super(message);
    this.name = "OfflineRegionError";
  }
}

const versionKey = (regionId: string, version: string) => `${regionId}:${version}`;
const tileKey = (regionId: string, version: string, tileId: string) => `${versionKey(regionId, version)}:${tileId}`;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

async function gunzipJson(bytes: Uint8Array): Promise<unknown> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const stream = new Response(copy.buffer).body?.pipeThrough(new DecompressionStream("gzip"));
  if (stream === undefined) throw new OfflineRegionError("integrity", "An offline tile could not be read.");
  return JSON.parse(await new Response(stream).text()) as unknown;
}

const MAX_RATE_LIMIT_WAITS = 5;

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export interface RegionDownloadStoreOptions {
  readonly name?: string;
  readonly fetcher?: typeof fetch;
  /** Where `/api/offline/regions` lives; same origin by default. */
  readonly basePath?: string;
  readonly now?: () => Date;
  /** Scales rate-limit waits; tests pass 0. */
  readonly waitScale?: number;
}

export class RegionDownloadStore implements OfflineRegionsPort {
  private readonly db: Dexie;
  private readonly regions: Table<RegionPointer, string>;
  private readonly versions: Table<StoredVersion, string>;
  private readonly tiles: Table<StoredTile, string>;
  private readonly fetcher: typeof fetch;
  private readonly basePath: string;
  private readonly now: () => Date;
  private readonly waitScale: number;

  constructor(options: RegionDownloadStoreOptions = {}) {
    this.db = new Dexie(options.name ?? OFFLINE_REGION_DB_NAME);
    this.db.version(1).stores({
      regions: "&regionId, downloadedAt",
      versions: "&id, regionId",
      tiles: "&id, regionId, versionKey",
    });
    this.regions = this.db.table("regions");
    this.versions = this.db.table("versions");
    this.tiles = this.db.table("tiles");
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.basePath = options.basePath ?? "/api/offline/regions";
    this.now = options.now ?? (() => new Date());
    this.waitScale = options.waitScale ?? 1;
  }

  private manifestUrl(regionId: string): string {
    return `${this.basePath}/${encodeURIComponent(regionId)}/manifest`;
  }

  private tileUrl(regionId: string, tileId: string): string {
    return `${this.basePath}/${encodeURIComponent(regionId)}/tiles/${encodeURIComponent(tileId)}`;
  }

  async offers(): Promise<OfflineRegionOffer[]> {
    const response = await this.fetcher(this.basePath, { headers: { accept: "application/json" } });
    if (!response.ok) throw new OfflineRegionError("manifest", `The area list could not be loaded (${response.status}).`);
    const body = (await response.json()) as { regions?: unknown };
    return Array.isArray(body.regions) ? (body.regions as OfflineRegionOffer[]) : [];
  }

  installed(): Promise<InstalledOfflineRegion[]> {
    return this.list();
  }

  /** One tile, waiting out the server's rate limit a few times before giving up. */
  private async fetchTile(regionId: string, tileId: string, signal?: AbortSignal): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetcher(this.tileUrl(regionId, tileId), { ...(signal === undefined ? {} : { signal }) });
      if (response.status !== 429 || attempt >= MAX_RATE_LIMIT_WAITS) return response;
      const seconds = Math.min(60, Math.max(1, Number(response.headers.get("retry-after")) || 5));
      await wait(seconds * 1000 * this.waitScale, signal);
    }
  }

  private async verifiedBytes(manifest: OfflineRegionManifest): Promise<number> {
    let stored = 0;
    for (const entry of manifest.tiles) {
      const existing = await this.tiles.get(tileKey(manifest.regionId, manifest.version, entry.tileId));
      if (existing?.sha256 === entry.sha256 && existing.byteSize === entry.bytes) stored += entry.bytes;
    }
    return stored;
  }

  private async checkQuota(requiredBytes: number): Promise<void> {
    // An offline area is only useful if the browser keeps it; ask once, and a
    // refusal still leaves the download usable until storage runs short.
    await globalThis.navigator?.storage?.persist?.().catch(() => false);
    const estimate = await globalThis.navigator?.storage?.estimate?.();
    if (estimate?.quota === undefined) return;
    if (estimate.quota - (estimate.usage ?? 0) < requiredBytes) {
      throw new OfflineRegionError("quota", "There is not enough free storage on this device for that area.");
    }
  }

  /**
   * Downloads (or resumes, or updates) one region. Abort the signal to pause:
   * verified tiles stay, and the next call only fetches the rest.
   */
  async download(
    regionId: string,
    onProgress: (progress: OfflineDownloadProgress) => void,
    signal?: AbortSignal,
  ): Promise<InstalledOfflineRegion> {
    const response = await this.fetcher(this.manifestUrl(regionId), {
      headers: { accept: "application/json" },
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) throw new OfflineRegionError("manifest", `The area list could not be loaded (${response.status}).`);
    const manifest: unknown = await response.json();
    if (!isOfflineRegionManifest(manifest) || manifest.regionId !== regionId) {
      throw new OfflineRegionError("manifest", "The downloaded area description is not valid.");
    }
    const totalBytes = manifest.tileByteTotal;
    let completedBytes = await this.verifiedBytes(manifest);
    await this.checkQuota(totalBytes - completedBytes);

    const key = versionKey(regionId, manifest.version);
    await this.versions.put({ id: key, regionId, version: manifest.version, manifest });
    onProgress({ completedBytes, totalBytes });

    for (const entry of manifest.tiles) {
      signal?.throwIfAborted();
      const id = tileKey(regionId, manifest.version, entry.tileId);
      const existing = await this.tiles.get(id);
      if (existing?.sha256 === entry.sha256 && existing.byteSize === entry.bytes) continue;
      const tileResponse = await this.fetchTile(regionId, entry.tileId, signal);
      if (!tileResponse.ok) throw new OfflineRegionError("tile", `Part of the area failed to download (${tileResponse.status}).`);
      const bytes = new Uint8Array(await tileResponse.arrayBuffer());
      if (bytes.byteLength !== entry.bytes || (await sha256Hex(bytes)) !== entry.sha256.toLowerCase()) {
        throw new OfflineRegionError("integrity", "Part of the area arrived damaged; download it again.");
      }
      await this.tiles.put({ id, regionId, versionKey: key, tileId: entry.tileId, sha256: entry.sha256, byteSize: entry.bytes, bytes });
      completedBytes += entry.bytes;
      onProgress({ completedBytes, totalBytes });
    }

    const installed: RegionPointer = {
      regionId,
      regionName: manifest.regionName,
      version: manifest.version,
      bounds: manifest.bounds,
      byteSize: totalBytes,
      sourceDataDate: manifest.sourceDataDate,
      downloadedAt: this.now().toISOString(),
      previousVersion: null,
    };
    await this.db.transaction("rw", this.regions, this.versions, this.tiles, async () => {
      const current = await this.regions.get(regionId);
      // Keep one previous version at most: the one being replaced now.
      if (current?.previousVersion && current.previousVersion !== manifest.version) {
        const obsolete = versionKey(regionId, current.previousVersion);
        await this.tiles.where("versionKey").equals(obsolete).delete();
        await this.versions.delete(obsolete);
      }
      const previous = current && current.version !== manifest.version ? current.version : (current?.previousVersion ?? null);
      await this.regions.put({ ...installed, previousVersion: previous === manifest.version ? null : previous });
    });
    return summaryOf(installed);
  }

  async list(): Promise<InstalledOfflineRegion[]> {
    const pointers = await this.regions.orderBy("downloadedAt").reverse().toArray();
    return pointers.map(summaryOf);
  }

  async remove(regionId: string): Promise<void> {
    await this.db.transaction("rw", this.regions, this.versions, this.tiles, async () => {
      await this.tiles.where("regionId").equals(regionId).delete();
      await this.versions.where("regionId").equals(regionId).delete();
      await this.regions.delete(regionId);
    });
  }

  /** Bytes held on the device, finished or partial. */
  async storedBytes(): Promise<number> {
    let total = 0;
    await this.tiles.each((tile) => {
      total += tile.byteSize;
    });
    return total;
  }

  /**
   * The installed graph tiles that intersect `area`, from every active region,
   * each re-verified against its manifest before it is parsed.
   */
  async tilesFor(area: OfflineBounds): Promise<OfflineGraphTile[]> {
    const result: OfflineGraphTile[] = [];
    for (const region of await this.regions.toArray()) {
      if (!boundsIntersect(region.bounds, area)) continue;
      const stored = await this.versions.get(versionKey(region.regionId, region.version));
      if (stored === undefined) throw new OfflineRegionError("missing", `${region.regionName} is incomplete; download it again.`);
      for (const entry of stored.manifest.tiles) {
        if (!boundsIntersect(entry.bounds, area)) continue;
        const tile = await this.tiles.get(tileKey(region.regionId, region.version, entry.tileId));
        if (tile === undefined || tile.sha256 !== entry.sha256 || tile.byteSize !== entry.bytes) {
          throw new OfflineRegionError("missing", `${region.regionName} is incomplete; download it again.`);
        }
        const parsed = await gunzipJson(tile.bytes);
        if (!isOfflineGraphTile(parsed)) throw new OfflineRegionError("integrity", `${region.regionName} has a damaged part.`);
        result.push(parsed);
      }
    }
    return result;
  }

  close(): void {
    this.db.close();
  }
}

export async function deleteOfflineRegionDatabase(name = OFFLINE_REGION_DB_NAME): Promise<void> {
  await Dexie.delete(name);
}
