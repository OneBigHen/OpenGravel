import type { ElevationResult, ElevationSource } from "@/application/elevation/profile";
import type { Coordinate } from "@/domain/ride/types";

const ZOOM = 12;
const TILE_SIZE = 512;
const CACHE_NAME = "opengravel-terrain-dem-v1";
const CACHE_LIMIT = 96;

function position(point: Coordinate) {
  const scale = 2 ** ZOOM;
  const latitude = Math.max(-85.0511, Math.min(85.0511, point.lat)) * Math.PI / 180;
  const x = ((point.lon + 180) / 360) * scale;
  const y = (1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2 * scale;
  return { tileX: Math.floor(x), tileY: Math.floor(y), pixelX: Math.floor((x % 1) * TILE_SIZE), pixelY: Math.floor((y % 1) * TILE_SIZE) };
}

export function createMapterhornElevationSource(): ElevationSource {
  const tiles = new Map<string, Promise<ImageData>>();
  async function load(url: string, signal?: AbortSignal): Promise<ImageData> {
    const cache = typeof caches === "undefined" ? null : await caches.open(CACHE_NAME).catch(() => null);
    let response = await cache?.match(url);
    if (response === undefined) {
      response = await fetch(url, signal === undefined ? {} : { signal });
      if (!response.ok) throw new Error("Terrain tile unavailable");
      if (cache !== null) {
        await cache.put(url, response.clone()).catch(() => undefined);
        const keys = await cache.keys();
        if (keys.length > CACHE_LIMIT) await cache.delete(keys[0]!);
      }
    }
    const bitmap = await createImageBitmap(await response.blob());
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context === null) throw new Error("Terrain decoding unavailable");
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height);
    } finally { bitmap.close(); }
  }
  return {
    async elevations(points, signal): Promise<ElevationResult> {
      try {
        const elevationsMeters = await Promise.all(points.map(async (point) => {
          const pos = position(point);
          const url = `https://tiles.mapterhorn.com/${ZOOM}/${pos.tileX}/${pos.tileY}.webp`;
          let tile = tiles.get(url);
          if (tile === undefined) {
            tile = load(url, signal);
            tiles.set(url, tile);
            void tile.catch(() => tiles.delete(url));
            if (tiles.size > CACHE_LIMIT) tiles.delete(tiles.keys().next().value!);
          }
          const image = await tile;
          const offset = (pos.pixelY * image.width + pos.pixelX) * 4;
          return image.data[offset]! * 256 + image.data[offset + 1]! + image.data[offset + 2]! / 256 - 32768;
        }));
        return { availability: "available", elevationsMeters };
      } catch {
        return { availability: "unavailable", reason: "Elevation unknown" };
      }
    },
  };
}
