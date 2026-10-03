import { terrainFeatures } from "@/application/map-layers/terrain";
import type { MapLayerId, TerrainGrid } from "@/application/map-layers";

self.onmessage = (event: MessageEvent<{ readonly grid: TerrainGrid; readonly layers: readonly MapLayerId[] }>): void => {
  try {
    self.postMessage({ features: terrainFeatures(event.data.grid, event.data.layers) });
  } catch {
    self.postMessage({ error: "Terrain derivatives unavailable" });
  }
};
