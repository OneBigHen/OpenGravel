/**
 * "Keep for no signal" (R3-7): one saved ride, kept on this device so its map,
 * line, turns and surface still work in airplane mode.
 *
 * What a kept ride is, and nothing more:
 *
 * - **Map tiles** for a corridor half a mile either side of the line, zooms 8
 *   to 14, from OpenGravel's own Protomaps basemap (`/api/offline/tiles`).
 *   Mapbox's style is never cached: its terms forbid bulk caching, so with no
 *   signal the map redraws on the Protomaps style (`offline-basemap.ts`).
 * - **The ride's data**: its line, turn instructions, measured surface runs and
 *   posted speed limits when the saved ride holds them, in IndexedDB.
 *
 * It is not a region, it plans nothing and it reroutes nothing: off the line
 * the ride screen shows the way back to it.
 *
 * Honesty rule: a ride is "kept" only when `rideIsKept` finds every one of its
 * tiles on the device, not because a flag says so. A keep that runs out of
 * storage or loses a tile says so and leaves the ride not kept.
 */

import type { Coordinate } from "@/domain/ride/types";
import type { RouteInstruction, SpeedLimitSpan } from "@/domain/route/types";
import type { SurfaceRunSpan } from "@/application/ride-session/surface-ahead";

export const RIDE_PACK_MIN_ZOOM = 8;
export const RIDE_PACK_MAX_ZOOM = 14;
/** Half a mile either side of the line: a one-mile-wide corridor. */
export const RIDE_PACK_HALF_WIDTH_METERS = 805;
/** A 60 mi loop is about 450 tiles; this refuses a cross-country trip. */
export const MAX_RIDE_PACK_TILES = 4_000;
/** Where the tiles are served and, as a cache key, where they are kept. */
export const RIDE_TILE_PATH = "/api/offline/tiles";

const EARTH_CIRCUMFERENCE_METERS = 40_075_016.686;
const MAX_MERCATOR_LAT = 85.05112878;

