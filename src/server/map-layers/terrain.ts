import { MAX_LAYER_SPAN_DEGREES, type TerrainGrid } from "@/application/map-layers";
import { terrainContourInterval } from "@/application/map-layers/terrain";
import { createTerrariumElevationSource } from "@/infrastructure/elevation/terrarium-source";
import type { LayerProvider, ProviderContext } from "@/server/map-layers/providers";

const sources = new WeakMap<typeof fetch, Map<number, ReturnType<typeof createTerrariumElevationSource>>>();
function source(context: ProviderContext, zoom: number): ReturnType<typeof createTerrariumElevationSource> {
  let resolutions = sources.get(context.fetch);
  if (resolutions === undefined) { resolutions = new Map(); sources.set(context.fetch, resolutions); }
  let found = resolutions.get(zoom);
  if (found === undefined) {
    found = createTerrariumElevationSource({ fetchImpl: context.fetch, zoom });
    resolutions.set(zoom, found);
  }
  return found;
}

export const terrainProvider: LayerProvider = {
  id: "terrain", layers: ["contours", "slope"], ttlMs: 24 * 60 * 60_000,
  async load() { return []; },
  async snapshot(bounds, layers, context) {
    if (bounds.east - bounds.west > MAX_LAYER_SPAN_DEGREES.lon + 1e-6 || bounds.north - bounds.south > MAX_LAYER_SPAN_DEGREES.lat + 1e-6 || Math.abs(bounds.north) > 85) throw new Error("Zoom in for bounded terrain detail");
    const size = 65;
    const points = Array.from({ length: size * size }, (_, i) => ({
      lon: bounds.west + (i % size) * (bounds.east - bounds.west) / (size - 1),
      lat: bounds.south + Math.floor(i / size) * (bounds.north - bounds.south) / (size - 1),
    }));
    // Match DEM pixels to the 65-cell view, keeping requests bounded to a
    // handful of tiles even at regional zoom. Route elevations stay at z12.
    const span = Math.max(bounds.east - bounds.west, (bounds.north - bounds.south) / Math.cos((bounds.north + bounds.south) * Math.PI / 360));
    const zoom = Math.max(0, Math.min(12, Math.ceil(Math.log2(360 * (size - 1) / (256 * span)))));
    const result = await source(context, zoom).elevations(points, context.signal);
    if (result.availability !== "available") throw new Error("DEM unavailable");
    const terrainGrid: TerrainGrid = { bounds, size, heights: result.elevationsMeters };
    const spacing = Math.max((bounds.east - bounds.west) * 111_195 * Math.cos((bounds.north + bounds.south) * Math.PI / 360), (bounds.north - bounds.south) * 111_195) / (size - 1);
    return { features: [], terrainGrid, freshness: layers.map((layerId) => ({ layerId, source: "AWS / Mapzen Terrarium", fetchedAt: new Date((context.now ?? Date.now)()).toISOString(), observedAt: null, stale: false, note: `View-sampled Terrarium DEM (z${zoom}); derivative grid spacing up to ${Math.round(spacing)} m. Contour interval ${terrainContourInterval(terrainGrid)} m (20 m in close views). Source survey date unknown. Online only.` })) };
  },
};
