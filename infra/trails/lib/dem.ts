/** Disk-cached Mapterhorn Terrarium DEM. 512 px tiles; bilinear at pixel centres. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import sharp from "sharp";
import type { Coordinate } from "../../../src/domain/ride/types";

interface Tile { readonly data: Buffer; readonly width: number; readonly channels: number }
export interface DemSource {
  elevations(line: readonly Coordinate[]): Promise<readonly (number | null)[]>;
}
export interface DemOptions {
  readonly cacheDir: string;
  readonly zoom?: number;
  readonly fetchImpl?: typeof fetch;
  readonly log?: (message: string) => void;
}
const SIZE = 512;
const MAX_DECODED = 96;

export function demPixel(point: Coordinate, zoom: number): { x: number; y: number } {
  const size = SIZE * 2 ** zoom;
  const sin = Math.sin(Math.max(-85.05112878, Math.min(85.05112878, point.lat)) * Math.PI / 180);
  return { x: (point.lon + 180) / 360 * size - 0.5,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size - 0.5 };
}

export function createDemSource(options: DemOptions): DemSource {
  const zoom = options.zoom ?? 12;
  if (!Number.isInteger(zoom) || zoom < 12 || zoom > 14) throw new Error("DEM zoom must be 12–14");
  const cache = new Map<string, Tile>();
  const pending = new Map<string, Promise<Tile | null>>();
  const failed = new Set<string>();
  const fetchImpl = options.fetchImpl ?? fetch;
  const load = async (key: string): Promise<Tile | null> => {
    const cached = cache.get(key);
    if (cached !== undefined) {
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }
    if (failed.has(key)) return null;
    const existing = pending.get(key);
    if (existing !== undefined) return existing;
    const promise = (async () => {
      const file = join(options.cacheDir, "mapterhorn", `${key}.webp`);
      let bytes: Buffer;
      try { bytes = await readFile(file); }
      catch {
        let downloaded: Buffer | undefined;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const response = await fetchImpl(`https://tiles.mapterhorn.com/${key}.webp`, { signal: AbortSignal.timeout(20000) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            downloaded = Buffer.from(await response.arrayBuffer());
            // Decode before caching: an error page must never become a DEM tile.
            await sharp(downloaded).metadata();
            break;
          } catch (error) {
            if (attempt === 2) throw error;
          }
        }
        if (downloaded === undefined) throw new Error("DEM tile unavailable");
        bytes = downloaded;
        await mkdir(dirname(file), { recursive: true });
        const temporary = `${file}.${process.pid}.tmp`;
        await writeFile(temporary, bytes);
        await rename(temporary, file);
      }
      const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      if (info.width !== SIZE || info.height !== SIZE || info.channels !== 3) throw new Error("unexpected DEM tile shape");
      const tile = { data, width: info.width, channels: info.channels };
      cache.set(key, tile);
      if (cache.size > MAX_DECODED) cache.delete(cache.keys().next().value!);
      return tile;
    })().catch((error: unknown) => {
      failed.add(key);
      options.log?.(`DEM ${key} unavailable: ${String(error)}`);
      return null;
    }).finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  };
  return {
    async elevations(line) {
      const pixels = line.map((point) => demPixel(point, zoom));
      const keyOf = (x: number, y: number): string => `${zoom}/${Math.floor(x / SIZE)}/${Math.floor(y / SIZE)}`;
      const keys = [...new Set(pixels.flatMap(({ x, y }) => {
        const gx = Math.floor(x), gy = Math.floor(y);
        return [keyOf(gx, gy), keyOf(gx + 1, gy), keyOf(gx, gy + 1), keyOf(gx + 1, gy + 1)];
      }))];
      const tiles = new Map<string, Tile | null>();
      // Bound network and decode work even on a statewide route relation.
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(6, keys.length) }, async () => {
        while (next < keys.length) {
          const key = keys[next++]!;
          tiles.set(key, await load(key));
        }
      }));
      const height = (x: number, y: number): number | null => {
        const tile = tiles.get(keyOf(x, y));
        if (tile == null) return null;
        const index = (((y % SIZE + SIZE) % SIZE) * tile.width + (x % SIZE + SIZE) % SIZE) * tile.channels;
        return tile.data[index]! * 256 + tile.data[index + 1]! + tile.data[index + 2]! / 256 - 32768;
      };
      return pixels.map(({ x, y }) => {
        const gx = Math.floor(x), gy = Math.floor(y), fx = x - gx, fy = y - gy;
        const a = height(gx, gy), b = height(gx + 1, gy), c = height(gx, gy + 1), d = height(gx + 1, gy + 1);
        if (a === null || b === null || c === null || d === null) return null;
        return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
      });
    },
  };
}
