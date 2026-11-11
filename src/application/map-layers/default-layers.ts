/**
 * Which layers are on when the rider has not chosen any (first-minute wow, W1).
 *
 * A new rider's first map shows where the good riding is with no taps: gravel
 * in tan and the twisty roads in their line weights, plus the curated rides as
 * thin plum outlines. The rules are small and deliberately testable:
 *
 * - a saved choice always wins, including an empty one — turning the layers off
 *   sticks, because "the rider switched them off" is a choice, not an absence;
 * - the hike defaults are left exactly as they were (the hiking surface is
 *   frozen, and a walker wants trails, terrain and contours, not gravel roads);
 * - a stored value that cannot be read is treated as no choice at all.
 */

import type { ActivityMode } from "@/application/map/activity-mode";

import { isMapLayerId, type MapLayerId } from "./catalog";

/** What a fresh ride map opens with: where the good riding is, in three lines. */
export const DEFAULT_RIDE_LAYERS: readonly MapLayerId[] = ["gravel", "great-roads", "rider-picked"];

/** The hike default is unchanged: trails, hill shading and contours. */
export const DEFAULT_HIKE_LAYERS: readonly MapLayerId[] = ["trails", "hillshade", "contours"];

export function defaultLayersFor(mode: ActivityMode): readonly MapLayerId[] {
  return mode === "hike" ? DEFAULT_HIKE_LAYERS : DEFAULT_RIDE_LAYERS;
}

/**
 * The layers a stored value names. `null` means the rider has never chosen, so
 * the default set opens; any saved array — `[]` included — is the choice.
 */
export function parseStoredLayers(raw: string | null, mode: ActivityMode): readonly MapLayerId[] {
  if (raw === null) return defaultLayersFor(mode);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultLayersFor(mode);
  }
  if (!Array.isArray(parsed)) return defaultLayersFor(mode);
  const ids: MapLayerId[] = [];
  for (const value of parsed) {
    if (typeof value !== "string" || !isMapLayerId(value) || ids.includes(value)) continue;
    ids.push(value);
  }
  return ids;
}
