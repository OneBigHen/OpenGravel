/**
 * HTTP handlers for offline road-graph downloads: the region list, one
 * region's manifest (revalidated with an ETag) and its gzip tiles (immutable,
 * resumable with a byte Range).
 */

import { createHash } from "node:crypto";

import { createRateLimiter, type RateLimiter } from "@/server/rate-limit";

import { basemapRoot, findBasemapArchive, streamArchive } from "./basemap-files";
import {
  listRegions,
  OfflineRegionFileError,
  offlineRegionRoot,
  readActiveManifest,
  readManifestTile,
} from "./region-files";

export interface OfflineHandlerDeps {
  readonly limiter: RateLimiter;
  readonly root: string;
  /** Where the regions' basemap archives live. */
  readonly basemapRoot?: string;
}

// A state is a few hundred tiles, fetched once per download; the budget fits a
// whole state in a minute and still stops scraping.
const sharedLimiter = createRateLimiter({ windowMs: 60_000, max: 600 });

function defaults(): OfflineHandlerDeps {
  return { limiter: sharedLimiter, root: offlineRegionRoot(), basemapRoot: basemapRoot() };
}

function tooMany(seconds: number): Response {
  return Response.json(
    { error: { code: "OFFLINE_RATE_LIMITED", message: "Too many offline map requests; try again shortly." } },
    { status: 429, headers: { "retry-after": String(seconds) } },
  );
}

function failure(error: unknown): Response {
  const status = error instanceof OfflineRegionFileError ? error.status : 500;
  const message = error instanceof OfflineRegionFileError ? error.message : "Offline maps are unavailable";
  const code = status === 400 ? "OFFLINE_INVALID_REQUEST" : status === 404 ? "OFFLINE_NOT_FOUND" : "OFFLINE_UNAVAILABLE";
  return Response.json({ error: { code, message } }, { status });
}

export async function handleRegionList(request: Request, deps: OfflineHandlerDeps = defaults()): Promise<Response> {
  const retry = deps.limiter.check(request);
  if (retry !== null) return tooMany(retry);
  try {
    const regions = await Promise.all(
      (await listRegions(deps.root)).map(async (region) => {
        const archive = deps.basemapRoot === undefined ? null : await findBasemapArchive(region.regionId, deps.basemapRoot);
        return archive === null ? region : { ...region, basemapBytes: archive.bytes };
      }),
    );
    return Response.json({ regions }, { headers: { "cache-control": "no-cache" } });
  } catch (error) {
    return failure(error);
  }
}

export async function handleRegionManifest(
  request: Request,
  regionId: string,
  deps: OfflineHandlerDeps = defaults(),
): Promise<Response> {
  const retry = deps.limiter.check(request);
  if (retry !== null) return tooMany(retry);
  try {
    const body = JSON.stringify(await readActiveManifest(regionId, deps.root));
    const etag = `"sha256-${createHash("sha256").update(body).digest("hex")}"`;
    const headers = { "cache-control": "no-cache", "content-type": "application/json; charset=utf-8", etag };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(body, { headers });
  } catch (error) {
    return failure(error);
  }
}

type ByteRange = { readonly start: number; readonly end: number };

export function parseByteRange(value: string | null, size: number): ByteRange | null | "invalid" {
  if (!value) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(value);
  if (!match) return "invalid";
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return "invalid";
  return { start, end: Math.min(end, size - 1) };
}

function bodyOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function handleRegionTile(
  request: Request,
  regionId: string,
  tileId: string,
  deps: OfflineHandlerDeps = defaults(),
): Promise<Response> {
  const retry = deps.limiter.check(request);
  if (retry !== null) return tooMany(retry);
  const includeBody = request.method !== "HEAD";
  try {
    const manifest = await readActiveManifest(regionId, deps.root);
    const tile = await readManifestTile(manifest, tileId, deps.root);
    const size = tile.bytes.byteLength;
    const headers: Record<string, string> = {
      "accept-ranges": "bytes",
      "cache-control": "public, max-age=31536000, immutable",
      "content-type": "application/gzip",
      etag: `"sha256-${tile.sha256}"`,
    };
    if (request.headers.get("if-none-match") === headers.etag) return new Response(null, { status: 304, headers });
    const range = parseByteRange(request.headers.get("range"), size);
    if (range === "invalid") {
      return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
    }
    if (range) {
      const slice = tile.bytes.subarray(range.start, range.end + 1);
      return new Response(includeBody ? bodyOf(slice) : null, {
        status: 206,
        headers: {
          ...headers,
          "content-length": String(slice.byteLength),
          "content-range": `bytes ${range.start}-${range.end}/${size}`,
        },
      });
    }
    return new Response(includeBody ? bodyOf(tile.bytes) : null, {
      headers: { ...headers, "content-length": String(size) },
    });
  } catch (error) {
    return failure(error);
  }
}

/**
 * One region's basemap archive: whole, or by byte range (how MapLibre reads a
 * PMTiles archive online, and how a paused download resumes).
 */
export async function handleBasemapArchive(
  request: Request,
  regionId: string,
  deps: OfflineHandlerDeps = defaults(),
): Promise<Response> {
  const retry = deps.limiter.check(request);
  if (retry !== null) return tooMany(retry);
  const archive = deps.basemapRoot === undefined ? null : await findBasemapArchive(regionId, deps.basemapRoot);
  if (archive === null) {
    return Response.json({ error: { code: "OFFLINE_NOT_FOUND", message: "This area has no offline map." } }, { status: 404 });
  }
  const size = archive.bytes;
  const headers: Record<string, string> = {
    "accept-ranges": "bytes",
    // Revalidated by ETag: an archive is replaced in place when it is rebuilt.
    "cache-control": "no-cache",
    "content-type": "application/vnd.pmtiles",
    etag: archive.etag,
  };
  const range = parseByteRange(request.headers.get("range"), size);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
  }
  const ifRange = request.headers.get("if-range");
  const useRange = range !== null && (ifRange === null || ifRange === archive.etag);
  if (!useRange && request.headers.get("if-none-match") === archive.etag) return new Response(null, { status: 304, headers });
  const includeBody = request.method !== "HEAD";
  if (useRange && range !== null) {
    const length = range.end - range.start + 1;
    return new Response(includeBody ? streamArchive(archive, range.start, range.end) : null, {
      status: 206,
      headers: { ...headers, "content-length": String(length), "content-range": `bytes ${range.start}-${range.end}/${size}` },
    });
  }
  return new Response(includeBody ? streamArchive(archive, 0, size - 1) : null, {
    headers: { ...headers, "content-length": String(size) },
  });
}