export interface RideTile {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

export interface RideCorridorOptions {
  readonly minZoom?: number;
  readonly maxZoom?: number;
  readonly halfWidthMeters?: number;
}

function tileX(lon: number, n: number): number {
  return ((Math.min(180, Math.max(-180, lon)) + 180) / 360) * n;
}

function tileY(lat: number, n: number): number {
  const radians = (Math.min(MAX_MERCATOR_LAT, Math.max(-MAX_MERCATOR_LAT, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * n;
}

/** The tile holding one point, at one zoom. */
export function tileAt(point: Coordinate, z: number): RideTile {
  const n = 2 ** z;
  return {
    z,
    x: Math.min(n - 1, Math.max(0, Math.floor(tileX(point.lon, n)))),
    y: Math.min(n - 1, Math.max(0, Math.floor(tileY(point.lat, n)))),
  };
}

export function tileKey(tile: RideTile): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

function validLine(line: readonly Coordinate[]): boolean {
  return line.length >= 2 && line.every((point) =>
    Number.isFinite(point.lon) && Number.isFinite(point.lat) &&
    point.lon >= -180 && point.lon <= 180 && point.lat >= -90 && point.lat <= 90);
}

/**
 * Every tile within `halfWidthMeters` of the line, zoom by zoom, sorted by
 * zoom, then x, then y, so the same line always gives the same list.
 *
 * The line is walked in tile units with steps no longer than a quarter tile
 * (or the corridor's own width, whichever is smaller), and each step adds the
 * square of tiles around it. The square is a little wider than the corridor
 * at its corners, never narrower, so no point of the line is left without
 * its tile.
 */
export function rideCorridorTiles(line: readonly Coordinate[], options: RideCorridorOptions = {}): readonly RideTile[] {
  if (!validLine(line)) return [];
  const minZoom = options.minZoom ?? RIDE_PACK_MIN_ZOOM;
  const maxZoom = options.maxZoom ?? RIDE_PACK_MAX_ZOOM;
  const halfWidth = Math.max(0, options.halfWidthMeters ?? RIDE_PACK_HALF_WIDTH_METERS);
  const tiles = new Map<string, RideTile>();
  for (let z = minZoom; z <= maxZoom; z += 1) {
    const n = 2 ** z;
    const add = (fx: number, fy: number, radius: number): void => {
      const x0 = Math.max(0, Math.floor(fx - radius));
      const x1 = Math.min(n - 1, Math.floor(fx + radius));
      const y0 = Math.max(0, Math.floor(fy - radius));
      const y1 = Math.min(n - 1, Math.floor(fy + radius));
      for (let x = x0; x <= x1; x += 1) {
        for (let y = y0; y <= y1; y += 1) {
          const tile = { z, x, y };
          tiles.set(tileKey(tile), tile);
        }
      }
    };
    for (let index = 0; index < line.length; index += 1) {
      const a = line[index]!;
      const b = line[index + 1];
      // The corridor in tile units at this latitude (a tile is narrower in
      // metres the further north it is).
      const tileMeters = (EARTH_CIRCUMFERENCE_METERS * Math.cos((a.lat * Math.PI) / 180)) / n;
      const radius = tileMeters > 0 ? halfWidth / tileMeters : 0;
      const ax = tileX(a.lon, n);
      const ay = tileY(a.lat, n);
      add(ax, ay, radius);
      if (b === undefined) continue;
      const bx = tileX(b.lon, n);
      const by = tileY(b.lat, n);
      const step = Math.max(1e-6, Math.min(0.25, radius > 0 ? radius : 0.25));
      const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / step);
      for (let s = 1; s < steps; s += 1) {
        const t = s / steps;
        add(ax + (bx - ax) * t, ay + (by - ay) * t, radius);
      }
    }
  }
  return [...tiles.values()].sort((p, q) => p.z - q.z || p.x - q.x || p.y - q.y);
}

/** The URL a tile is fetched from and kept under. */
export function rideTilePath(tile: RideTile, basePath = ""): string {
  return `${basePath}${RIDE_TILE_PATH}/${tile.z}/${tile.x}/${tile.y}`;
}

/**
 * A short fingerprint of a line, so the ride screen can tell whether the line
 * it is following is a kept one. Exact coordinates, rounded to about a metre.
 */
export function rideLineKey(line: readonly Coordinate[]): string {
  let hash = 0x811c9dc5;
  const mix = (value: number): void => {
    const text = String(Math.round(value * 1e5));
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 0x2c;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  for (const point of line) {
    mix(point.lon);
    mix(point.lat);
  }
  return `${line.length}-${hash.toString(36)}`;
}

/** What a saved ride gives the keep: its line and the facts that ride with it. */
export interface KeepSource {
  readonly rideId: string;
  readonly title: string;
  readonly line: readonly Coordinate[];
  readonly instructions?: readonly RouteInstruction[];
  readonly surfaceRuns?: readonly SurfaceRunSpan[];
  readonly speedLimits?: readonly SpeedLimitSpan[];
}

/** One kept ride on the device. */
export interface RidePackRecord {
  readonly version: 1;
  readonly rideId: string;
  readonly title: string;
  readonly keptAt: string;
  readonly lineKey: string;
  readonly line: readonly Coordinate[];
  readonly instructions?: readonly RouteInstruction[];
  readonly surfaceRuns?: readonly SurfaceRunSpan[];
  readonly speedLimits?: readonly SpeedLimitSpan[];
  /** The tile URLs this ride needs, as `rideTilePath` gives them. */
  readonly tiles: readonly string[];
  /** Bytes of map stored for this ride (tiles shared with another ride count for both). */
  readonly bytes: number;
}

export interface KeptRideSummary {
  readonly rideId: string;
  readonly title: string;
  readonly keptAt: string;
  readonly bytes: number;
}

/** The tiles' half: Cache Storage in the browser. */
export interface RideTileStorePort {
  /** Fetches one tile and keeps it; resolves to its stored bytes. */
  fetchAndKeep(path: string, signal?: AbortSignal): Promise<number>;
  /** The paths in `paths` that are not on the device. */
  missing(paths: readonly string[]): Promise<readonly string[]>;
  remove(paths: readonly string[]): Promise<void>;
  /** Stored bytes of one tile already on the device (0 when unknown). */
  sizeOf(path: string): Promise<number>;
  /** The glyphs and sprites the offline style needs, so labels draw too. */
  keepMapAssets(): Promise<void>;
  /** Whether those assets are all on the device. */
  hasMapAssets(): Promise<boolean>;
}

/** The data half: IndexedDB in the browser. */
export interface RidePackStorePort {
  get(rideId: string): Promise<RidePackRecord | null>;
  put(record: RidePackRecord): Promise<void>;
  delete(rideId: string): Promise<void>;
  list(): Promise<readonly RidePackRecord[]>;
}

export class RideTileError extends Error {
  constructor(
    readonly code: "not-covered" | "network" | "quota",
    message: string,
  ) {
    super(message);
    this.name = "RideTileError";
  }
}

export type KeepFailure = "no-line" | "too-long" | "not-covered" | "storage-full" | "network" | "cancelled";

export type KeepOutcome =
  | { readonly status: "kept"; readonly bytes: number; readonly tiles: number }
  | { readonly status: "failed"; readonly reason: KeepFailure; readonly message: string };

export interface KeepProgress {
  readonly done: number;
  readonly total: number;
  readonly bytes: number;
}

export const KEEP_MESSAGES: Readonly<Record<KeepFailure, string>> = {
  "no-line": "This ride has no saved line to keep.",
  "too-long": "This ride is too long to keep for no signal.",
  "not-covered": "The no-signal map does not reach every part of this ride yet.",
  "storage-full": "There is not enough storage on this phone to keep this ride.",
  network: "Part of the map did not download. Try again with signal.",
  cancelled: "Keeping this ride was stopped.",
};

export interface RidePackServiceDeps {
  /** The saved ride's line and facts, or `null` when it has none. */
  readonly loadRide: (rideId: string) => Promise<KeepSource | null>;
  readonly tiles: RideTileStorePort;
  readonly packs: RidePackStorePort;
  /** Whether the device can hold this many more bytes. */
  readonly hasSpaceFor?: (bytes: number) => Promise<boolean>;
  readonly now?: () => string;
  readonly basePath?: string;
  /** Downloads at once; a weak phone connection is not flooded. */
  readonly concurrency?: number;
}

/** A first guess at a tile's size, only to refuse a keep that cannot fit. */
const ESTIMATED_TILE_BYTES = 40_000;

export interface RidePackService {
  keepRide(rideId: string, options?: { readonly onProgress?: (progress: KeepProgress) => void; readonly signal?: AbortSignal }): Promise<KeepOutcome>;
  dropRide(rideId: string): Promise<void>;
  /** True only when the ride's data and every one of its tiles are on the device. */
  rideIsKept(rideId: string): Promise<boolean>;
  /** Kept rides that are complete, newest first. */
  keptRides(): Promise<readonly KeptRideSummary[]>;
  /** The complete kept ride following exactly this line, if any. */
  keptPackForLine(line: readonly Coordinate[]): Promise<RidePackRecord | null>;
}

export function createRidePackService(deps: RidePackServiceDeps): RidePackService {
  const now = deps.now ?? (() => new Date().toISOString());
  const basePath = deps.basePath ?? "";
  const concurrency = Math.max(1, deps.concurrency ?? 4);

  /** Tiles no other kept ride needs: safe to delete with this one. */
  async function unsharedTiles(rideId: string, paths: readonly string[]): Promise<readonly string[]> {
    const others = (await deps.packs.list()).filter((pack) => pack.rideId !== rideId);
    const shared = new Set(others.flatMap((pack) => pack.tiles));
    return paths.filter((path) => !shared.has(path));
  }

  async function complete(pack: RidePackRecord | null): Promise<boolean> {
    if (pack === null || pack.tiles.length === 0 || pack.line.length < 2) return false;
    if ((await deps.tiles.missing(pack.tiles)).length > 0) return false;
    return deps.tiles.hasMapAssets();
  }

  return {
    async keepRide(rideId, options = {}) {
      const failed = (reason: KeepFailure): KeepOutcome => ({ status: "failed", reason, message: KEEP_MESSAGES[reason] });
      const source = await deps.loadRide(rideId).catch(() => null);
      if (source === null || !validLine(source.line)) return failed("no-line");
      const tiles = rideCorridorTiles(source.line).map((tile) => rideTilePath(tile, basePath));
      if (tiles.length === 0) return failed("no-line");
      if (tiles.length > MAX_RIDE_PACK_TILES) return failed("too-long");
      const missing = await deps.tiles.missing(tiles);
      if (deps.hasSpaceFor !== undefined && !(await deps.hasSpaceFor(missing.length * ESTIMATED_TILE_BYTES).catch(() => true))) {
        return failed("storage-full");
      }
      const fetched: string[] = [];
      let bytes = 0;
      let done = 0;
      const queue = [...tiles];
      const missingSet = new Set(missing);
      let failure: KeepFailure | null = null;
      options.onProgress?.({ done, total: tiles.length, bytes });
      const worker = async (): Promise<void> => {
        while (queue.length > 0 && failure === null) {
          if (options.signal?.aborted) { failure = "cancelled"; return; }
          const path = queue.shift()!;
          try {
            // A tile another kept ride already holds is not downloaded twice,
            // but its size still counts toward this ride's.
            // Read the size first: `bytes += await …` would add to a stale total
            // while another download runs.
            const size = missingSet.has(path)
              ? await deps.tiles.fetchAndKeep(path, options.signal)
              : await deps.tiles.sizeOf(path).catch(() => 0);
            bytes += size;
            if (missingSet.has(path)) fetched.push(path);
          } catch (error) {
            if (options.signal?.aborted) failure = "cancelled";
            else if (error instanceof RideTileError) failure = error.code === "quota" ? "storage-full" : error.code === "not-covered" ? "not-covered" : "network";
            else failure = isQuota(error) ? "storage-full" : "network";
            return;
          }
          done += 1;
          options.onProgress?.({ done, total: tiles.length, bytes });
        }
      };
      await Promise.all(Array.from({ length: concurrency }, worker));
      if (failure === null) {
        try {
          await deps.tiles.keepMapAssets();
          if (!(await deps.tiles.hasMapAssets())) failure = "network";
        } catch (error) {
          failure = isQuota(error) ? "storage-full" : "network";
        }
      }
      if (failure === null && (await deps.tiles.missing(tiles)).length > 0) failure = "network";
      if (failure !== null) {
        // Stays off: nothing half-kept is left behind under this ride's name.
        await deps.tiles.remove(await unsharedTiles(rideId, fetched)).catch(() => undefined);
        return failed(failure);
      }
      const record: RidePackRecord = {
        version: 1,
        rideId,
        title: source.title,
        keptAt: now(),
        lineKey: rideLineKey(source.line),
        line: source.line,
        ...(source.instructions === undefined ? {} : { instructions: source.instructions }),
        ...(source.surfaceRuns === undefined ? {} : { surfaceRuns: source.surfaceRuns }),
        ...(source.speedLimits === undefined ? {} : { speedLimits: source.speedLimits }),
        tiles,
        bytes,
      };
      try {
        await deps.packs.put(record);
      } catch (error) {
        await deps.tiles.remove(await unsharedTiles(rideId, fetched)).catch(() => undefined);
        return failed(isQuota(error) ? "storage-full" : "network");
      }
      return { status: "kept", bytes: record.bytes, tiles: tiles.length };
    },

    async dropRide(rideId) {
      const pack = await deps.packs.get(rideId);
      if (pack === null) return;
      const unshared = await unsharedTiles(rideId, pack.tiles);
      await deps.packs.delete(rideId);
      await deps.tiles.remove(unshared);
    },

    async rideIsKept(rideId) {
      try {
        return await complete(await deps.packs.get(rideId));
      } catch {
        return false;
      }
    },

    async keptRides() {
      const packs = await deps.packs.list().catch(() => [] as readonly RidePackRecord[]);
      const kept: KeptRideSummary[] = [];
      for (const pack of packs) {
        if (await complete(pack).catch(() => false)) {
          kept.push({ rideId: pack.rideId, title: pack.title, keptAt: pack.keptAt, bytes: pack.bytes });
        }
      }
      return kept.sort((a, b) => b.keptAt.localeCompare(a.keptAt));
    },

    async keptPackForLine(line) {
      if (!validLine(line)) return null;
      const key = rideLineKey(line);
      const packs = await deps.packs.list().catch(() => [] as readonly RidePackRecord[]);
      for (const pack of packs) {
        if (pack.lineKey === key && (await complete(pack).catch(() => false))) return pack;
      }
      return null;
    },
  };
}

function isQuota(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { readonly name?: unknown }).name;
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED";
}

/** "31 MB", "800 KB": the size a rider reads beside the switch. */
export function formatKeptSize(bytes: number): string {
  if (!(bytes > 0)) return "0 MB";
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
  return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
}
