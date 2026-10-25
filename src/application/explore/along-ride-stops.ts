/**
 * Gas, food, coffee and overlooks along a planned route, as the short list a
 * rider reads at a glance: which place, how far along the ride, how far off it.
 *
 * Facts only: TomTom search results that `/api/map-layers/along` has already
 * placed on the line. Selection keeps the closest few per category and then
 * orders them by route mile; an empty category stays empty rather than being
 * filled with a guess.
 */

import {
  METERS_PER_MILE,
  type AlongStop,
} from "@/application/map-layers/along";
import type { MapLayerId } from "@/application/map-layers/catalog";
import type { Coordinate } from "@/domain/ride/types";

/** The stop layers "Along this ride" asks for, in the order a rider needs them. */
export const ALONG_RIDE_STOP_LAYERS = [
  "fuel",
  "food",
  "coffee",
  "viewpoints",
] as const;
export type AlongRideStopLayer = (typeof ALONG_RIDE_STOP_LAYERS)[number];

/** A place worth stopping for, with where it sits relative to the ride. */
export interface AlongRideStopRow {
  readonly id: string;
  readonly layer: AlongRideStopLayer;
  readonly name: string;
  /** The provider's one supporting line: street and town, or a brand. */
  readonly detail: string | null;
  readonly coordinate: Coordinate;
  /** Distance from the route's start, in miles. */
  readonly mile: number;
  /** How far off the route the place is, in metres. */
  readonly offMeters: number;
}

/** Rider words for each layer, not the layer catalogue's nouns. */
export const ALONG_RIDE_STOP_LABEL: Readonly<Record<AlongRideStopLayer, string>> = {
  fuel: "Gas",
  food: "Food",
  coffee: "Coffee",
  viewpoints: "Overlook",
};

/** The same layers as a source note reads them. */
export const ALONG_RIDE_STOP_SOURCE: Readonly<Record<AlongRideStopLayer, string>> = {
  fuel: "Gas stations",
  food: "Food stops",
  coffee: "Coffee stops",
  viewpoints: "Overlooks",
};

const CATEGORY_LIMIT: Readonly<Record<AlongRideStopLayer, number>> = {
  fuel: 2,
  food: 1,
  coffee: 1,
  viewpoints: 2,
};

/** A short list; the panel mixes these with road windows, not replaces them. */
export const ALONG_RIDE_STOP_LIMIT = 5;

/** Two stations of one kind a few miles apart are one decision, not two. */
const SAME_CATEGORY_SPACING_METERS = 3 * METERS_PER_MILE;

export function isAlongRideStopLayer(layer: MapLayerId): layer is AlongRideStopLayer {
  return (ALONG_RIDE_STOP_LAYERS as readonly string[]).includes(layer);
}

/**
 * The closest few stops per category, in route order. Distance off the route
 * decides "best": a station on the road beats a detour, and repeated stops of
 * one category are spaced out so the list covers the ride.
 */
export function alongRideStopRows(
  stops: readonly AlongStop[],
): readonly AlongRideStopRow[] {
  const byLayer = new Map<AlongRideStopLayer, AlongRideStopRow[]>();
  for (const stop of stops) {
    if (!isAlongRideStopLayer(stop.feature.layerId)) continue;
    if (stop.feature.geometry.type !== "Point") continue;
    if (!Number.isFinite(stop.alongMeters) || !Number.isFinite(stop.offMeters)) continue;
    const [lon, lat] = stop.feature.geometry.coordinates;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const row: AlongRideStopRow = {
      id: stop.feature.id,
      layer: stop.feature.layerId,
      name: stop.feature.name,
      detail: stop.feature.detail,
      coordinate: { lon, lat },
      mile: stop.alongMeters / METERS_PER_MILE,
      offMeters: stop.offMeters,
    };
    const rows = byLayer.get(row.layer);
    if (rows === undefined) byLayer.set(row.layer, [row]);
    else rows.push(row);
  }

  const kept: AlongRideStopRow[] = [];
  for (const layer of ALONG_RIDE_STOP_LAYERS) {
    const candidates = (byLayer.get(layer) ?? []).sort(
      (left, right) => left.offMeters - right.offMeters || left.mile - right.mile,
    );
    const chosen: AlongRideStopRow[] = [];
    for (const candidate of candidates) {
      if (chosen.length >= CATEGORY_LIMIT[layer]) break;
      const tooClose = chosen.some(
        (other) =>
          Math.abs(other.mile - candidate.mile) * METERS_PER_MILE <
          SAME_CATEGORY_SPACING_METERS,
      );
      if (tooClose) continue;
      chosen.push(candidate);
    }
    kept.push(...chosen);
  }
  return kept
    .sort((left, right) => left.mile - right.mile || left.id.localeCompare(right.id))
    .slice(0, ALONG_RIDE_STOP_LIMIT);
}

/** "Mile 14", or where the stop is at the very start of the ride. */
export function alongRideMileLabel(mile: number): string {
  if (!Number.isFinite(mile)) return "Mile unknown";
  return mile < 0.5 ? "Start" : `Mile ${Math.round(mile)}`;
}

/** "On route" or "0.3 mi off route", the way a rider measures a detour. */
export function alongRideOffRouteLabel(offMeters: number): string {
  if (!Number.isFinite(offMeters)) return "Distance off route unknown";
  if (offMeters < 160) return "On route";
  return `${(offMeters / METERS_PER_MILE).toFixed(1)} mi off route`;
}
