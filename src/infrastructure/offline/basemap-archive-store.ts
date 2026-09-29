/**
 * Downloaded basemap archives on the device (Lane A2).
 *
 * Each offline region's PMTiles archive is written to the origin-private file
 * system (OPFS), where the map reads it by byte range with no network at all.
 * A download streams straight to disk, resumes from what is already written
 * (an HTTP Range request pinned to the archive's ETag), and only counts as
 * installed once its size matches and its PMTiles header reads back.
 *
 * The glyphs and sprites the offline style needs go into Cache Storage with
 * the first archive, because a label is part of the map.
 */

import type { OfflineDownloadProgress } from "@/application/offline/offline-regions";

const DIRECTORY = "ogv-basemaps";
const MARKER_SUFFIX = ".json";
export const BASEMAP_ASSET_CACHE = "ogv-basemap-assets";

/** Every glyph range and sprite file the offline style can ask for. */
export const BASEMAP_ASSET_PATHS: readonly string[] = [
  ...["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"].flatMap((font) =>
    ["0-255", "256-511", "8192-8447"].map((range) => `/basemap-assets/fonts/${font}/${range}.pbf`),
  ),
  ...["light.json", "light.png", "light@2x.json", "light@2x.png"].map((file) => `/basemap-assets/sprites/${file}`),
];

interface ArchiveMarker {
  readonly regionId: string;
  readonly bytes: number;
  readonly etag: string;
  readonly complete: boolean;
}

export class BasemapArchiveError extends Error {
  constructor(
    readonly code: "unsupported" | "network" | "integrity",
    message: string,
  ) {
    super(message);
    this.name = "BasemapArchiveError";
  }
}

async function directory(): Promise<FileSystemDirectoryHandle> {
  const storage = globalThis.navigator?.storage;
  if (storage?.getDirectory === undefined) {
    throw new BasemapArchiveError("unsupported", "This browser cannot store an offline map.");
  }
  const root = await storage.getDirectory();
  return root.getDirectoryHandle(DIRECTORY, { create: true });
}

async function readMarker(dir: FileSystemDirectoryHandle, regionId: string): Promise<ArchiveMarker | null> {
  try {
    const file = await (await dir.getFileHandle(`${regionId}${MARKER_SUFFIX}`)).getFile();
    return JSON.parse(await file.text()) as ArchiveMarker;
  } catch {
    return null;
  }
}

async function writeMarker(dir: FileSystemDirectoryHandle, marker: ArchiveMarker): Promise<void> {
  const writable = await (await dir.getFileHandle(`${marker.regionId}${MARKER_SUFFIX}`, { create: true })).createWritable();
  await writable.write(JSON.stringify(marker));
  await writable.close();
}

/** A PMTiles v3 archive starts with the magic "PMTiles" and version byte 3. */
async function looksLikePmtiles(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  return new TextDecoder().decode(head.subarray(0, 7)) === "PMTiles" && head[7] === 3;
}

export interface BasemapArchiveStoreOptions {
  readonly fetcher?: typeof fetch;
  readonly basePath?: string;
}

export class BasemapArchiveStore {
  private readonly fetcher: typeof fetch;
  private readonly basePath: string;

  constructor(options: BasemapArchiveStoreOptions = {}) {
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.basePath = options.basePath ?? "/api/offline/regions";
  }

  static supported(): boolean {
    return typeof globalThis.navigator?.storage?.getDirectory === "function";
  }

  private url(regionId: string): string {
    return `${this.basePath}/${encodeURIComponent(regionId)}/basemap`;
  }

  /** Installed archives, as files the map can read. */
  async installed(): Promise<{ readonly regionId: string; readonly file: File }[]> {
    if (!BasemapArchiveStore.supported()) return [];
    const dir = await directory();
    const result: { regionId: string; file: File }[] = [];
    for await (const [name, handle] of dir.entries()) {
      if (!name.endsWith(MARKER_SUFFIX) || handle.kind !== "file") continue;
      const marker = await readMarker(dir, name.slice(0, -MARKER_SUFFIX.length));
      if (marker === null || !marker.complete) continue;
      try {
        const file = await (await dir.getFileHandle(`${marker.regionId}.pmtiles`)).getFile();
        if (file.size === marker.bytes) result.push({ regionId: marker.regionId, file });
      } catch {
        // A marker without its archive is not an installed map.
      }
    }
    return result;
  }

