/**
 * Road lines for the emergency card (HIKE-MODE-PLAN H4 §19).
 *
 * The card wants one thing from the map: the roads this device already holds
 * near a point, as named lines. Two surfaces answer it differently:
 *
 * - The plan map has loaded map-layer features already, so it hands its own
 *   `InfoFeature`s over and nothing new is fetched.
 * - The ride map holds no road features of its own, so it asks the same bounded
 *   map-layer endpoint the layers sheet uses, around the rider, once per card
 *   open.
 *
 * Both paths go through {@link roadLinesFromFeatures}, so "nearest road" means
 * the same thing everywhere. A failed or offline read returns `loaded: false`,
 * which the card renders as "unknown" — never as "no road nearby".
 */

import type { InfoFeature, MapLayerId, MapLayersSource } from "@/application/map-layers";
import type { RoadLine } from "@/domain/geometry/nearest-road";
import type { Coordinate } from "@/domain/ride/types";

/**
 * The layers whose features are named road lines. `mvum` is the authoritative
 * forest-road map, so it is searched first and wins a tie; the two catalogue
 * layers are the twisty and dirt roads the rider can switch on.
 */
export const EMERGENCY_ROAD_LAYERS: readonly MapLayerId[] = ["mvum", "great-roads", "gravel"];

/** About 6 km north–south and 8 km east–west: a walk-out distance, not a drive. */
const ROAD_BOUNDS_DEGREES = { lat: 0.055, lon: 0.075 } as const;

export interface EmergencyRoadRead {
  readonly roads: readonly RoadLine[];
  /** True when the source answered, even if it had no roads to give. */
  readonly loaded: boolean;
}

/** The named road lines in a set of loaded map-layer features. */
export function roadLinesFromFeatures(features: readonly InfoFeature[]): readonly RoadLine[] {
  const lines: RoadLine[] = [];
  for (const feature of features) {
    if (!EMERGENCY_ROAD_LAYERS.includes(feature.layerId)) continue;
    if (feature.geometry.type !== "LineString") continue;
    const line = feature.geometry.coordinates.map(([lon, lat]) => ({ lon, lat }));
    if (line.length < 2) continue;
    lines.push({ id: feature.id, name: feature.name, line });
  }
  // Authority first, so a tie with a scored catalogue road prefers the mapped
  // forest road; `nearestRoad` keeps the first of equal distances.
  lines.sort((a, b) => rank(a) - rank(b));
  return lines;
}

function rank(road: RoadLine): number {
  // Authoritative designations (`authority:…` on the `mvum` layer) first, then
  // the scored twisty catalogue, then dirt.
  if (road.id.startsWith("authority:") || road.id.startsWith("mvum:")) return 0;
  if (road.id.startsWith("curvy:")) return 1;
  return 2;
}

/** True when the map's own visible road layers are the reason `features` exist. */
export function roadLayersVisible(visible: readonly MapLayerId[]): boolean {
  return visible.some((layerId) => EMERGENCY_ROAD_LAYERS.includes(layerId));
}

/**
 * Reads road lines around `point` from the bounded map-layer endpoint.
 *
 * The promise rejects only when the caller aborted; every provider failure is
 * reported as `loaded: false`, because the card's job with an unavailable
 * provider is to say "unknown", not to raise.
 */
export async function readRoadsNear(
  source: MapLayersSource,
  point: Coordinate,
  signal?: AbortSignal,
): Promise<EmergencyRoadRead> {
  const bounds = {
    west: point.lon - ROAD_BOUNDS_DEGREES.lon,
    south: point.lat - ROAD_BOUNDS_DEGREES.lat,
    east: point.lon + ROAD_BOUNDS_DEGREES.lon,
    north: point.lat + ROAD_BOUNDS_DEGREES.lat,
  };
  try {
    const result = await source.load(bounds, EMERGENCY_ROAD_LAYERS, signal);
    if (signal?.aborted === true) return { roads: [], loaded: false };
    const roads = roadLinesFromFeatures(result.features);
    // Every requested provider failing is not an empty map: it is an unknown.
    const answered = (["roads", "authority"] as const).some(
      (provider) => !result.unavailable.includes(provider),
    );
    return { roads, loaded: answered || roads.length > 0 };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { roads: [], loaded: false };
  }
}
