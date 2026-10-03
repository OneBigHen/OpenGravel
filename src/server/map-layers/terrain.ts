import type { TerrainGrid } from "@/application/map-layers";
import { createTerrariumElevationSource } from "@/infrastructure/elevation/terrarium-source";
import type { LayerProvider, ProviderContext } from "@/server/map-layers/providers";

const sources = new WeakMap<typeof fetch, ReturnType<typeof createTerrariumElevationSource>>();
function source(context: ProviderContext): ReturnType<typeof createTerrariumElevationSource> {
  let found = sources.get(context.fetch);
  if (found === undefined) {
    found = createTerrariumElevationSource({ fetchImpl: context.fetch });
    sources.set(context.fetch, found);
  }
  return found;
}

export const terrainProvider: LayerProvider = {
  id: "terrain", layers: ["contours", "slope"], ttlMs: 24 * 60 * 60_000,
  async load() { return []; },
  async snapshot(bounds, layers, context) {
    if (bounds.east - bounds.west > 0.12 || bounds.north - bounds.south > 0.12 || Math.abs(bounds.north) > 85) throw new Error("Zoom in for bounded terrain detail");
    const size = 65;
    const points = Array.from({ length: size * size }, (_, i) => ({
      lon: bounds.west + (i % size) * (bounds.east - bounds.west) / (size - 1),
      lat: bounds.south + Math.floor(i / size) * (bounds.north - bounds.south) / (size - 1),
    }));
    const result = await source(context).elevations(points, context.signal);
    if (result.availability !== "available") throw new Error("DEM unavailable");
    const terrainGrid: TerrainGrid = { bounds, size, heights: result.elevationsMeters };
    const spacing = Math.max((bounds.east - bounds.west) * 111_195 * Math.cos((bounds.north + bounds.south) * Math.PI / 360), (bounds.north - bounds.south) * 111_195) / (size - 1);
    return { features: [], terrainGrid, freshness: layers.map((layerId) => ({ layerId, source: "AWS / Mapzen Terrarium", fetchedAt: new Date((context.now ?? Date.now)()).toISOString(), observedAt: null, stale: false, note: `DEM resolution ~30–90 m; derivative grid spacing up to ${Math.round(spacing)} m. Source survey date unknown. Online only.` })) };
  },
};

/** Independent bounded availability probe: hillshade never needs the derivative grid. */
export const hillshadeProvider: LayerProvider = {
  id: "hillshade", layers: ["hillshade"], ttlMs: 24 * 60 * 60_000,
  async load() { return []; },
  async snapshot(bounds, _layers, context) {
    const points = [
      { lon: bounds.west, lat: bounds.south }, { lon: bounds.east, lat: bounds.south },
      { lon: bounds.west, lat: bounds.north }, { lon: bounds.east, lat: bounds.north },
      { lon: (bounds.west + bounds.east) / 2, lat: (bounds.south + bounds.north) / 2 },
    ];
    const result = await source(context).elevations(points, context.signal);
    if (result.availability !== "available") throw new Error("DEM unavailable");
    return { features: [], freshness: [{ layerId: "hillshade", source: "AWS / Mapzen Terrarium", fetchedAt: new Date((context.now ?? Date.now)()).toISOString(), observedAt: null, stale: false, note: "Raster DEM resolution ~30–90 m, varying by region. Source survey date unknown. Online only." }] };
  },
};