  /** Bytes on the device, finished or partial. */
  async storedBytes(): Promise<number> {
    if (!BasemapArchiveStore.supported()) return 0;
    const dir = await directory();
    let total = 0;
    for await (const [name, handle] of dir.entries()) {
      if (name.endsWith(".pmtiles") && handle.kind === "file") total += (await (handle as FileSystemFileHandle).getFile()).size;
    }
    return total;
  }

  /**
   * Downloads (or resumes) one region's archive. Abort to pause; the bytes
   * written so far stay and the next call continues from them, unless the
   * archive changed on the server meanwhile.
   */
  async download(
    regionId: string,
    onProgress: (progress: OfflineDownloadProgress) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const dir = await directory();
    const previous = await readMarker(dir, regionId);
    const handle = await dir.getFileHandle(`${regionId}.pmtiles`, { create: true });
    const existing = await handle.getFile();
    const resumeFrom = previous !== null && !previous.complete && existing.size > 0 ? existing.size : 0;

    const headers: Record<string, string> = {};
    if (resumeFrom > 0 && previous !== null) {
      headers.range = `bytes=${resumeFrom}-`;
      headers["if-range"] = previous.etag;
    }
    let response: Response;
    try {
      response = await this.fetcher(this.url(regionId), { headers, ...(signal === undefined ? {} : { signal }) });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new BasemapArchiveError("network", "The offline map could not be downloaded.");
    }
    if (!response.ok || response.body === null) {
      throw new BasemapArchiveError("network", `The offline map could not be downloaded (${response.status}).`);
    }
    const resumed = response.status === 206;
    const etag = response.headers.get("etag") ?? "";
    const offset = resumed ? resumeFrom : 0;
    const totalBytes = resumed
      ? Number(response.headers.get("content-range")?.split("/")[1] ?? Number.NaN)
      : Number(response.headers.get("content-length") ?? Number.NaN);
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
      throw new BasemapArchiveError("integrity", "The offline map's size is unknown.");
    }
    await writeMarker(dir, { regionId, bytes: totalBytes, etag, complete: false });

    const writable = await handle.createWritable({ keepExistingData: resumed });
    if (resumed) await writable.seek(offset);
    else await writable.truncate(0);
    let written = offset;
    onProgress({ completedBytes: written, totalBytes });
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await writable.write(value);
        written += value.byteLength;
        onProgress({ completedBytes: written, totalBytes });
      }
      await writable.close();
    } catch (error) {
      // Keep what was written: closing commits it, and the next call resumes.
      await writable.close().catch(() => undefined);
      if (signal?.aborted) throw signal.reason ?? error;
      throw new BasemapArchiveError("network", "The offline map download stopped; try again to resume it.");
    }

    const file = await handle.getFile();
    if (file.size !== totalBytes || !(await looksLikePmtiles(file))) {
      await dir.removeEntry(`${regionId}.pmtiles`).catch(() => undefined);
      await dir.removeEntry(`${regionId}${MARKER_SUFFIX}`).catch(() => undefined);
      throw new BasemapArchiveError("integrity", "The offline map arrived damaged; download it again.");
    }
    await this.cacheAssets();
    await writeMarker(dir, { regionId, bytes: totalBytes, etag, complete: true });
  }

  /** Stores the style's glyphs and sprites, so labels draw with no signal. */
  async cacheAssets(): Promise<void> {
    if (typeof caches === "undefined") return;
    const cache = await caches.open(BASEMAP_ASSET_CACHE);
    await Promise.all(
      BASEMAP_ASSET_PATHS.map(async (path) => {
        if ((await cache.match(path)) !== undefined) return;
        const response = await this.fetcher(path);
        if (response.ok) await cache.put(path, response);
      }),
    );
  }

  async remove(regionId: string): Promise<void> {
    if (!BasemapArchiveStore.supported()) return;
    const dir = await directory();
    await dir.removeEntry(`${regionId}.pmtiles`).catch(() => undefined);
    await dir.removeEntry(`${regionId}${MARKER_SUFFIX}`).catch(() => undefined);
  }

  /** Removes every archive and the cached assets. */
  static async clear(): Promise<void> {
    if (BasemapArchiveStore.supported()) {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(DIRECTORY, { recursive: true }).catch(() => undefined);
    }
    if (typeof caches !== "undefined") await caches.delete(BASEMAP_ASSET_CACHE);
  }
}
