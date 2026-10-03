import type { InfoFeature } from "@/application/map-layers";
import type { KnownGravelCorridor } from "@/application/roads/known-roads";
import { knownRoadsFromEnv } from "@/server/roads/known-roads-db";
import type { LayerProvider } from "@/server/map-layers/providers";

export function projectSurface(corridors: readonly KnownGravelCorridor[]): readonly InfoFeature[] {
  return corridors.map((corridor) => {
    if (!Number.isFinite(corridor.confidence) || corridor.confidence < 0 || corridor.confidence > 1 || corridor.line.length < 2 || !corridor.line.every((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat) && Math.abs(point.lon) <= 180 && Math.abs(point.lat) <= 90)) throw new Error("Invalid canonical surface evidence");
    return { id: `surface:gravel-atlas:${corridor.id}`, layerId: "road-surface", name: corridor.label || "Surveyed gravel corridor", detail: `Gravel Atlas · gravel surface · routing confidence ${Math.round(corridor.confidence * 100)}%. Source survey date unknown. Surface evidence is not legal access or current passability.`, weight: corridor.confidence, geometry: { type: "LineString", coordinates: corridor.line.map((point) => [point.lon, point.lat] as const) } };
  });
}
export const surfaceProvider: LayerProvider = {
  id: "surface", layers: ["road-surface"], ttlMs: 60 * 60_000,
  async load() { return []; },
  async snapshot(bounds, _layers, context) {
    const port = knownRoadsFromEnv(context.env);
    if (port.catalogAvailable?.("gravel") !== true) throw new Error("Canonical Gravel Atlas unavailable");
    const features = projectSurface(port.gravelCorridorsNear(bounds));
    return { features, freshness: [{ layerId: "road-surface", source: "Canonical Gravel Atlas routing evidence", fetchedAt: new Date((context.now ?? Date.now)()).toISOString(), observedAt: null, stale: false, note: "Catalogue retrieval; source survey dates unknown. Only surveyed gravel corridors, with the routing model's confidence. Other surfaces and gaps unknown; no inference of access. Online only." }] };
  },
};
